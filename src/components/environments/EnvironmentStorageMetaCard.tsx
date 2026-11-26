import React from 'react';
import { Button, Tooltip } from '@fluentui/react-components';
import {
    ArrowDownloadRegular,
    ArrowUploadRegular,
    BroomRegular,
    CopyRegular,
    FolderOpenRegular,
} from '@fluentui/react-icons';
import dayjs from 'dayjs';
import type { ChromeEnvironment, EnvironmentStorageStats } from '../../types';
import { useI18n } from '../../i18n';
import type { EnvironmentDetailsStyles } from './environmentDetailsStyles';

export function formatStorageBytes(bytes: number): string {
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

export interface EnvironmentStorageMetaCardProps {
    styles: EnvironmentDetailsStyles;
    environment: ChromeEnvironment;
    loadingStorage: boolean;
    onRetryStorage: () => void;
    storageStats: EnvironmentStorageStats | null;
    clearingCache: boolean;
    onCopyId: () => void;
    onClearCache: () => void;
    onOpenDataDir: () => void;
    onOpenCookieImport?: () => void;
    onOpenCookieExport?: () => void;
}

const EnvironmentStorageMetaCard: React.FC<EnvironmentStorageMetaCardProps> = ({
    styles,
    environment,
    loadingStorage,
    onRetryStorage,
    storageStats,
    clearingCache,
    onCopyId,
    onClearCache,
    onOpenDataDir,
    onOpenCookieImport,
    onOpenCookieExport,
}) => {
    const { isEn, t } = useI18n();

    return (
        <>
            <div className={styles.sectionLabel}>
                {t('数据与信息', 'Storage & Info')}
            </div>
            <div className={styles.metaBox} data-selectable="true">
                <div className={styles.metaRow}>
                    <span className={styles.metaKey}>
                        {t('环境 ID', 'Environment ID')}
                    </span>
                    <div className={styles.inlineCopyRow}>
                        <span className={styles.metaVal} style={{ flex: 1 }}>
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
                                aria-label={t(
                                    '复制环境 ID',
                                    'Copy environment ID',
                                )}
                                onClick={onCopyId}
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
                        <span className={styles.metaVal} style={{ flex: 1 }}>
                            {loadingStorage
                                ? t('统计中…', 'Calculating…')
                                : storageStats
                                  ? isEn
                                      ? `${formatStorageBytes(storageStats.totalBytes)} (${formatStorageBytes(storageStats.cacheBytes)} cache)`
                                      : `${formatStorageBytes(storageStats.totalBytes)}（可清缓存 ${formatStorageBytes(storageStats.cacheBytes)}）`
                                  : t('无法读取', 'Unavailable')}
                        </span>
                        {!loadingStorage && !storageStats && (
                            <Button type="button" appearance="subtle" size="small" onClick={onRetryStorage}>{t('重试', 'Retry')}</Button>
                        )}
                        <Tooltip
                            content={
                                environment.isRunning
                                    ? t(
                                          '请先关闭环境再清理缓存',
                                          'Close the environment before clearing cache',
                                      )
                                    : t(
                                          '清理浏览器缓存（保留 Cookie 与登录态）',
                                          'Clear browser cache (preserves cookies and sessions)',
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
                                onClick={onClearCache}
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
                        <span className={styles.metaVal} style={{ flex: 1 }}>
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
                                onClick={onOpenDataDir}
                            />
                        </Tooltip>
                    </div>
                </div>
                {(onOpenCookieImport || onOpenCookieExport) && (
                    <div className={styles.metaRow}>
                        <span className={styles.metaKey}>Cookies</span>
                        <div className={styles.inlineCopyRow}>
                            <Tooltip
                                content={
                                    environment.isRunning
                                        ? t(
                                              '通过原生 CDP 通道免插件读写运行中浏览器的 Cookie（支持 JSON 与 Netscape）',
                                              'Transfer JSON or Netscape cookies natively over CDP without extensions.',
                                          )
                                        : t(
                                              '请先启动该环境后再导入或导出 Cookie',
                                              'Launch this environment first to import or export cookies.',
                                          )
                                }
                                relationship="description"
                            >
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    {onOpenCookieImport && (
                                        <Button
                                            type="button"
                                            appearance="subtle"
                                            size="small"
                                            icon={<ArrowUploadRegular />}
                                            disabled={!environment.isRunning}
                                            onClick={onOpenCookieImport}
                                        >
                                            {t('导入', 'Import')}
                                        </Button>
                                    )}
                                    {onOpenCookieExport && (
                                        <Button
                                            type="button"
                                            appearance="subtle"
                                            size="small"
                                            icon={<ArrowDownloadRegular />}
                                            disabled={!environment.isRunning}
                                            onClick={onOpenCookieExport}
                                        >
                                            {t('导出', 'Export')}
                                        </Button>
                                    )}
                                </div>
                            </Tooltip>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default EnvironmentStorageMetaCard;
