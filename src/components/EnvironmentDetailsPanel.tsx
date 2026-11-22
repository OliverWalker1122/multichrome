import React, { useEffect, useMemo, useState } from 'react';
import {
    Badge,
    Button,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    Select,
    Switch,
    Textarea,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowSyncRegular,
    BroomRegular,
    ChevronDownRegular,
    ChevronUpRegular,
    CopyRegular,
    DeleteRegular,
    DismissRegular,
    DocumentTextRegular,
    FolderOpenRegular,
    PlayRegular,
    ShieldCheckmarkRegular,
    StopRegular,
} from '@fluentui/react-icons';
import dayjs from 'dayjs';
import {
    BrowserEngineType,
    ChromeEnvironment,
    EnvironmentStorageStats,
    FingerprintBrand,
    FingerprintConfig,
    FingerprintPlatform,
    ManagedProxy,
} from '../types';
import { useNotification } from '../contexts/NotificationContext';
import { useDetailsKeyboard } from '../hooks/useDetailsKeyboard';
import { tr, useI18n } from '../i18n';
import TagEditor from './TagEditor';
import InfoTip from './InfoTip';
import {
    collectTagStats,
    normalizeEnvironmentTags,
} from '../utils/environmentTags';

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

const COMMON_TIMEZONES = [
    'America/Los_Angeles',
    'America/New_York',
    'Europe/London',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Asia/Hong_Kong',
    'Asia/Shanghai',
];

const COMMON_LANGUAGES = [
    'auto',
    'en-US',
    'en-GB',
    'ja-JP',
    'ko-KR',
    'de-DE',
    'fr-FR',
    'zh-TW',
    'zh-HK',
    'zh-CN',
];

const useStyles = makeStyles({
    backdrop: {
        position: 'absolute',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.36)',
        zIndex: 20,
        display: 'flex',
        justifyContent: 'flex-end',
    },
    panel: {
        width: '348px',
        minWidth: '348px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--glass-drawer)',
        backdropFilter: 'blur(28px)',
        borderLeft: '1px solid var(--glass-border)',
        outline: 'none',
        overflow: 'hidden',
        flexShrink: 0,
    },
    panelOverlay: {
        width: 'min(380px, 92vw)',
        minWidth: 0,
        boxShadow: tokens.shadow28,
    },
    header: {
        padding: '12px 14px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '8px',
        flexShrink: 0,
    },
    titleWrap: {
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
    titleRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
    },
    title: {
        fontSize: '15px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
        margin: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    statusRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
    dot: {
        width: '8px',
        height: '8px',
        borderRadius: '999px',
        flexShrink: 0,
    },
    dotRunning: {
        backgroundColor: tokens.colorPaletteGreenForeground1,
    },
    dotStopped: {
        backgroundColor: tokens.colorNeutralForeground4,
    },
    quickActions: {
        padding: '10px 14px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
        flexWrap: 'nowrap',
    },
    body: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        '& > *': {
            flexShrink: 0,
        },
    },
    sectionLabel: {
        fontSize: '12px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
        marginTop: '4px',
    },
    inlineCopyRow: {
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
    },
    metaBox: {
        padding: '10px 12px',
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: 'var(--glass-card-inner)',
        border: '1px solid var(--glass-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        fontSize: '12px',
    },
    metaRow: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    metaKey: {
        color: tokens.colorNeutralForeground3,
    },
    metaVal: {
        color: tokens.colorNeutralForeground1,
        fontFamily: tokens.fontFamilyMonospace,
        wordBreak: 'break-all',
    },
    footer: {
        padding: '10px 14px',
        borderTop: '1px solid var(--glass-border)',
        backgroundColor: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        flexShrink: 0,
    },
    dirtyHint: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
});

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

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx += 1;
    }
    return `${value >= 100 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
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
    const styles = useStyles();
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
            if (!window.electronAPI?.chromeEnvironments?.getStorageStats) return;
            setLoadingStorage(true);
            try {
                const stats =
                    await window.electronAPI.chromeEnvironments.getStorageStats(
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
            !window.electronAPI?.chromeEnvironments?.clearCache ||
            environment.isRunning ||
            clearingCache
        ) {
            return;
        }
        try {
            setClearingCache(true);
            const res = await window.electronAPI.chromeEnvironments.clearCache(
                environment.id,
            );
            setStorageStats({
                exists: true,
                totalBytes: res.afterTotalBytes,
                cacheBytes: res.afterCacheBytes,
            });
            showNotification(
                'success',
                res.freedBytes > 0
                    ? isEn
                        ? `Cleared ${formatBytes(res.freedBytes)} of cache; cookies & sessions preserved`
                        : `已清理 ${formatBytes(res.freedBytes)} 缓存，Cookie 与登录态已保留`
                    : t('当前没有可清理的缓存文件', 'No cache files to clear'),
            );
        } catch (error) {
            showNotification('error', cleanError(error));
        } finally {
            setClearingCache(false);
        }
    };

    const handleOpenDataDir = async () => {
        if (!window.electronAPI?.chromeEnvironments?.openDataDir) return;
        try {
            await window.electronAPI.chromeEnvironments.openDataDir(
                environment.id,
            );
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

        // 仅在环境未运行且代理确实变更时提交代理字段
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
            // 编辑失败不丢草稿，并说明原因与下一步
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
                    <div className={styles.titleRow}>
                        <span
                            className={mergeClasses(
                                styles.dot,
                                environment.isRunning
                                    ? styles.dotRunning
                                    : styles.dotStopped,
                            )}
                        />
                        <h3 className={styles.title} title={environment.name}>
                            {environment.name}
                        </h3>
                    </div>
                    <div className={styles.statusRow}>
                        <span>
                            {environment.isRunning
                                ? t('运行中', 'Running')
                                : t('未运行', 'Stopped')}
                        </span>
                        <span>·</span>
                        <span>{environment.groupName}</span>
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
                        content={t(
                            '一键防泄露 / 指纹健康自检',
                            'Anti-Leak & Fingerprint Health Check',
                        )}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="outline"
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
                        content={t('查看关联代理日志', 'Inspect bound proxy logs')}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<DocumentTextRegular />}
                            aria-label={t('查看关联代理日志', 'Inspect bound proxy logs')}
                            onClick={() => onInspectProxyLogs(environment.proxyId!)}
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
                    <datalist id="env-detail-groups">
                        {groups.map((group) => (
                            <option key={group} value={group} />
                        ))}
                    </datalist>
                </Field>

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
                            {t('跟随默认 / 手动代理', 'Default / Manual')}
                        </option>
                        {managedProxies.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name} ({item.protocol.toUpperCase()})
                            </option>
                        ))}
                    </Select>
                </Field>

                {proxyId &&
                    (() => {
                        const sharedWith = allEnvironments.filter(
                            (item) =>
                                item.id !== environment.id &&
                                item.proxyId === proxyId,
                        );
                        if (sharedWith.length === 0) return null;
                        const names = sharedWith
                            .slice(0, 3)
                            .map((item) => item.name)
                            .join(isEn ? ', ' : '、');
                        return (
                            <MessageBar intent="warning" layout="multiline">
                                <MessageBarBody>
                                    {isEn
                                        ? `Also used by ${sharedWith.length} other profile(s) (${names}${sharedWith.length > 3 ? '…' : ''})`
                                        : `此代理已被其他 ${sharedWith.length} 个环境使用（${names}${sharedWith.length > 3 ? ' 等' : ''}），共用 IP 存在关联风险`}
                                </MessageBarBody>
                            </MessageBar>
                        );
                    })()}

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

                <div className={styles.metaBox}>
                    <Field
                        label={
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                }}
                            >
                                {t('浏览器', 'Browser')}
                                <InfoTip
                                    content={
                                        environment.isRunning
                                            ? t(
                                                  '环境运行中，关闭后方可切换浏览器',
                                                  'Close the environment before switching browser',
                                              )
                                            : browserEngine ===
                                                'fingerprint-chromium'
                                              ? hasFingerprintKernel
                                                  ? t(
                                                        '防关联浏览器为每个环境提供独立设备特征',
                                                        'Privacy Browser isolates device signatures per profile',
                                                    )
                                                  : t(
                                                        '尚未安装防关联浏览器，请先在「设置 → 组件」安装',
                                                        'Install Privacy Browser in Settings → Components first',
                                                    )
                                              : t(
                                                    '系统自带的标准 Google Chrome，适合重要主号',
                                                    'Standard Google Chrome, ideal for primary accounts',
                                                )
                                    }
                                />
                            </span>
                        }
                    >
                        <Select
                            disabled={environment.isRunning}
                            value={browserEngine}
                            onChange={(_, data) =>
                                setBrowserEngine(
                                    data.value as BrowserEngineType,
                                )
                            }
                        >
                            <option value="system-chrome">
                                {t('标准 Chrome', 'Standard Chrome')}
                            </option>
                            <option value="fingerprint-chromium">
                                {t('防关联浏览器', 'Privacy Browser')}
                            </option>
                        </Select>
                    </Field>

                    {browserEngine === 'fingerprint-chromium' && (
                        <>
                            {fingerprintConfig ? (
                                <>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: '6px',
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontSize: '12px',
                                                color: tokens.colorNeutralForeground2,
                                            }}
                                        >
                                            {fingerprintConfig.platform} ·{' '}
                                            {fingerprintConfig.brand} ·{' '}
                                            {
                                                fingerprintConfig.hardwareConcurrency
                                            }
                                            {t('核', 'c')}
                                        </span>
                                        <div
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                            }}
                                        >
                                            {onRegenerateFingerprint && (
                                                <Button
                                                    type="button"
                                                    size="small"
                                                    appearance="subtle"
                                                    disabled={
                                                        environment.isRunning ||
                                                        regenerating
                                                    }
                                                    icon={<ArrowSyncRegular />}
                                                    onClick={() =>
                                                        void handleRegenerate()
                                                    }
                                                >
                                                    {t('换新', 'New')}
                                                </Button>
                                            )}
                                            <Button
                                                type="button"
                                                size="small"
                                                appearance="subtle"
                                                icon={
                                                    showFpDetails ? (
                                                        <ChevronUpRegular />
                                                    ) : (
                                                        <ChevronDownRegular />
                                                    )
                                                }
                                                onClick={() =>
                                                    setShowFpDetails(
                                                        (prev) => !prev,
                                                    )
                                                }
                                            >
                                                {showFpDetails
                                                    ? t('收起', 'Hide')
                                                    : t('详情', 'Details')}
                                            </Button>
                                        </div>
                                    </div>

                                    {showFpDetails && (
                                        <>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    flexWrap: 'wrap',
                                                }}
                                            >
                                                <Badge
                                                    size="small"
                                                    appearance="tint"
                                                    color="brand"
                                                >
                                                    Seed #
                                                    {fingerprintConfig.seed}
                                                </Badge>
                                                <Badge
                                                    size="small"
                                                    appearance="outline"
                                                >
                                                    {
                                                        fingerprintConfig
                                                            .windowSize.width
                                                    }
                                                    ×
                                                    {
                                                        fingerprintConfig
                                                            .windowSize.height
                                                    }
                                                </Badge>
                                            </div>

                                            <Field
                                                label={t(
                                                    '模拟系统 / 品牌',
                                                    'OS / Brand',
                                                )}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        gap: '6px',
                                                    }}
                                                >
                                                    <Select
                                                        style={{ flex: 1 }}
                                                        disabled={
                                                            environment.isRunning
                                                        }
                                                        value={
                                                            fingerprintConfig.platform
                                                        }
                                                        onChange={(_, data) =>
                                                            setFingerprintConfig(
                                                                (prev) =>
                                                                    prev
                                                                        ? {
                                                                              ...prev,
                                                                              platform:
                                                                                  data.value as FingerprintPlatform,
                                                                          }
                                                                        : prev,
                                                            )
                                                        }
                                                    >
                                                        <option value="windows">
                                                            Windows
                                                        </option>
                                                        <option value="macos">
                                                            macOS
                                                        </option>
                                                        <option value="linux">
                                                            Linux
                                                        </option>
                                                    </Select>
                                                    <Select
                                                        style={{ flex: 1 }}
                                                        disabled={
                                                            environment.isRunning
                                                        }
                                                        value={
                                                            fingerprintConfig.brand
                                                        }
                                                        onChange={(_, data) =>
                                                            setFingerprintConfig(
                                                                (prev) =>
                                                                    prev
                                                                        ? {
                                                                              ...prev,
                                                                              brand: data.value as FingerprintBrand,
                                                                          }
                                                                        : prev,
                                                            )
                                                        }
                                                    >
                                                        <option value="Chrome">
                                                            Chrome
                                                        </option>
                                                        <option value="Edge">
                                                            Edge
                                                        </option>
                                                        <option value="Opera">
                                                            Opera
                                                        </option>
                                                        <option value="Vivaldi">
                                                            Vivaldi
                                                        </option>
                                                    </Select>
                                                </div>
                                            </Field>

                                            <div
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns:
                                                        '1fr 1fr',
                                                    gap: '4px 8px',
                                                }}
                                            >
                                                {(
                                                    [
                                                        [
                                                            'canvas',
                                                            t('画布', 'Canvas'),
                                                        ],
                                                        [
                                                            'audio',
                                                            t('音频', 'Audio'),
                                                        ],
                                                        [
                                                            'font',
                                                            t('字体', 'Fonts'),
                                                        ],
                                                        [
                                                            'clientrects',
                                                            t(
                                                                '布局',
                                                                'Layout',
                                                            ),
                                                        ],
                                                        [
                                                            'gpu',
                                                            t('显卡', 'GPU'),
                                                        ],
                                                    ] as const
                                                ).map(([key, label]) => (
                                                    <Switch
                                                        key={key}
                                                        disabled={
                                                            environment.isRunning
                                                        }
                                                        label={label}
                                                        checked={
                                                            fingerprintConfig
                                                                .spoofing[key]
                                                        }
                                                        onChange={(_, data) =>
                                                            setFingerprintConfig(
                                                                (prev) =>
                                                                    prev
                                                                        ? {
                                                                              ...prev,
                                                                              spoofing:
                                                                                  {
                                                                                      ...prev.spoofing,
                                                                                      [key]: data.checked,
                                                                                  },
                                                                          }
                                                                        : prev,
                                                            )
                                                        }
                                                    />
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </>
                            ) : (
                                <span
                                    style={{
                                        fontSize: '12px',
                                        color: tokens.colorNeutralForeground3,
                                    }}
                                >
                                    {t(
                                        '保存后将自动生成独立设备特征',
                                        'Unique device profile will be generated on save',
                                    )}
                                </span>
                            )}
                        </>
                    )}
                </div>

                <div>
                    <Button
                        type="button"
                        size="small"
                        appearance="subtle"
                        icon={
                            showAdvanced ? (
                                <ChevronUpRegular />
                            ) : (
                                <ChevronDownRegular />
                            )
                        }
                        iconPosition="after"
                        onClick={() => setShowAdvanced((prev) => !prev)}
                    >
                        {showAdvanced
                            ? t('收起高级设置', 'Hide Advanced')
                            : t(
                                  '高级设置（时区、语言、启动页）',
                                  'Advanced (Timezone, Language, URL)',
                              )}
                    </Button>
                </div>

                {showAdvanced && (
                    <div className={styles.metaBox}>
                        {!proxyId && (
                            <>
                                <Field
                                    label={t(
                                        '手动代理地址',
                                        'Manual Proxy Address',
                                    )}
                                >
                                    <Input
                                        disabled={environment.isRunning}
                                        placeholder="http://127.0.0.1:7890"
                                        value={proxy}
                                        onChange={(_, data) =>
                                            setProxy(data.value)
                                        }
                                    />
                                </Field>
                                <Field label={t('代理备注名', 'Proxy Label')}>
                                    <Input
                                        disabled={environment.isRunning}
                                        placeholder={t(
                                            '例如：美国节点',
                                            'e.g., US Node',
                                        )}
                                        value={proxyLabel}
                                        onChange={(_, data) =>
                                            setProxyLabel(data.value)
                                        }
                                    />
                                </Field>
                            </>
                        )}

                        <Field label={t('时区', 'Timezone')}>
                            <Input
                                placeholder="America/Los_Angeles"
                                list="env-detail-timezones"
                                value={timezone}
                                onChange={(_, data) =>
                                    setTimezone(data.value)
                                }
                            />
                            <datalist id="env-detail-timezones">
                                {COMMON_TIMEZONES.map((tz) => (
                                    <option key={tz} value={tz} />
                                ))}
                            </datalist>
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
                                    {t('语言', 'Language')}
                                    <InfoTip
                                        content={t(
                                            '填 auto 自动跟随代理地区，留空跟随全局设置',
                                            'Use "auto" to match proxy country; leave blank for global default',
                                        )}
                                    />
                                </span>
                            }
                        >
                            <Input
                                placeholder="auto / en-US"
                                list="env-detail-languages"
                                value={language}
                                onChange={(_, data) =>
                                    setLanguage(data.value)
                                }
                            />
                            <datalist id="env-detail-languages">
                                {COMMON_LANGUAGES.map((lang) => (
                                    <option key={lang} value={lang} />
                                ))}
                            </datalist>
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
                                    {t('专属启动页', 'Startup URL')}
                                    <InfoTip
                                        content={t(
                                            '优先于分组与全局启动页，留空则沿用上级设置',
                                            'Overrides group and global startup URL',
                                        )}
                                    />
                                </span>
                            }
                        >
                            <Input
                                placeholder="https://ippure.com/"
                                value={startupUrl}
                                onChange={(_, data) =>
                                    setStartupUrl(data.value)
                                }
                            />
                        </Field>
                    </div>
                )}

                <div className={styles.sectionLabel}>
                    {t('数据与信息', 'Storage & Info')}
                </div>
                <div className={styles.metaBox} data-selectable="true">
                    <div className={styles.metaRow}>
                        <span className={styles.metaKey}>
                            {t('环境 ID', 'Environment ID')}
                        </span>
                        <div className={styles.inlineCopyRow}>
                            <span
                                className={styles.metaVal}
                                style={{ flex: 1 }}
                            >
                                {environment.id}
                            </span>
                            <Tooltip
                                content={t('复制 ID', 'Copy ID')}
                                relationship="label"
                            >
                                <Button
                                    type="button"
                                    appearance="subtle"
                                    size="small"
                                    icon={<CopyRegular />}
                                    aria-label={t('复制环境 ID', 'Copy environment ID')}
                                    onClick={() =>
                                        void copyText(
                                            environment.id,
                                            t('环境 ID', 'Environment ID'),
                                        )
                                    }
                                />
                            </Tooltip>
                        </div>
                    </div>
                    <div className={styles.metaRow}>
                        <span className={styles.metaKey}>
                            {t('创建时间', 'Created At')}
                        </span>
                        <span className={styles.metaVal}>
                            {environment.createdAt
                                ? dayjs(environment.createdAt).format(
                                      'YYYY-MM-DD HH:mm:ss',
                                  )
                                : '-'}
                        </span>
                    </div>
                    <div className={styles.metaRow}>
                        <span className={styles.metaKey}>
                            {t('最近使用', 'Last Used')}
                        </span>
                        <span className={styles.metaVal}>
                            {environment.lastUsed
                                ? dayjs(environment.lastUsed).format(
                                      'YYYY-MM-DD HH:mm:ss',
                                  )
                                : '-'}
                        </span>
                    </div>
                    <div className={styles.metaRow}>
                        <span className={styles.metaKey}>
                            {t('占用空间', 'Disk Usage')}
                        </span>
                        <div className={styles.inlineCopyRow}>
                            <span
                                className={styles.metaVal}
                                style={{ flex: 1 }}
                            >
                                {loadingStorage
                                    ? t('统计中…', 'Calculating…')
                                    : storageStats
                                      ? isEn
                                          ? `${formatBytes(storageStats.totalBytes)} (${formatBytes(storageStats.cacheBytes)} cache)`
                                          : `${formatBytes(storageStats.totalBytes)}（可清缓存 ${formatBytes(storageStats.cacheBytes)}）`
                                      : '-'}
                            </span>
                            <Tooltip
                                content={
                                    environment.isRunning
                                        ? t(
                                              '请先关闭环境再清理缓存',
                                              'Close the environment before clearing cache',
                                          )
                                        : t(
                                              '清理 Cache/GPUCache（保留 Cookie 与登录态）',
                                              'Clear Cache/GPUCache (preserves cookies & sessions)',
                                          )
                                }
                                relationship="label"
                            >
                                <Button
                                    type="button"
                                    appearance="subtle"
                                    size="small"
                                    icon={<BroomRegular />}
                                    disabled={
                                        environment.isRunning ||
                                        clearingCache ||
                                        loadingStorage
                                    }
                                    onClick={() => void handleClearCache()}
                                >
                                    {clearingCache
                                        ? t('清理中…', 'Clearing…')
                                        : t('清缓存', 'Clear Cache')}
                                </Button>
                            </Tooltip>
                        </div>
                    </div>
                    <div className={styles.metaRow}>
                        <span className={styles.metaKey}>
                            {t('用户数据目录', 'User Data Directory')}
                        </span>
                        <div className={styles.inlineCopyRow}>
                            <span
                                className={styles.metaVal}
                                style={{ flex: 1 }}
                            >
                                {environment.dataDir || '-'}
                            </span>
                            <Tooltip
                                content={t(
                                    '在文件管理器中打开目录',
                                    'Open in file explorer',
                                )}
                                relationship="label"
                            >
                                <Button
                                    type="button"
                                    appearance="subtle"
                                    size="small"
                                    icon={<FolderOpenRegular />}
                                    aria-label={t(
                                        '打开用户数据目录',
                                        'Open user data directory',
                                    )}
                                    onClick={() => void handleOpenDataDir()}
                                />
                            </Tooltip>
                        </div>
                    </div>
                </div>
            </form>

            <div className={styles.footer}>
                <span className={styles.dirtyHint}>
                    {isDirty
                        ? t('有未保存更改', 'Unsaved changes')
                        : t('已与本地同步', 'Synced locally')}
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                        type="button"
                        size="small"
                        appearance="secondary"
                        disabled={!isDirty || saving}
                        onClick={handleReset}
                    >
                        {t('还原', 'Reset')}
                    </Button>
                    <Button
                        type="submit"
                        form="env-details-form"
                        size="small"
                        appearance="primary"
                        disabled={!isDirty || saving}
                    >
                        {saving
                            ? t('保存中…', 'Saving…')
                            : t('保存更改', 'Save')}
                    </Button>
                </div>
            </div>
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
