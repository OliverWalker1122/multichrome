import React, { useEffect, useMemo, useState } from 'react';
import {
    Button,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Select,
    Textarea,
    Tooltip,
    mergeClasses,
} from '@fluentui/react-components';
import {
    CopyRegular,
    DeleteRegular,
    DismissRegular,
    DocumentTextRegular,
    PlayRegular,
    ShieldCheckmarkRegular,
    StopRegular,
} from '@fluentui/react-icons';
import {
    BrowserEngineType,
    ChromeEnvironment,
    EnvironmentStorageStats,
    FingerprintConfig,
    ManagedProxy,
} from '../../types';
import { environmentApi } from '../../services';
import { useNotification } from '../../contexts/NotificationContext';
import { useDetailsKeyboard } from '../../hooks/useDetailsKeyboard';
import { tr, useI18n } from '../../i18n';
import TagEditor from '../common/TagEditor';
import InfoTip from '../common/InfoTip';
import {
    collectTagStats,
    normalizeEnvironmentTags,
} from '../../utils/environmentTags';
import {
    ENV_DETAILS_WIDTH,
    useEnvironmentDetailsStyles,
} from './environmentDetailsStyles';
import EnvironmentEngineFingerprintCard from './EnvironmentEngineFingerprintCard';
import EnvironmentAdvancedFields from './EnvironmentAdvancedFields';
import EnvironmentStorageMetaCard, {
    formatStorageBytes,
} from './EnvironmentStorageMetaCard';

export { ENV_DETAILS_WIDTH };

interface EnvironmentDetailsPanelProps {
    environment: ChromeEnvironment;
    allEnvironments?: ChromeEnvironment[];
    managedProxies: ManagedProxy[];
    groups: string[];
    overlay: boolean;
    hasFingerprintKernel?: boolean;
    onClose: () => void;
    onLaunch: (id: string) => Promise<void>;
    onStop: (id: string) => Promise<void>;
    onClone?: (id: string) => Promise<void>;
    onInspectHealth?: (env: ChromeEnvironment) => void;
    onDelete: (env: ChromeEnvironment) => void;
    onSave: (id: string, data: Partial<ChromeEnvironment>) => Promise<void>;
    onRegenerateFingerprint?: (id: string) => Promise<void>;
    onInspectProxyLogs?: (proxyId: string) => void;
}

function cleanError(error: unknown): string {
    if (error instanceof Error) {
        return error.message.replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            '',
        );
    }
    return tr(
        '保存失败，请检查输入后重试。',
        'Save failed. Please check your input and try again.',
    );
}

const EnvironmentDetailsPanel: React.FC<EnvironmentDetailsPanelProps> = ({
    environment,
    allEnvironments = [],
    managedProxies,
    groups,
    overlay,
    hasFingerprintKernel = false,
    onClose,
    onLaunch,
    onStop,
    onClone,
    onInspectHealth,
    onDelete,
    onSave,
    onRegenerateFingerprint,
    onInspectProxyLogs,
}) => {
    const styles = useEnvironmentDetailsStyles();
    const { isEn, t } = useI18n();
    const keyboardProps = useDetailsKeyboard(overlay, onClose);
    const { showNotification } = useNotification();

    const [name, setName] = useState(environment.name);
    const [groupName, setGroupName] = useState(environment.groupName);
    const [tags, setTags] = useState<string[]>(
        normalizeEnvironmentTags(environment.tags),
    );
    const [proxyId, setProxyId] = useState(environment.proxyId || '');
    const [proxy, setProxy] = useState(environment.proxy || '');
    const [proxyLabel, setProxyLabel] = useState(environment.proxyLabel || '');
    const [timezone, setTimezone] = useState(environment.timezone || '');
    const [language, setLanguage] = useState(environment.language || '');
    const [startupUrl, setStartupUrl] = useState(environment.startupUrl || '');
    const [notes, setNotes] = useState(environment.notes || '');
    const [browserEngine, setBrowserEngine] = useState<BrowserEngineType>(
        environment.browserEngine || 'system-chrome',
    );
    const [fingerprintConfig, setFingerprintConfig] = useState<
        FingerprintConfig | undefined
    >(environment.fingerprintConfig);
    const [regenerating, setRegenerating] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [storageStats, setStorageStats] =
        useState<EnvironmentStorageStats | null>(null);
    const [loadingStorage, setLoadingStorage] = useState(false);
    const [clearingCache, setClearingCache] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [showFpDetails, setShowFpDetails] = useState(false);

    useEffect(() => {
        setName(environment.name);
        setGroupName(environment.groupName);
        setTags(normalizeEnvironmentTags(environment.tags));
        setProxyId(environment.proxyId || '');
        setProxy(environment.proxy || '');
        setProxyLabel(environment.proxyLabel || '');
        setTimezone(environment.timezone || '');
        setLanguage(environment.language || '');
        setStartupUrl(environment.startupUrl || '');
        setNotes(environment.notes || '');
        setFingerprintConfig(environment.fingerprintConfig);
        setBrowserEngine(environment.browserEngine || 'system-chrome');
    }, [
        environment.id,
        environment.name,
        environment.groupName,
        environment.tags,
        environment.proxyId,
        environment.proxy,
        environment.proxyLabel,
        environment.timezone,
        environment.language,
        environment.startupUrl,
        environment.notes,
        environment.fingerprintConfig,
        environment.browserEngine,
    ]);

    const existingTagSuggestions = useMemo(
        () => collectTagStats(allEnvironments).map((item) => item.tag),
        [allEnvironments],
    );

    useEffect(() => {
        let cancelled = false;
        const loadStorage = async () => {
            if (!environmentApi.isAvailable()) return;
            setLoadingStorage(true);
            try {
                const stats = await environmentApi.getStorageStats(
                    environment.id,
                );
                if (!cancelled) setStorageStats(stats);
            } catch {
                if (!cancelled) setStorageStats(null);
            } finally {
                if (!cancelled) setLoadingStorage(false);
            }
        };
        void loadStorage();
        return () => {
            cancelled = true;
        };
    }, [environment.id, environment.isRunning]);

    const handleClearCache = async () => {
        if (
            !environmentApi.isAvailable() ||
            environment.isRunning ||
            clearingCache
        ) {
            return;
        }
        try {
            setClearingCache(true);
            const res = await environmentApi.clearCache(environment.id);
            setStorageStats({
                exists: true,
                totalBytes: res.afterTotalBytes,
                cacheBytes: res.afterCacheBytes,
            });
            showNotification(
                'success',
                res.freedBytes > 0
                    ? isEn
                        ? `Cleared ${formatStorageBytes(res.freedBytes)} of cache; cookies & sessions preserved`
                        : `已清理 ${formatStorageBytes(res.freedBytes)} 缓存，Cookie 与登录态已保留`
                    : t('当前没有可清理的缓存文件', 'No cache files to clear'),
            );
        } catch (error) {
            showNotification('error', cleanError(error));
        } finally {
            setClearingCache(false);
        }
    };

    const handleOpenDataDir = async () => {
        if (!environmentApi.isAvailable()) return;
        try {
            await environmentApi.openDataDir(environment.id);
        } catch (error) {
            showNotification('error', cleanError(error));
        }
    };

    const normalizedEnvTags = useMemo(
        () => normalizeEnvironmentTags(environment.tags),
        [environment.tags],
    );
    const normalizedDraftTags = useMemo(
        () => normalizeEnvironmentTags(tags),
        [tags],
    );

    const isDirty =
        name.trim() !== environment.name ||
        groupName.trim() !== environment.groupName ||
        JSON.stringify(normalizedDraftTags) !==
            JSON.stringify(normalizedEnvTags) ||
        proxyId !== (environment.proxyId || '') ||
        (!proxyId &&
            (proxy.trim() !== (environment.proxy || '') ||
                proxyLabel.trim() !== (environment.proxyLabel || ''))) ||
        timezone.trim() !== (environment.timezone || '') ||
        language.trim() !== (environment.language || '') ||
        startupUrl.trim() !== (environment.startupUrl || '') ||
        notes.trim() !== (environment.notes || '') ||
        browserEngine !== (environment.browserEngine || 'system-chrome') ||
        JSON.stringify(fingerprintConfig || null) !==
            JSON.stringify(environment.fingerprintConfig || null);

    const handleReset = () => {
        setName(environment.name);
        setGroupName(environment.groupName);
        setTags(normalizeEnvironmentTags(environment.tags));
        setProxyId(environment.proxyId || '');
        setProxy(environment.proxy || '');
        setProxyLabel(environment.proxyLabel || '');
        setTimezone(environment.timezone || '');
        setLanguage(environment.language || '');
        setStartupUrl(environment.startupUrl || '');
        setNotes(environment.notes || '');
        setBrowserEngine(environment.browserEngine || 'system-chrome');
        setFingerprintConfig(environment.fingerprintConfig);
        setSaveError('');
    };

    const handleRegenerate = async () => {
        if (!onRegenerateFingerprint || environment.isRunning) return;
        try {
            setRegenerating(true);
            await onRegenerateFingerprint(environment.id);
            showNotification(
                'success',
                t(
                    '已重新生成全新持久化指纹种子与设备画像',
                    'Regenerated a new persistent fingerprint seed & device profile',
                ),
            );
        } finally {
            setRegenerating(false);
        }
    };

    const handleSave = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!name.trim()) {
            setSaveError(
                t(
                    '环境名称不能为空，请输入名称后再保存。',
                    'Environment name cannot be empty.',
                ),
            );
            return;
        }
        if (!groupName.trim()) {
            setSaveError(
                t(
                    '分组名称不能为空，请选择或输入分组。',
                    'Group name cannot be empty.',
                ),
            );
            return;
        }

        const payload: Partial<ChromeEnvironment> = {
            name: name.trim(),
            groupName: groupName.trim(),
            tags: normalizedDraftTags,
            timezone: timezone.trim(),
            language: language.trim(),
            startupUrl: startupUrl.trim(),
            notes: notes.trim(),
        };

        if (browserEngine !== (environment.browserEngine || 'system-chrome')) {
            payload.browserEngine = browserEngine;
        }
        if (
            fingerprintConfig &&
            JSON.stringify(fingerprintConfig) !==
                JSON.stringify(environment.fingerprintConfig || null)
        ) {
            payload.fingerprintConfig = fingerprintConfig;
        }

        const proxyChanged =
            proxyId !== (environment.proxyId || '') ||
            (!proxyId &&
                (proxy.trim() !== (environment.proxy || '') ||
                    proxyLabel.trim() !== (environment.proxyLabel || '')));
        if (proxyChanged) {
            payload.proxyId = proxyId;
            if (!proxyId) {
                payload.proxy = proxy.trim();
                payload.proxyLabel = proxyLabel.trim();
            }
        }

        try {
            setSaving(true);
            setSaveError('');
            await onSave(environment.id, payload);
            showNotification(
                'success',
                isEn
                    ? `Saved changes to "${name.trim()}"`
                    : `已保存环境“${name.trim()}”的更改`,
            );
        } catch (error) {
            setSaveError(
                isEn
                    ? `${cleanError(error)}. Your unsaved edits are preserved — adjust and try again.`
                    : `${cleanError(error)}。您的未保存内容已保留，请调整后重试。`,
            );
        } finally {
            setSaving(false);
        }
    };

    const copyText = async (value: string, label: string) => {
        if (!value) return;
        try {
            await navigator.clipboard.writeText(value);
            showNotification(
                'success',
                isEn ? `Copied ${label}` : `已复制${label}`,
            );
        } catch {
            showNotification(
                'error',
                isEn
                    ? `Unable to copy ${label}. Please copy manually.`
                    : `无法复制${label}，请手动选中复制`,
            );
        }
    };

    const sharedWith = useMemo(
        () =>
            proxyId
                ? allEnvironments.filter(
                      (item) =>
                          item.id !== environment.id &&
                          item.proxyId === proxyId,
                  )
                : [],
        [allEnvironments, environment.id, proxyId],
    );

    const panelContent = (
        <aside
            {...keyboardProps}
            className={mergeClasses(
                styles.panel,
                overlay && styles.panelOverlay,
            )}
            aria-label={t('环境详情', 'Environment details')}
            onClick={(event) => event.stopPropagation()}
        >
            <div className={styles.header}>
                <div className={styles.titleWrap}>
                    <h2 className={styles.title} title={environment.name}>
                        {environment.name}
                    </h2>
                    <div className={styles.statusRow}>
                        <span
                            aria-hidden="true"
                            className={mergeClasses(
                                styles.dot,
                                environment.isRunning
                                    ? styles.dotRunning
                                    : styles.dotStopped,
                            )}
                        />
                        <span>
                            {environment.isRunning
                                ? t('运行中', 'Running')
                                : t('未运行', 'Stopped')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                            className={styles.groupName}
                            title={environment.groupName}
                        >
                            {environment.groupName}
                        </span>
                    </div>
                </div>
                <Tooltip
                    content={t('关闭详情面板', 'Close details panel')}
                    relationship="label"
                >
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<DismissRegular />}
                        aria-label={t('关闭详情面板', 'Close details panel')}
                        onClick={onClose}
                    />
                </Tooltip>
            </div>

            <div className={styles.quickActions}>
                <Button
                    size="small"
                    appearance={environment.isRunning ? 'secondary' : 'primary'}
                    icon={
                        environment.isRunning ? (
                            <StopRegular />
                        ) : (
                            <PlayRegular />
                        )
                    }
                    onClick={() =>
                        void (environment.isRunning
                            ? onStop(environment.id)
                            : onLaunch(environment.id))
                    }
                >
                    {environment.isRunning
                        ? t('关闭环境', 'Stop')
                        : t('启动环境', 'Launch')}
                </Button>
                {onInspectHealth && (
                    <Tooltip
                        content={t('健康自检', 'Health Check')}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ShieldCheckmarkRegular />}
                            onClick={() => onInspectHealth(environment)}
                        >
                            {t('健康自检', 'Health Check')}
                        </Button>
                    </Tooltip>
                )}
                <div style={{ flex: 1 }} />
                {environment.proxyId && onInspectProxyLogs && (
                    <Tooltip
                        content={t(
                            '查看关联代理日志',
                            'Inspect bound proxy logs',
                        )}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<DocumentTextRegular />}
                            aria-label={t(
                                '查看关联代理日志',
                                'Inspect bound proxy logs',
                            )}
                            onClick={() =>
                                onInspectProxyLogs(environment.proxyId!)
                            }
                        />
                    </Tooltip>
                )}
                {onClone && (
                    <Tooltip
                        content={t(
                            '克隆环境（分配全新独立指纹）',
                            'Clone environment (new unique fingerprint)',
                        )}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<CopyRegular />}
                            aria-label={t('克隆环境', 'Clone environment')}
                            onClick={() => void onClone(environment.id)}
                        />
                    </Tooltip>
                )}
                <Tooltip
                    content={t('移入回收站', 'Move to Trash')}
                    relationship="label"
                >
                    <Button
                        size="small"
                        appearance="subtle"
                        icon={<DeleteRegular />}
                        aria-label={t('移入回收站', 'Move to Trash')}
                        onClick={() => onDelete(environment)}
                    />
                </Tooltip>
            </div>

            <form
                id="env-details-form"
                className={styles.body}
                onSubmit={(event) => void handleSave(event)}
            >
                {saveError && (
                    <MessageBar intent="error" layout="multiline">
                        <MessageBarBody>{saveError}</MessageBarBody>
                    </MessageBar>
                )}

                <div className={styles.identityFields}>
                    <Field label={t('环境名称', 'Environment Name')} required>
                        <Input
                            value={name}
                            onChange={(_, data) => setName(data.value)}
                        />
                    </Field>
                    <Field label={t('分组', 'Group')} required>
                        <Input
                            value={groupName}
                            list="env-detail-groups"
                            onChange={(_, data) => setGroupName(data.value)}
                        />
                    </Field>
                    <datalist id="env-detail-groups">
                        {groups.map((group) => (
                            <option key={group} value={group} />
                        ))}
                    </datalist>
                </div>

                <Field label={t('标签', 'Tags')}>
                    <TagEditor
                        value={tags}
                        onChange={setTags}
                        suggestions={existingTagSuggestions}
                    />
                </Field>

                <Field
                    label={
                        <span
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                            }}
                        >
                            {t('关联代理', 'Proxy')}
                            <InfoTip
                                content={
                                    environment.isRunning
                                        ? t(
                                              '环境正在运行，关闭后方可切换代理',
                                              'Close the running environment before changing proxy settings',
                                          )
                                        : t(
                                              '优先使用内置代理；不选择时跟随全局备用代理或直连',
                                              'Uses built-in proxy first; otherwise follows fallback proxy or direct',
                                          )
                                }
                            />
                        </span>
                    }
                >
                    <Select
                        disabled={environment.isRunning}
                        value={proxyId}
                        onChange={(_, data) => setProxyId(data.value)}
                    >
                        <option value="">
                            {t('全局默认', 'Global Default')}
                        </option>
                        {managedProxies.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name} ({item.protocol.toUpperCase()})
                            </option>
                        ))}
                    </Select>
                </Field>

                {sharedWith.length > 0 && (
                    <MessageBar intent="warning" layout="multiline">
                        <MessageBarBody>
                            {isEn
                                ? `Also used by ${sharedWith.length} other profile(s) (${sharedWith
                                      .slice(0, 3)
                                      .map((item) => item.name)
                                      .join(
                                          ', ',
                                      )}${sharedWith.length > 3 ? '…' : ''})`
                                : `此代理已被其他 ${sharedWith.length} 个环境使用（${sharedWith
                                      .slice(0, 3)
                                      .map((item) => item.name)
                                      .join(
                                          '、',
                                      )}${sharedWith.length > 3 ? ' 等' : ''}），共用 IP 存在关联风险`}
                        </MessageBarBody>
                    </MessageBar>
                )}

                <Field label={t('备注', 'Notes')}>
                    <Textarea
                        rows={2}
                        placeholder={t(
                            '用途说明或账号备注',
                            'Environment or account notes',
                        )}
                        value={notes}
                        onChange={(_, data) => setNotes(data.value)}
                    />
                </Field>

                <EnvironmentEngineFingerprintCard
                    styles={styles}
                    isRunning={environment.isRunning}
                    hasFingerprintKernel={hasFingerprintKernel}
                    browserEngine={browserEngine}
                    onBrowserEngineChange={setBrowserEngine}
                    fingerprintConfig={fingerprintConfig}
                    onFingerprintConfigChange={setFingerprintConfig}
                    canRegenerate={Boolean(onRegenerateFingerprint)}
                    regenerating={regenerating}
                    onRegenerate={() => void handleRegenerate()}
                    showFpDetails={showFpDetails}
                    onToggleFpDetails={() => setShowFpDetails((prev) => !prev)}
                />

                <EnvironmentAdvancedFields
                    styles={styles}
                    isRunning={environment.isRunning}
                    hasManagedProxy={Boolean(proxyId)}
                    showAdvanced={showAdvanced}
                    onToggleAdvanced={() => setShowAdvanced((prev) => !prev)}
                    proxy={proxy}
                    onProxyChange={setProxy}
                    proxyLabel={proxyLabel}
                    onProxyLabelChange={setProxyLabel}
                    timezone={timezone}
                    onTimezoneChange={setTimezone}
                    language={language}
                    onLanguageChange={setLanguage}
                    startupUrl={startupUrl}
                    onStartupUrlChange={setStartupUrl}
                />

                <EnvironmentStorageMetaCard
                    styles={styles}
                    environment={environment}
                    loadingStorage={loadingStorage}
                    storageStats={storageStats}
                    clearingCache={clearingCache}
                    onCopyId={() =>
                        void copyText(
                            environment.id,
                            t('环境 ID', 'Environment ID'),
                        )
                    }
                    onClearCache={() => void handleClearCache()}
                    onOpenDataDir={() => void handleOpenDataDir()}
                />
            </form>

            {(isDirty || saving) && (
                <div className={styles.footer}>
                    <span className={styles.dirtyHint}>
                        {t('有未保存更改', 'Unsaved changes')}
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <Button
                            type="button"
                            size="small"
                            appearance="subtle"
                            disabled={saving}
                            onClick={handleReset}
                        >
                            {t('还原', 'Reset')}
                        </Button>
                        <Button
                            type="submit"
                            form="env-details-form"
                            size="small"
                            appearance="primary"
                            disabled={saving}
                        >
                            {saving
                                ? t('保存中…', 'Saving…')
                                : t('保存更改', 'Save')}
                        </Button>
                    </div>
                </div>
            )}
        </aside>
    );

    if (overlay) {
        return (
            <div className={styles.backdrop} onClick={onClose}>
                {panelContent}
            </div>
        );
    }

    return panelContent;
};

export default EnvironmentDetailsPanel;
