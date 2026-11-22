import React, { useCallback, useEffect, useState } from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Spinner,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowReplyRegular,
    BroomRegular,
    DeleteRegular,
} from '@fluentui/react-icons';
import dayjs from 'dayjs';
import { ChromeEnvironment } from '../types';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { useNotification } from '../contexts/NotificationContext';
import { getGroupStyle, getToneStyle } from '../theme/semanticColors';
import { useI18n } from '../i18n';

interface TrashPageProps {
    onEnvironmentRestored: () => Promise<void>;
    onCountChange?: (count: number) => void;
    narrowWindow: boolean;
}

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '16px 20px 12px 20px',
        flexShrink: 0,
        flexWrap: 'wrap',
    },
    headingGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    title: {
        fontSize: '20px',
        fontWeight: 600,
        lineHeight: '28px',
        margin: 0,
        color: tokens.colorNeutralForeground1,
    },
    subtitle: {
        fontSize: '13px',
        color: tokens.colorNeutralForeground2,
    },
    headerActions: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    tableWrap: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'auto',
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    table: {
        width: '100%',
        borderCollapse: 'collapse',
        tableLayout: 'fixed',
    },
    thead: {
        position: 'sticky',
        top: 0,
        zIndex: 2,
        backgroundColor: 'var(--glass-card)',
        backdropFilter: 'blur(14px)',
        boxShadow: 'inset 0 -1px 0 var(--glass-border)',
    },
    th: {
        textAlign: 'left',
        padding: '8px 12px',
        fontSize: '12px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground3,
        whiteSpace: 'nowrap',
    },
    thRight: {
        textAlign: 'right',
    },
    row: {
        height: '48px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
        '&:hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
    },
    td: {
        padding: '6px 12px',
        fontSize: '13px',
        color: tokens.colorNeutralForeground1,
        verticalAlign: 'middle',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    muted: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
    expiring: {
        fontSize: '12px',
        color: tokens.colorPaletteRedForeground1,
        fontWeight: 600,
    },
    actionsCell: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '6px',
    },
    groupBadge: {
        display: 'inline-flex',
        maxWidth: '100%',
        padding: '2px 7px',
        borderRadius: '5px',
        fontSize: '12px',
        lineHeight: '18px',
    },
    deleteButton: {
        color: tokens.colorPaletteRedForeground1,
        '&:hover': {
            color: tokens.colorPaletteRedForeground1,
            backgroundColor: tokens.colorPaletteRedBackground1,
        },
    },
    emptyIcon: {
        width: '56px',
        height: '56px',
        padding: '12px',
        borderRadius: '14px',
    },
    emptyState: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        padding: '32px 20px',
        color: tokens.colorNeutralForeground3,
        textAlign: 'center',
    },
});

const TrashPage: React.FC<TrashPageProps> = ({
    onEnvironmentRestored,
    onCountChange,
    narrowWindow,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const { handleError } = useErrorHandler();
    const { showNotification } = useNotification();

    const [items, setItems] = useState<ChromeEnvironment[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ChromeEnvironment | null>(
        null,
    );
    const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);

    const loadDeleted = useCallback(async () => {
        if (!window.electronAPI?.trash) {
            setLoading(false);
            return;
        }
        try {
            setLoading(true);
            const envs =
                await window.electronAPI.trash.getDeletedEnvironments();
            setItems(envs);
            onCountChange?.(envs.length);
        } catch (err) {
            handleError(err, t('加载回收站', 'Load Trash'));
        } finally {
            setLoading(false);
        }
    }, [handleError, onCountChange, t]);

    useEffect(() => {
        void loadDeleted();
    }, [loadDeleted]);

    const handleRestore = async (env: ChromeEnvironment) => {
        if (!window.electronAPI?.trash || busyId) return;
        setBusyId(env.id);
        try {
            const success = await window.electronAPI.trash.restore(env.id);
            if (success) {
                showNotification(
                    'success',
                    isEn
                        ? `Restored environment "${env.name}"`
                        : `已恢复环境“${env.name}”`,
                );
                await Promise.all([loadDeleted(), onEnvironmentRestored()]);
            }
        } catch (err) {
            handleError(
                err,
                isEn
                    ? `Restore environment "${env.name}"`
                    : `恢复环境“${env.name}”`,
            );
        } finally {
            setBusyId(null);
        }
    };

    const handlePermanentDelete = async (env: ChromeEnvironment) => {
        if (!window.electronAPI?.trash || busyId) return;
        setBusyId(env.id);
        try {
            const success = await window.electronAPI.trash.permanentlyDelete(
                env.id,
            );
            if (success) {
                showNotification(
                    'success',
                    isEn
                        ? `Permanently deleted environment "${env.name}"`
                        : `已永久删除环境“${env.name}”`,
                );
                await loadDeleted();
            }
        } catch (err) {
            handleError(
                err,
                isEn
                    ? `Permanently delete "${env.name}"`
                    : `永久删除环境“${env.name}”`,
            );
        } finally {
            setBusyId(null);
            setDeleteTarget(null);
        }
    };

    const handleCleanup = async () => {
        if (!window.electronAPI?.trash || busyId) return;
        setBusyId('__cleanup__');
        try {
            const count = await window.electronAPI.trash.cleanup();
            showNotification(
                'success',
                count > 0
                    ? isEn
                        ? `Cleaned up ${count} expired environment(s)`
                        : `已清理 ${count} 个过期环境`
                    : t(
                          '当前没有超过 30 天的过期环境',
                          'No expired environments older than 30 days',
                      ),
            );
            await loadDeleted();
        } catch (err) {
            handleError(err, t('清理过期环境', 'Clean Up Expired'));
        } finally {
            setBusyId(null);
            setCleanupConfirmOpen(false);
        }
    };

    return (
        <section className={styles.root} aria-label={t('回收站', 'Trash')}>
            <div className={styles.header}>
                <div className={styles.headingGroup}>
                    <h1 className={styles.title}>{t('回收站', 'Trash')}</h1>
                    <span className={styles.subtitle}>
                        {isEn
                            ? `${items.length} deleted · Kept for 30 days`
                            : `${items.length} 个已删除 · 保留 30 天`}
                    </span>
                </div>
                <div className={styles.headerActions}>
                    <Button
                        appearance="secondary"
                        icon={<BroomRegular />}
                        disabled={items.length === 0 || !!busyId}
                        onClick={() => setCleanupConfirmOpen(true)}
                    >
                        {t('清理过期', 'Clean Expired')}
                    </Button>
                </div>
            </div>

            {loading && items.length === 0 ? (
                <div className={styles.emptyState}>
                    <Spinner
                        size="small"
                        label={t('正在读取回收站…', 'Loading Trash…')}
                    />
                </div>
            ) : items.length === 0 ? (
                <div className={styles.emptyState}>
                    <DeleteRegular
                        className={styles.emptyIcon}
                        style={getToneStyle('amber')}
                    />
                    <span
                        style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: tokens.colorNeutralForeground1,
                        }}
                    >
                        {t('回收站为空', 'Trash is Empty')}
                    </span>
                    <span style={{ fontSize: '12px' }}>
                        {t(
                            '被移入回收站的环境会显示在这里，您可以随时恢复或彻底清除。',
                            'Deleted environments appear here. You can restore or permanently remove them anytime.',
                        )}
                    </span>
                </div>
            ) : (
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead className={styles.thead}>
                            <tr>
                                <th
                                    className={styles.th}
                                    style={{
                                        width: narrowWindow ? '40%' : '22%',
                                    }}
                                >
                                    {t('名称', 'Name')}
                                </th>
                                {!narrowWindow && (
                                    <th
                                        className={styles.th}
                                        style={{ width: '110px' }}
                                    >
                                        {t('分组', 'Group')}
                                    </th>
                                )}
                                <th
                                    className={styles.th}
                                    style={{ width: '120px' }}
                                >
                                    {t('删除时间', 'Deleted At')}
                                </th>
                                {!narrowWindow && (
                                    <th
                                        className={styles.th}
                                        style={{ width: '120px' }}
                                    >
                                        {t('已删除时长', 'Age')}
                                    </th>
                                )}
                                {!narrowWindow && (
                                    <th className={styles.th}>
                                        {t('备注', 'Notes')}
                                    </th>
                                )}
                                <th
                                    className={mergeClasses(
                                        styles.th,
                                        styles.thRight,
                                    )}
                                    style={{ width: '180px' }}
                                >
                                    {t('操作', 'Actions')}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((env) => {
                                const days = env.deletedAt
                                    ? dayjs().diff(dayjs(env.deletedAt), 'days')
                                    : 0;
                                const isExpiring = days >= 25;
                                return (
                                    <tr key={env.id} className={styles.row}>
                                        <td
                                            className={styles.td}
                                            style={{ fontWeight: 600 }}
                                            title={env.name}
                                        >
                                            {env.name}
                                        </td>
                                        {!narrowWindow && (
                                            <td className={styles.td}>
                                                <span
                                                    className={
                                                        styles.groupBadge
                                                    }
                                                    style={getGroupStyle(
                                                        env.groupName ||
                                                            t('未分组', 'Ungrouped'),
                                                    )}
                                                >
                                                    {env.groupName}
                                                </span>
                                            </td>
                                        )}
                                        <td
                                            className={mergeClasses(
                                                styles.td,
                                                styles.muted,
                                            )}
                                        >
                                            {env.deletedAt
                                                ? dayjs(env.deletedAt).format(
                                                      'MM-DD HH:mm',
                                                  )
                                                : '-'}
                                        </td>
                                        {!narrowWindow && (
                                            <td
                                                className={mergeClasses(
                                                    styles.td,
                                                    isExpiring
                                                        ? styles.expiring
                                                        : styles.muted,
                                                )}
                                            >
                                                {env.deletedAt
                                                    ? isEn
                                                        ? `${days}d ago${isExpiring ? ' (Expiring)' : ''}`
                                                        : `${days} 天前${isExpiring ? '（即将过期）' : ''}`
                                                    : '-'}
                                            </td>
                                        )}
                                        {!narrowWindow && (
                                            <td
                                                className={mergeClasses(
                                                    styles.td,
                                                    styles.muted,
                                                )}
                                                title={env.notes || ''}
                                            >
                                                {env.notes || '-'}
                                            </td>
                                        )}
                                        <td className={styles.td}>
                                            <div className={styles.actionsCell}>
                                                <Button
                                                    size="small"
                                                    appearance="primary"
                                                    icon={<ArrowReplyRegular />}
                                                    disabled={busyId === env.id}
                                                    onClick={() =>
                                                        void handleRestore(env)
                                                    }
                                                >
                                                    {t('恢复', 'Restore')}
                                                </Button>
                                                <Button
                                                    size="small"
                                                    appearance="outline"
                                                    className={
                                                        styles.deleteButton
                                                    }
                                                    disabled={busyId === env.id}
                                                    onClick={() =>
                                                        setDeleteTarget(env)
                                                    }
                                                >
                                                    {t('永久删除', 'Delete Forever')}
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <Dialog
                open={deleteTarget !== null}
                onOpenChange={(_, data) => {
                    if (!data.open && !busyId) setDeleteTarget(null);
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {t('永久删除环境', 'Delete Permanently')}
                        </DialogTitle>
                        <DialogContent>
                            {isEn
                                ? `Permanently delete environment "${deleteTarget?.name}" and its local data directory? This cannot be undone.`
                                : `确定永久删除环境“${deleteTarget?.name}”及其磁盘数据目录吗？此操作无法恢复。`}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={!!busyId}
                                onClick={() => setDeleteTarget(null)}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={!!busyId}
                                onClick={() =>
                                    deleteTarget &&
                                    void handlePermanentDelete(deleteTarget)
                                }
                            >
                                {t('确认永久删除', 'Delete Forever')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            <Dialog
                open={cleanupConfirmOpen}
                onOpenChange={(_, data) => {
                    if (!data.open && !busyId) setCleanupConfirmOpen(false);
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {t('清理过期环境', 'Clean Up Expired')}
                        </DialogTitle>
                        <DialogContent>
                            {t(
                                '将永久删除回收站中所有超过 30 天的环境与数据目录，此操作无法恢复。是否继续？',
                                'This will permanently delete all trashed environments older than 30 days and their data directories. Continue?',
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={!!busyId}
                                onClick={() => setCleanupConfirmOpen(false)}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={!!busyId}
                                onClick={() => void handleCleanup()}
                            >
                                {t('确认清理', 'Clean Up')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </section>
    );
};

export default TrashPage;
