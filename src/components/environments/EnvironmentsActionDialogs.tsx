import React from 'react';
import RowContextMenu from '../common/RowContextMenu';
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    mergeClasses,
} from '@fluentui/react-components';
import {
    CopyRegular,
    DeleteRegular,
    DocumentTextRegular,
    FolderOpenRegular,
    PanelRightRegular,
    PlayRegular,
    ShieldCheckmarkRegular,
    StopRegular,
    TargetRegular,
} from '@fluentui/react-icons';
import type { ChromeEnvironment, RunningResourceStats } from '../../types';
import {
    type EnvContextMenuState,
    formatMemoryBytes,
} from '../../hooks/useEnvironmentsWorkspace';
import { useI18n } from '../../i18n';
import EnvironmentHealthDialog from './EnvironmentHealthDialog';
import type { EnvironmentsStyles } from './environmentsStyles';

export interface EnvironmentsActionDialogsProps {
    styles: EnvironmentsStyles;
    contextMenu: EnvContextMenuState | null;
    onCloseContextMenu: () => void;
    onRunToggle: (env: ChromeEnvironment) => void;
    onFocusWindow?: (id: string) => void;
    onOpenDetails: (env: ChromeEnvironment) => void;
    onInspectHealth: (id: string) => void;
    onClone?: (id: string) => Promise<void>;
    onOpenDataDir: (id: string) => void;
    onInspectProxyLogs: (proxyId: string) => void;
    onStartDelete: (env: ChromeEnvironment) => void;
    healthTargetEnv: ChromeEnvironment | null;
    onCloseHealth: () => void;
    closeAllConfirmOpen: boolean;
    closingAll: boolean;
    allRunningCount: number;
    resourceStats: RunningResourceStats | null;
    onCloseAllCancel: () => void;
    onConfirmCloseAll: () => void;
    deleteTarget: ChromeEnvironment | null;
    onCloseDelete: () => void;
    onConfirmDelete: (id: string) => void;
}

const EnvironmentsActionDialogs: React.FC<EnvironmentsActionDialogsProps> = ({
    styles,
    contextMenu,
    onCloseContextMenu,
    onRunToggle,
    onFocusWindow,
    onOpenDetails,
    onInspectHealth,
    onClone,
    onOpenDataDir,
    onInspectProxyLogs,
    onStartDelete,
    healthTargetEnv,
    onCloseHealth,
    closeAllConfirmOpen,
    closingAll,
    allRunningCount,
    resourceStats,
    onCloseAllCancel,
    onConfirmCloseAll,
    deleteTarget,
    onCloseDelete,
    onConfirmDelete,
}) => {
    const { isEn, t } = useI18n();

    return (
        <>
            {contextMenu && (
                <RowContextMenu x={contextMenu.x} y={contextMenu.y} className={styles.contextMenu}
                    label={t('环境操作', 'Profile actions')} onClose={onCloseContextMenu}>
                    {contextMenu.env.isRunning && onFocusWindow && (
                        <button
                            type="button"
                            role="menuitem"
                            className={styles.contextMenuItem}
                            onClick={() => {
                                const targetId = contextMenu.env.id;
                                onCloseContextMenu();
                                onFocusWindow(targetId);
                            }}
                        >
                            <TargetRegular />
                            {t('定位窗口', 'Locate Window')}
                        </button>
                    )}
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.contextMenuItem}
                        onClick={() => {
                            const target = contextMenu.env;
                            onCloseContextMenu();
                            onRunToggle(target);
                        }}
                    >
                        {contextMenu.env.isRunning ? (
                            <StopRegular />
                        ) : (
                            <PlayRegular />
                        )}
                        {contextMenu.env.isRunning
                            ? t('关闭环境', 'Stop Environment')
                            : t('启动环境', 'Launch Environment')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.contextMenuItem}
                        onClick={() => {
                            const target = contextMenu.env;
                            onCloseContextMenu();
                            onOpenDetails(target);
                        }}
                    >
                        <PanelRightRegular />
                        {t('查看详情', 'Details')}
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.contextMenuItem}
                        onClick={() => {
                            const targetId = contextMenu.env.id;
                            onCloseContextMenu();
                            onInspectHealth(targetId);
                        }}
                    >
                        <ShieldCheckmarkRegular />
                        {t('安全自检', 'Health Check')}
                    </button>
                    {onClone && (
                        <button
                            type="button"
                            role="menuitem"
                            className={styles.contextMenuItem}
                            onClick={() => {
                                const target = contextMenu.env;
                                onCloseContextMenu();
                                void onClone(target.id);
                            }}
                        >
                            <CopyRegular />
                            {t('克隆环境', 'Clone')}
                        </button>
                    )}
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.contextMenuItem}
                        onClick={() => {
                            const targetId = contextMenu.env.id;
                            onCloseContextMenu();
                            onOpenDataDir(targetId);
                        }}
                    >
                        <FolderOpenRegular />
                        {t('打开数据目录', 'Open Folder')}
                    </button>
                    {contextMenu.env.proxyId && (
                        <button
                            type="button"
                            role="menuitem"
                            className={styles.contextMenuItem}
                            onClick={() => {
                                const proxyId = contextMenu.env.proxyId!;
                                onCloseContextMenu();
                                onInspectProxyLogs(proxyId);
                            }}
                        >
                            <DocumentTextRegular />
                            {t('查看代理日志', 'Proxy Logs')}
                        </button>
                    )}
                    <div className={styles.contextMenuSep} />
                    <button
                        type="button"
                        role="menuitem"
                        className={mergeClasses(
                            styles.contextMenuItem,
                            styles.contextMenuDanger,
                        )}
                        onClick={() => {
                            const target = contextMenu.env;
                            onCloseContextMenu();
                            onStartDelete(target);
                        }}
                    >
                        <DeleteRegular />
                        {t('移入回收站', 'Move to Trash')}
                    </button>
                </RowContextMenu>
            )}

            <EnvironmentHealthDialog
                env={healthTargetEnv}
                onClose={onCloseHealth}
            />

            <Dialog
                open={closeAllConfirmOpen}
                onOpenChange={(_, data) => {
                    if (!data.open && !closingAll) onCloseAllCancel();
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {t(
                                '一键关闭全部运行环境',
                                'Stop All Running Environments',
                            )}
                        </DialogTitle>
                        <DialogContent>
                            {isEn ? (
                                <>
                                    <strong>{allRunningCount}</strong> browser
                                    environment
                                    {allRunningCount > 1 ? 's are' : ' is'}{' '}
                                    currently running
                                    {resourceStats?.totalMemoryBytes
                                        ? ` (~${formatMemoryBytes(resourceStats.totalMemoryBytes)} RAM)`
                                        : ''}
                                    . Gracefully close all of them? Sessions and
                                    cookies will be preserved automatically.
                                </>
                            ) : (
                                <>
                                    当前共有 <strong>{allRunningCount}</strong>{' '}
                                    个浏览器环境正在运行
                                    {resourceStats?.totalMemoryBytes
                                        ? `（共占用内存约 ${formatMemoryBytes(resourceStats.totalMemoryBytes)}）`
                                        : ''}
                                    。确认优雅关闭全部环境并释放内存吗？各环境会话与
                                    Cookie 会自动落盘保留。
                                </>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={closingAll}
                                onClick={onCloseAllCancel}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={closingAll}
                                onClick={onConfirmCloseAll}
                            >
                                {closingAll
                                    ? t('关闭中…', 'Stopping…')
                                    : t('确认关闭全部', 'Stop All')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            <Dialog
                open={deleteTarget !== null}
                onOpenChange={(_, data) => {
                    if (!data.open) onCloseDelete();
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {t('移入回收站', 'Move to Trash')}
                        </DialogTitle>
                        <DialogContent>
                            {isEn
                                ? `Move environment "${deleteTarget?.name}" to Trash? You can restore it anytime within 30 days.`
                                : `确定将环境“${deleteTarget?.name}”移入回收站吗？30 天内可在回收站随时恢复。`}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                onClick={onCloseDelete}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                onClick={() => {
                                    const target = deleteTarget;
                                    onCloseDelete();
                                    if (target) {
                                        onConfirmDelete(target.id);
                                    }
                                }}
                            >
                                {t('移入回收站', 'Move to Trash')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
        </>
    );
};

export default EnvironmentsActionDialogs;
