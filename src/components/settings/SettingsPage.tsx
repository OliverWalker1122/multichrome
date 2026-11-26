import { useDraftField } from '../../hooks/useDraftField';
import { moveTabFocus } from '../../utils/tabKeyboard';
import React, { useLayoutEffect, useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    MessageBar,
    MessageBarBody,
    mergeClasses,
} from '@fluentui/react-components';
import {
    BoxRegular,
    InfoRegular,
    PlugConnectedRegular,
    SettingsRegular,
    ShieldCheckmarkRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import type {
    AppSettings,
    BookmarkTemplate,
    DefaultFingerprintSettings,
    ExtensionTemplate,
    KernelStatus,
    ManagedProxy,
    ProxyCoreInfo,
    ThemeMode,
} from '../../types';
import { useNotification } from '../../contexts/NotificationContext';
import { translateBackendMessage, useI18n } from '../../i18n';
import { systemApi } from '../../services';
import AboutSettingsPanel from './AboutSettingsPanel';
import AutomationSettingsPanel from './AutomationSettingsPanel';
import BrowserSettingsSection from './BrowserSettingsSection';
import ComponentsSettingsPanel from './ComponentsSettingsPanel';
import GeneralSettingsSection from './GeneralSettingsSection';
import PrivacySettingsSection from './PrivacySettingsSection';
import { cleanIpcError, normalizeFpState } from './settingsShared';
import { useSettingsStyles } from './settingsStyles';

export type SettingsTab =
    | 'general'
    | 'browser'
    | 'privacy'
    | 'automation'
    | 'components'
    | 'about';

export interface SettingsPageProps {
    currentSettings: AppSettings;
    onSave: (settings: AppSettings) => Promise<boolean>;
    onThemePreview: (theme: ThemeMode) => Promise<void>;
    onDraftStateChange: (dirty: boolean) => void;
    leaveRequested: boolean;
    onLeave: () => void;
    onKeepEditing: () => void;
    coreInfo: ProxyCoreInfo | null;
    appVersion: string;
    managedProxies: ManagedProxy[];
    groups?: string[];
    kernelStatus: KernelStatus | null;
    onKernelStatusChange: (status: KernelStatus) => void;
    activeTab: SettingsTab;
    onTabChange: (tab: SettingsTab) => void;
    onDataRestored?: () => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({
    currentSettings,
    onSave,
    onThemePreview,
    onDraftStateChange,
    leaveRequested,
    onLeave,
    onKeepEditing,
    coreInfo,
    appVersion,
    managedProxies,
    groups = [],
    kernelStatus,
    onKernelStatusChange,
    activeTab,
    onTabChange,
    onDataRestored,
}) => {
    const styles = useSettingsStyles();
    const { locale, t } = useI18n();
    const { showNotification } = useNotification();
    const hostPlatform = systemApi.getPlatform() || 'win32';

    const [dataPath, setDataPath] = useDraftField(currentSettings.dataPath || '');
    const [proxyEnabled, setProxyEnabled] = useDraftField(
        Boolean(currentSettings.globalProxy?.enabled),
    );
    const [proxyAddress, setProxyAddress] = useDraftField(
        currentSettings.globalProxy?.address || '',
    );
    const [startupUrl, setStartupUrl] = useDraftField(
        currentSettings.startupUrl || '',
    );
    const [theme, setTheme] = useDraftField<ThemeMode>(
        currentSettings.theme || 'system',
    );
    const [memorySaverMode, setMemorySaverMode] = useDraftField(
        Boolean(currentSettings.memorySaverMode),
    );
    const [bookmarkTemplates, setBookmarkTemplates] = useDraftField<
        BookmarkTemplate[]
    >(currentSettings.bookmarkTemplates || []);
    const [extensionTemplates, setExtensionTemplates] = useDraftField<
        ExtensionTemplate[]
    >(currentSettings.extensionTemplates || []);
    const [
        allowExtensionsOnFingerprintKernel,
        setAllowExtensionsOnFingerprintKernel,
    ] = useDraftField(Boolean(currentSettings.allowExtensionsOnFingerprintKernel));
    const [requireHealthCheckOnLaunch, setRequireHealthCheckOnLaunch] =
        useDraftField(Boolean(currentSettings.requireHealthCheckOnLaunch));
    const [groupStartupUrls, setGroupStartupUrls] = useDraftField<
        Record<string, string>
    >(currentSettings.groupStartupUrls || {});
    const [fingerprint, setFingerprint] = useDraftField<DefaultFingerprintSettings>(
        normalizeFpState(currentSettings.fingerprint),
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const baselineFp = normalizeFpState(currentSettings.fingerprint);
    const isDirty =
        dataPath.trim() !== (currentSettings.dataPath || '') ||
        proxyEnabled !== Boolean(currentSettings.globalProxy?.enabled) ||
        proxyAddress.trim() !== (currentSettings.globalProxy?.address || '') ||
        startupUrl.trim() !== (currentSettings.startupUrl || '') ||
        theme !== (currentSettings.theme || 'system') ||
        memorySaverMode !== Boolean(currentSettings.memorySaverMode) ||
        allowExtensionsOnFingerprintKernel !==
            Boolean(currentSettings.allowExtensionsOnFingerprintKernel) ||
        requireHealthCheckOnLaunch !==
            Boolean(currentSettings.requireHealthCheckOnLaunch) ||
        JSON.stringify(bookmarkTemplates) !==
            JSON.stringify(currentSettings.bookmarkTemplates || []) ||
        JSON.stringify(extensionTemplates) !==
            JSON.stringify(currentSettings.extensionTemplates || []) ||
        JSON.stringify(groupStartupUrls) !==
            JSON.stringify(currentSettings.groupStartupUrls || {}) ||
        JSON.stringify(fingerprint) !== JSON.stringify(baselineFp);

    useLayoutEffect(() => {
        onDraftStateChange(isDirty || saving);
    }, [isDirty, saving, onDraftStateChange]);

    const hasActiveKernel = Boolean(
        (kernelStatus?.installedKernels || []).find(
            (k) => k.id === kernelStatus?.activeKernelId,
        ),
    );

    const handleSelectFolder = async () => {
        try {
            if (!systemApi.hasSettingsApi()) return;
            const result = await systemApi.selectFolder();
            if (result && !result.canceled && result.filePaths.length > 0) {
                setDataPath(result.filePaths[0]);
                setError('');
            }
        } catch {
            setError(
                t(
                    '选择目录失败，请手动输入路径。',
                    'Failed to select folder. Enter the path manually.',
                ),
            );
        }
    };

    const handleReset = () => {
        setDataPath(currentSettings.dataPath || '');
        setProxyEnabled(Boolean(currentSettings.globalProxy?.enabled));
        setProxyAddress(currentSettings.globalProxy?.address || '');
        setStartupUrl(currentSettings.startupUrl || '');
        setTheme(currentSettings.theme || 'system');
        setMemorySaverMode(Boolean(currentSettings.memorySaverMode));
        setBookmarkTemplates(currentSettings.bookmarkTemplates || []);
        setExtensionTemplates(currentSettings.extensionTemplates || []);
        setAllowExtensionsOnFingerprintKernel(
            Boolean(currentSettings.allowExtensionsOnFingerprintKernel),
        );
        setRequireHealthCheckOnLaunch(
            Boolean(currentSettings.requireHealthCheckOnLaunch),
        );
        setGroupStartupUrls(currentSettings.groupStartupUrls || {});
        setFingerprint(normalizeFpState(currentSettings.fingerprint));
        setError('');
    };

    const handleSave = async () => {
        if (saving) return false;
        if (!dataPath.trim()) {
            onTabChange('general');
            setError(t('数据目录不能为空', 'Data directory cannot be empty'));
            return false;
        }
        if (proxyEnabled && !proxyAddress.trim()) {
            onTabChange('privacy');
            setError(
                t(
                    '已开启全局备用代理，请填写代理地址或关闭开关',
                    'Enter a fallback proxy address or turn the switch off',
                ),
            );
            return false;
        }

        try {
            setSaving(true);
            setError('');
            const ok = await onSave({
                dataPath: dataPath.trim(),
                globalProxy: {
                    enabled: proxyEnabled,
                    address: proxyAddress.trim(),
                },
                startupUrl: startupUrl.trim(),
                theme,
                locale,
                memorySaverMode,
                bookmarkTemplates,
                extensionTemplates,
                allowExtensionsOnFingerprintKernel,
                requireHealthCheckOnLaunch,
                groupStartupUrls,
                fingerprint,
            });
            if (ok) {
                showNotification('success', t('设置已保存', 'Settings saved'));
            } else {
                setError(
                    t(
                        '保存失败，请检查数据目录是否有写入权限',
                        'Save failed. Check folder write permissions.',
                    ),
                );
            }
            return ok;
        } catch (err) {
            setError(cleanIpcError(err, locale));
            return false;
        } finally {
            setSaving(false);
        }
    };

    const tabs: Array<{
        id: SettingsTab;
        label: string;
        icon: React.ReactNode;
        dot?: boolean;
    }> = [
        {
            id: 'general',
            label: t('常规', 'General'),
            icon: <SettingsRegular />,
        },
        {
            id: 'browser',
            label: t('浏览器', 'Browser'),
            icon: <WindowMultipleRegular />,
        },
        {
            id: 'privacy',
            label: t('隐私', 'Privacy'),
            icon: <ShieldCheckmarkRegular />,
        },
        {
            id: 'automation',
            label: t('自动化与 MCP', 'Automation & MCP'),
            icon: <PlugConnectedRegular />,
        },
        {
            id: 'components',
            label: t('组件', 'Components'),
            icon: <BoxRegular />,
            dot: Boolean(kernelStatus?.updateSummary?.hasAnyUpdate),
        },
        { id: 'about', label: t('关于', 'About'), icon: <InfoRegular /> },
    ];

    const showFormHeaderActions =
        isDirty ||
        activeTab === 'general' ||
        activeTab === 'browser' ||
        activeTab === 'privacy';

    return (
        <section className={styles.root} aria-label={t('设置', 'Settings')}>
            <div className={styles.header}>
                <div className={styles.headerTop}>
                    <h1 className={styles.title}>{t('设置', 'Settings')}</h1>
                    {showFormHeaderActions && (
                        <div className={styles.headerActions}>
                            {isDirty && (
                                <Button
                                    type="button"
                                    appearance="secondary"
                                    disabled={saving}
                                    onClick={handleReset}
                                >
                                    {t('还原', 'Reset')}
                                </Button>
                            )}
                            <Button
                                type="submit"
                                form="app-settings-form"
                                appearance="primary"
                                disabled={!isDirty || saving}
                            >
                                {saving
                                    ? t('保存中…', 'Saving…')
                                    : isDirty
                                      ? t('保存设置', 'Save')
                                      : t('已保存', 'Saved')}
                            </Button>
                        </div>
                    )}
                </div>

                <div
                    className={styles.pillTabsBar}
                    role="tablist" onKeyDown={moveTabFocus}
                    aria-label={t('设置分类', 'Settings sections')}
                >
                    {tabs.map((tab) => {
                        const active = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                role="tab"
                                id={`settings-tab-${tab.id}`} aria-controls="settings-content"
                                aria-selected={active} tabIndex={active ? 0 : -1}
                                data-testid={`settings-tab-${tab.id}`}
                                className={mergeClasses(
                                    styles.pillTab,
                                    active && styles.pillTabActive,
                                )}
                                onClick={() => onTabChange(tab.id)}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                                {tab.dot && (
                                    <span
                                        className={styles.tabDot}
                                        aria-hidden="true"
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <form
                id="app-settings-form"
                className={styles.body}
                onSubmit={(event) => { event.preventDefault(); void handleSave(); }}
            >
                <div id="settings-content" role="tabpanel" aria-labelledby={`settings-tab-${activeTab}`} className={styles.container}>
                    {error && (
                        <MessageBar intent="error" layout="multiline">
                            <MessageBarBody>
                                {translateBackendMessage(error, locale)}
                            </MessageBarBody>
                        </MessageBar>
                    )}

                    {activeTab === 'general' && (
                        <GeneralSettingsSection
                            dataPath={dataPath}
                            onDataPathChange={(next) => {
                                setDataPath(next);
                                setError('');
                            }}
                            onSelectFolder={() => void handleSelectFolder()}
                            coreInfo={coreInfo}
                            theme={theme}
                            onThemeChange={(next) => {
                                setTheme(next);
                                void onThemePreview(next);
                            }}
                            onDataRestored={onDataRestored}
                        />
                    )}

                    {activeTab === 'browser' && (
                        <BrowserSettingsSection
                            defaultEngine={fingerprint.defaultEngine}
                            hasActiveKernel={hasActiveKernel}
                            onDefaultEngineChange={(defaultEngine) =>
                                setFingerprint((prev) => ({
                                    ...prev,
                                    defaultEngine,
                                }))
                            }
                            memorySaverMode={memorySaverMode}
                            onMemorySaverModeChange={setMemorySaverMode}
                            startupUrl={startupUrl}
                            onStartupUrlChange={setStartupUrl}
                            groups={groups}
                            groupStartupUrls={groupStartupUrls}
                            onGroupStartupUrlsChange={setGroupStartupUrls}
                            bookmarkTemplates={bookmarkTemplates}
                            onBookmarkTemplatesChange={setBookmarkTemplates}
                            extensionTemplates={extensionTemplates}
                            onExtensionTemplatesChange={setExtensionTemplates}
                            allowExtensionsOnFingerprintKernel={
                                allowExtensionsOnFingerprintKernel
                            }
                            onAllowExtensionsOnFingerprintKernelChange={
                                setAllowExtensionsOnFingerprintKernel
                            }
                        />
                    )}

                    {activeTab === 'privacy' && (
                        <PrivacySettingsSection
                            requireHealthCheckOnLaunch={
                                requireHealthCheckOnLaunch
                            }
                            onRequireHealthCheckOnLaunchChange={
                                setRequireHealthCheckOnLaunch
                            }
                            proxyEnabled={proxyEnabled}
                            onProxyEnabledChange={setProxyEnabled}
                            proxyAddress={proxyAddress}
                            onProxyAddressChange={setProxyAddress}
                            fingerprint={fingerprint}
                            onFingerprintChange={setFingerprint}
                            hostPlatform={hostPlatform}
                        />
                    )}

                    {activeTab === 'automation' && <AutomationSettingsPanel />}

                    {activeTab === 'components' && (
                        <ComponentsSettingsPanel
                            coreInfo={coreInfo}
                            kernelStatus={kernelStatus}
                            onKernelStatusChange={onKernelStatusChange}
                            managedProxies={managedProxies}
                            fallbackProxyEnabled={proxyEnabled}
                            fallbackProxyAddress={proxyAddress}
                        />
                    )}

                    {activeTab === 'about' && (
                        <AboutSettingsPanel
                            appVersion={appVersion}
                            hostPlatform={hostPlatform}
                        />
                    )}
                </div>
            </form>
            {leaveRequested && (
                <Dialog open modalType="alert" onOpenChange={(_, data) => { if (!data.open && !saving) onKeepEditing(); }}>
                    <DialogSurface>
                        <DialogBody>
                            <DialogTitle>{t('保存设置后离开？', 'Save settings before leaving?')}</DialogTitle>
                            <DialogContent>{t('当前设置有未保存的修改。', 'You have unsaved settings.')}</DialogContent>
                            <DialogActions>
                                <Button disabled={saving} onClick={onKeepEditing}>{t('继续编辑', 'Keep editing')}</Button>
                                <Button disabled={saving} onClick={onLeave}>{t('放弃修改', 'Discard changes')}</Button>
                                <Button appearance="primary" disabled={saving} onClick={async () => {
                                    if (await handleSave()) onLeave();
                                    else onKeepEditing();
                                }}>{saving ? t('正在保存…', 'Saving…') : t('保存并离开', 'Save and leave')}</Button>
                            </DialogActions>
                        </DialogBody>
                    </DialogSurface>
                </Dialog>
            )}
        </section>
    );
};

export default SettingsPage;
