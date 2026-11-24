import React, { useState } from 'react';
import { Button, Input, Select, Switch } from '@fluentui/react-components';
import {
    AddRegular,
    BoxRegular,
    DeleteRegular,
    DesktopRegular,
    FolderOpenRegular,
    GlobeRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import type {
    BookmarkTemplate,
    BrowserEngineType,
    ExtensionTemplate,
} from '../../types';
import { useNotification } from '../../contexts/NotificationContext';
import { getToneStyle } from '../../theme/semanticColors';
import { useI18n } from '../../i18n';
import { systemApi } from '../../services';
import InfoTip from '../common/InfoTip';
import { QUICK_STARTUP_URLS } from './settingsShared';
import { useSettingsStyles } from './settingsStyles';

export interface BrowserSettingsSectionProps {
    defaultEngine: BrowserEngineType;
    hasActiveKernel: boolean;
    onDefaultEngineChange: (engine: BrowserEngineType) => void;
    memorySaverMode: boolean;
    onMemorySaverModeChange: (enabled: boolean) => void;
    startupUrl: string;
    onStartupUrlChange: (url: string) => void;
    groups: string[];
    groupStartupUrls: Record<string, string>;
    onGroupStartupUrlsChange: React.Dispatch<
        React.SetStateAction<Record<string, string>>
    >;
    bookmarkTemplates: BookmarkTemplate[];
    onBookmarkTemplatesChange: React.Dispatch<
        React.SetStateAction<BookmarkTemplate[]>
    >;
    extensionTemplates: ExtensionTemplate[];
    onExtensionTemplatesChange: React.Dispatch<
        React.SetStateAction<ExtensionTemplate[]>
    >;
    allowExtensionsOnFingerprintKernel: boolean;
    onAllowExtensionsOnFingerprintKernelChange: (enabled: boolean) => void;
}

const BrowserSettingsSection: React.FC<BrowserSettingsSectionProps> = ({
    defaultEngine,
    hasActiveKernel,
    onDefaultEngineChange,
    memorySaverMode,
    onMemorySaverModeChange,
    startupUrl,
    onStartupUrlChange,
    groups,
    groupStartupUrls,
    onGroupStartupUrlsChange,
    bookmarkTemplates,
    onBookmarkTemplatesChange,
    extensionTemplates,
    onExtensionTemplatesChange,
    allowExtensionsOnFingerprintKernel,
    onAllowExtensionsOnFingerprintKernelChange,
}) => {
    const styles = useSettingsStyles();
    const { isEn, t } = useI18n();
    const { showNotification } = useNotification();

    const [newBmName, setNewBmName] = useState('');
    const [newBmUrl, setNewBmUrl] = useState('');
    const [newBmFolder, setNewBmFolder] = useState('');
    const [newGroupKey, setNewGroupKey] = useState('');
    const [newGroupUrl, setNewGroupUrl] = useState('');

    const validateHttpOrHttps = (rawUrl: string): boolean => {
        try {
            const parsed = new URL(rawUrl);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    };

    const handleAddBookmarkTemplate = () => {
        const name = newBmName.trim();
        const url = newBmUrl.trim();
        const folder = newBmFolder.trim();
        if (!name || !url) {
            showNotification(
                'warning',
                t('请填写书签名称和网址', 'Enter both name and URL'),
            );
            return;
        }
        if (!validateHttpOrHttps(url)) {
            showNotification(
                'error',
                t(
                    '网址需以 http:// 或 https:// 开头',
                    'URL must start with http:// or https://',
                ),
            );
            return;
        }
        onBookmarkTemplatesChange((prev) => [
            ...prev,
            {
                id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                name,
                url,
                ...(folder ? { folder } : {}),
            },
        ]);
        setNewBmName('');
        setNewBmUrl('');
        setNewBmFolder('');
    };

    const handleAddGroupStartupUrl = () => {
        const groupKey = newGroupKey.trim();
        const url = newGroupUrl.trim();
        if (!groupKey || !url) {
            showNotification(
                'warning',
                t('请选择分组并填写网址', 'Select a group and enter a URL'),
            );
            return;
        }
        if (!validateHttpOrHttps(url)) {
            showNotification(
                'error',
                t(
                    '网址需以 http:// 或 https:// 开头',
                    'URL must start with http:// or https://',
                ),
            );
            return;
        }
        onGroupStartupUrlsChange((prev) => ({
            ...prev,
            [groupKey]: url,
        }));
        setNewGroupKey('');
        setNewGroupUrl('');
    };

    const handleAddExtensionFolder = async () => {
        try {
            if (!systemApi.hasSettingsApi()) return;
            const result = await systemApi.selectFolder();
            if (!result || result.canceled || result.filePaths.length === 0) {
                return;
            }
            const dirPath = result.filePaths[0];
            if (extensionTemplates.some((item) => item.path === dirPath)) {
                showNotification(
                    'info',
                    t('该扩展已在列表中', 'Extension already added'),
                );
                return;
            }
            const parts = dirPath.split(/[/\\]/).filter(Boolean);
            const name = parts[parts.length - 1] || dirPath;
            onExtensionTemplatesChange((prev) => [
                ...prev,
                {
                    id: `ext-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    name,
                    path: dirPath,
                    enabled: true,
                },
            ]);
            showNotification(
                'success',
                isEn
                    ? `Added "${name}". Click Save to apply.`
                    : `已添加「${name}」，点击「保存设置」生效`,
            );
        } catch {
            showNotification(
                'error',
                t('选择扩展目录失败', 'Failed to select extension folder'),
            );
        }
    };

    return (
        <>
            <div className={styles.card}>
                <div className={styles.cardTitleGroup}>
                    <DesktopRegular
                        className={styles.sectionIcon}
                        style={getToneStyle('blue')}
                    />
                    <h2 className={styles.cardTitle}>
                        {t('默认行为', 'Defaults')}
                    </h2>
                </div>

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('默认浏览器', 'Default Browser')}
                        <InfoTip
                            content={
                                hasActiveKernel
                                    ? t(
                                          '新建环境时默认使用的浏览器类型，可在单个环境中随时切换',
                                          'Default browser used for new profiles; can be overridden per profile.',
                                      )
                                    : t(
                                          '防关联浏览器尚未安装，请先到「组件」中安装',
                                          'Privacy browser is not installed yet. Install it in Components.',
                                      )
                            }
                        />
                    </span>
                    <Select
                        style={{ minWidth: '220px' }}
                        value={defaultEngine}
                        onChange={(_, data) =>
                            onDefaultEngineChange(
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
                </div>

                <div className={styles.divider} />

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('省内存模式', 'Memory Saver')}
                        <InfoTip
                            content={t(
                                '同时打开多个窗口时自动限制后台标签与缓存占用，不影响网页正常使用与伪装效果',
                                'Limits background renderer and cache memory when running multiple profiles without affecting privacy signals.',
                            )}
                        />
                    </span>
                    <Switch
                        checked={memorySaverMode}
                        onChange={(_, data) =>
                            onMemorySaverModeChange(data.checked)
                        }
                    />
                </div>
            </div>

            <div className={styles.card}>
                <div className={styles.cardTitleGroup}>
                    <GlobeRegular
                        className={styles.sectionIcon}
                        style={getToneStyle('teal')}
                    />
                    <h2 className={styles.cardTitle}>
                        {t('启动页', 'Startup Page')}
                    </h2>
                    <InfoTip
                        content={t(
                            '首次打开环境时自动访问的网址；已有未关闭标签页时不会重复打开。优先级：单环境 > 分组 > 全局默认',
                            'Opened on first launch without duplicating restored tabs. Priority: Profile > Group > Global.',
                        )}
                    />
                </div>

                <Input
                    value={startupUrl}
                    placeholder={t(
                        '输入默认打开的网址（留空则打开空白页）',
                        'Default startup URL (leave blank for new tab)',
                    )}
                    onChange={(_, data) => onStartupUrlChange(data.value)}
                />
                <div className={styles.chipsRow}>
                    {QUICK_STARTUP_URLS.map((preset) => (
                        <Button
                            key={preset.url || 'empty'}
                            type="button"
                            size="small"
                            appearance={
                                startupUrl.trim() === preset.url
                                    ? 'primary'
                                    : 'subtle'
                            }
                            onClick={() => onStartupUrlChange(preset.url)}
                        >
                            {isEn ? preset.en : preset.zh}
                        </Button>
                    ))}
                </div>

                <div className={styles.divider} />

                <span className={styles.rowLabel}>
                    {t('分组专属启动页', 'Per-Group Startup Page')}
                    <InfoTip
                        content={t(
                            '为特定分组设置单独的启动网址，覆盖全局默认启动页',
                            'Override the global startup URL for a specific group.',
                        )}
                    />
                </span>
                <div className={styles.inlineAddRow}>
                    <Input
                        style={{ flex: 1, minWidth: '130px' }}
                        placeholder={t('分组名', 'Group')}
                        list="settings-group-startup-list"
                        value={newGroupKey}
                        onChange={(_, d) => setNewGroupKey(d.value)}
                    />
                    <datalist id="settings-group-startup-list">
                        {groups.map((g) => (
                            <option key={g} value={g} />
                        ))}
                    </datalist>
                    <Input
                        style={{ flex: 2, minWidth: '200px' }}
                        placeholder="https://example.com/"
                        value={newGroupUrl}
                        onChange={(_, d) => setNewGroupUrl(d.value)}
                    />
                    <Button
                        type="button"
                        appearance="outline"
                        icon={<AddRegular />}
                        onClick={handleAddGroupStartupUrl}
                    >
                        {t('添加', 'Add')}
                    </Button>
                </div>
                {Object.keys(groupStartupUrls).length > 0 && (
                    <div className={styles.listStack}>
                        {Object.entries(groupStartupUrls).map(
                            ([groupKey, url]) => (
                                <div key={groupKey} className={styles.listItem}>
                                    <div className={styles.listItemMain}>
                                        <span className={styles.listItemTitle}>
                                            {groupKey}
                                        </span>
                                        <span className={styles.listItemSub}>
                                            {url}
                                        </span>
                                    </div>
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        icon={<DeleteRegular />}
                                        aria-label={t(
                                            `移除 ${groupKey}`,
                                            `Remove ${groupKey}`,
                                        )}
                                        onClick={() =>
                                            onGroupStartupUrlsChange((prev) => {
                                                const next = { ...prev };
                                                delete next[groupKey];
                                                return next;
                                            })
                                        }
                                    />
                                </div>
                            ),
                        )}
                    </div>
                )}
            </div>

            <div className={styles.card}>
                <div className={styles.cardTitleGroup}>
                    <WindowMultipleRegular
                        className={styles.sectionIcon}
                        style={getToneStyle('blue')}
                    />
                    <h2 className={styles.cardTitle}>
                        {t('常用书签', 'Bookmarks')}
                    </h2>
                    <InfoTip
                        content={t(
                            '启动任意环境前自动添加到书签栏，按网址去重，不会覆盖已有书签',
                            'Automatically added to the bookmarks bar on launch without overwriting existing bookmarks.',
                        )}
                    />
                </div>

                <div className={styles.inlineAddRow}>
                    <Input
                        style={{ flex: 1, minWidth: '120px' }}
                        placeholder={t('名称', 'Name')}
                        value={newBmName}
                        onChange={(_, d) => setNewBmName(d.value)}
                    />
                    <Input
                        style={{ flex: 2, minWidth: '180px' }}
                        placeholder="https://example.com/"
                        value={newBmUrl}
                        onChange={(_, d) => setNewBmUrl(d.value)}
                    />
                    <Input
                        style={{ flex: 1, minWidth: '100px' }}
                        placeholder={t('文件夹（可选）', 'Folder (opt.)')}
                        value={newBmFolder}
                        onChange={(_, d) => setNewBmFolder(d.value)}
                    />
                    <Button
                        type="button"
                        appearance="outline"
                        icon={<AddRegular />}
                        onClick={handleAddBookmarkTemplate}
                    >
                        {t('添加', 'Add')}
                    </Button>
                </div>

                {bookmarkTemplates.length > 0 && (
                    <div className={styles.listStack}>
                        {bookmarkTemplates.map((bm) => (
                            <div key={bm.id} className={styles.listItem}>
                                <div className={styles.listItemMain}>
                                    <span className={styles.listItemTitle}>
                                        {bm.folder ? `[${bm.folder}] ` : ''}
                                        {bm.name}
                                    </span>
                                    <span className={styles.listItemSub}>
                                        {bm.url}
                                    </span>
                                </div>
                                <Button
                                    type="button"
                                    size="small"
                                    appearance="subtle"
                                    icon={<DeleteRegular />}
                                    aria-label={t(
                                        `删除书签 ${bm.name}`,
                                        `Remove bookmark ${bm.name}`,
                                    )}
                                    onClick={() =>
                                        onBookmarkTemplatesChange((prev) =>
                                            prev.filter(
                                                (item) => item.id !== bm.id,
                                            ),
                                        )
                                    }
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className={styles.card}>
                <div className={styles.cardHeader}>
                    <div className={styles.cardTitleGroup}>
                        <BoxRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('violet')}
                        />
                        <h2 className={styles.cardTitle}>
                            {t('本地扩展', 'Extensions')}
                        </h2>
                        <InfoTip
                            content={t(
                                '添加本地解压后的扩展文件夹（含 manifest.json），启动时自动加载。默认仅在标准 Chrome 中生效以保持防关联浏览器纯净',
                                'Load unpacked extension folders (containing manifest.json) automatically. Enabled on standard Chrome by default to keep privacy browsers clean.',
                            )}
                        />
                    </div>
                    <Button
                        type="button"
                        size="small"
                        appearance="outline"
                        icon={<FolderOpenRegular />}
                        onClick={() => void handleAddExtensionFolder()}
                    >
                        {t('添加扩展', 'Add Extension')}
                    </Button>
                </div>

                {extensionTemplates.length > 0 && (
                    <>
                        <div className={styles.listStack}>
                            {extensionTemplates.map((ext) => (
                                <div key={ext.id} className={styles.listItem}>
                                    <div className={styles.listItemMain}>
                                        <span className={styles.listItemTitle}>
                                            {ext.name}
                                        </span>
                                        <span className={styles.listItemSub}>
                                            {ext.path}
                                        </span>
                                    </div>
                                    <Switch
                                        checked={ext.enabled}
                                        onChange={(_, d) =>
                                            onExtensionTemplatesChange((prev) =>
                                                prev.map((item) =>
                                                    item.id === ext.id
                                                        ? {
                                                              ...item,
                                                              enabled:
                                                                  d.checked,
                                                          }
                                                        : item,
                                                ),
                                            )
                                        }
                                    />
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        icon={<DeleteRegular />}
                                        aria-label={t(
                                            `删除扩展 ${ext.name}`,
                                            `Remove extension ${ext.name}`,
                                        )}
                                        onClick={() =>
                                            onExtensionTemplatesChange((prev) =>
                                                prev.filter(
                                                    (item) =>
                                                        item.id !== ext.id,
                                                ),
                                            )
                                        }
                                    />
                                </div>
                            ))}
                        </div>

                        <div className={styles.row}>
                            <span className={styles.rowLabel}>
                                {t(
                                    '防关联浏览器也加载扩展',
                                    'Also load on Privacy Browser',
                                )}
                                <InfoTip
                                    content={t(
                                        '开启后防关联浏览器也会加载上述扩展，可能增加被网站检测的风险，建议按需开启',
                                        'Loading unpacked extensions in the privacy browser may increase detection surface.',
                                    )}
                                />
                            </span>
                            <Switch
                                checked={allowExtensionsOnFingerprintKernel}
                                onChange={(_, d) =>
                                    onAllowExtensionsOnFingerprintKernelChange(
                                        d.checked,
                                    )
                                }
                            />
                        </div>
                    </>
                )}
            </div>
        </>
    );
};

export default BrowserSettingsSection;
