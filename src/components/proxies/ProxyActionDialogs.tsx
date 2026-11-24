import React from 'react';
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    MessageBar,
    MessageBarBody,
    Select,
    mergeClasses,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    CodeRegular,
    DeleteRegular,
    DocumentTextRegular,
    EditRegular,
    LinkRegular,
    PanelRightRegular,
    PlayRegular,
    StopRegular,
} from '@fluentui/react-icons';
import type { ChromeEnvironment, ManagedProxy } from '../../types';
import { useI18n } from '../../i18n';
import type { ProxiesStyles } from './proxiesStyles';

export interface ProxyContextMenuState {
    proxy: ManagedProxy;
    x: number;
    y: number;
}

export interface ProxyActionDialogsProps {
    styles: ProxiesStyles;
    busy: string;
    environments: ChromeEnvironment[];
    envBindingsByProxy: Map<string, ChromeEnvironment[]>;
    refreshingExitIds: Set<string>;
    assignProxy: ManagedProxy | null;
    assignEnvironmentId: string;
    onAssignEnvironmentIdChange: (id: string) => void;
    onCloseAssign: () => void;
    onConfirmAssign: () => void;
    deleteProxy: ManagedProxy | null;
    onCloseDelete: () => void;
    onConfirmDelete: () => void;
    contextMenu: ProxyContextMenuState | null;
    onCloseContextMenu: () => void;
    onToggleService: (proxy: ManagedProxy) => void;
    onOpenDetails: (proxy: ManagedProxy) => void;
    onEdit: (proxy: ManagedProxy) => void;
    onStartAssign: (proxy: ManagedProxy) => void;
    onRefreshExit: (proxy: ManagedProxy) => void;
    onInspectLogs: (proxyId: string) => void;
    onViewConfig: (proxyId: string) => void;
    onStartDelete: (proxy: ManagedProxy) => void;
}

const ProxyActionDialogs: React.FC<ProxyActionDialogsProps> = ({
    styles,
    busy,
    environments,
    envBindingsByProxy,
    refreshingExitIds,
    assignProxy,
    assignEnvironmentId,
    onAssignEnvironmentIdChange,
    onCloseAssign,
    onConfirmAssign,
    deleteProxy,
    onCloseDelete,
    onConfirmDelete,
    contextMenu,
    onCloseContextMenu,
    onToggleService,
    onOpenDetails,
    onEdit,
    onStartAssign,
    onRefreshExit,
    onInspectLogs,
    onViewConfig,
    onStartDelete,
}) => {
    const { isEn, t } = useI18n();
    const boundForAssign = assignProxy
        ? envBindingsByProxy.get(assignProxy.id) || []
        : [];

    return (
        <>
            <Dialog
                open={assignProxy !== null}
                onOpenChange={(_, data) => {
                    if (!data.open && !busy) onCloseAssign();
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {isEn
                                ? `Assign Proxy: ${assignProxy?.name}`
                                : `分配代理：${assignProxy?.name}`}
                        </DialogTitle>
                        <DialogContent>
                            {assignProxy && boundForAssign.length > 0 && (
                                <MessageBar
                                    intent="warning"
                                    layout="multiline"
                                    style={{ marginBottom: '12px' }}
                                >
                                    <MessageBarBody>
                                        {isEn
                                            ? `Already bound to ${boundForAssign.length} environment(s) (${boundForAssign.map((e) => e.name).join(', ')}). Sharing a proxy may cause exit IP correlation.`
                                            : `此代理已被 ${boundForAssign.length} 个环境绑定（${boundForAssign.map((e) => e.name).join('、')}）。多个环境共用同一代理可能导致出口 IP 关联。`}
                                    </MessageBarBody>
                                </MessageBar>
                            )}
                            <Field
                                label={t('选择目标环境', 'Target Environment')}
                                hint={t(
                                    '此代理将优先于该环境的手动代理和全局默认代理。仅可为未运行的环境分配。',
                                    'Takes priority over manual and global proxies. Only stopped environments can be assigned.',
                                )}
                            >
                                <Select
                                    value={assignEnvironmentId}
                                    onChange={(_, data) =>
                                        onAssignEnvironmentIdChange(data.value)
                                    }
                                >
                                    <option value="">
                                        {t(
                                            '请选择已停止的环境',
                                            'Select a stopped environment',
                                        )}
                                    </option>
                                    {environments.map((env) => (
                                        <option
                                            key={env.id}
                                            value={env.id}
                                            disabled={env.isRunning}
                                        >
                                            {env.groupName} / {env.name}
                                            {env.isRunning
                                                ? t('（运行中）', ' (Running)')
                                                : ''}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={!!busy}
                                onClick={onCloseAssign}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={!!busy || !assignEnvironmentId}
                                onClick={onConfirmAssign}
                            >
                                {busy === 'assign'
                                    ? t('保存中…', 'Saving…')
                                    : t('确认分配', 'Assign')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            <Dialog
                open={deleteProxy !== null}
                onOpenChange={(_, data) => {
                    if (!data.open && !busy) onCloseDelete();
                }}
            >
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>
                            {t('删除代理', 'Delete Proxy')}
                        </DialogTitle>
                        <DialogContent>
                            {isEn
                                ? `Permanently delete proxy "${deleteProxy?.name}" and its saved encrypted credentials? This cannot be undone.`
                                : `确定要永久删除代理“${deleteProxy?.name}”及其保存的加密认证信息吗？此操作无法撤销。`}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                disabled={!!busy}
                                onClick={onCloseDelete}
                            >
                                {t('取消', 'Cancel')}
                            </Button>
                            <Button
                                appearance="primary"
                                disabled={!!busy}
                                onClick={onConfirmDelete}
                            >
                                {t('确认删除', 'Delete')}
                            </Button>
                        </DialogActions>
                    </DialogBody>
                </DialogSurface>
            </Dialog>

            {contextMenu &&
                (() => {
                    const target = contextMenu.proxy;
                    const assigned = envBindingsByProxy.get(target.id) || [];
                    const inUse = assigned.some((env) => env.isRunning);
                    const running = target.status === 'running';
                    return (
                        <div
                            className={styles.contextMenu}
                            role="menu"
                            style={{
                                left: contextMenu.x,
                                top: contextMenu.y,
                            }}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                disabled={!!busy || (running && inUse)}
                                onClick={() => {
                                    onCloseContextMenu();
                                    onToggleService(target);
                                }}
                            >
                                {running ? <StopRegular /> : <PlayRegular />}
                                {running
                                    ? t('停止服务', 'Stop')
                                    : t('启动服务', 'Start')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                onClick={() => {
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
                                disabled={!!busy || running || inUse}
                                onClick={() => {
                                    onCloseContextMenu();
                                    onEdit(target);
                                }}
                            >
                                <EditRegular />
                                {t('编辑代理', 'Edit')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                disabled={!!busy}
                                onClick={() => {
                                    onCloseContextMenu();
                                    onStartAssign(target);
                                }}
                            >
                                <LinkRegular />
                                {t('分配环境', 'Assign')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                disabled={
                                    !running ||
                                    target.exitInfo?.status === 'checking' ||
                                    refreshingExitIds.has(target.id)
                                }
                                onClick={() => {
                                    onCloseContextMenu();
                                    onRefreshExit(target);
                                }}
                            >
                                <ArrowClockwiseRegular />
                                {t('检测出口 IP', 'Probe Exit IP')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                onClick={() => {
                                    onCloseContextMenu();
                                    onInspectLogs(target.id);
                                }}
                            >
                                <DocumentTextRegular />
                                {t('查看日志', 'Logs')}
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                className={styles.contextMenuItem}
                                disabled={!!busy}
                                onClick={() => {
                                    onCloseContextMenu();
                                    onViewConfig(target.id);
                                }}
                            >
                                <CodeRegular />
                                {t('完整配置', 'Full Config')}
                            </button>
                            <div className={styles.contextMenuSep} />
                            <button
                                type="button"
                                role="menuitem"
                                className={mergeClasses(
                                    styles.contextMenuItem,
                                    styles.contextMenuDanger,
                                )}
                                disabled={
                                    !!busy || running || assigned.length > 0
                                }
                                onClick={() => {
                                    onCloseContextMenu();
                                    onStartDelete(target);
                                }}
                            >
                                <DeleteRegular />
                                {t('删除代理', 'Delete')}
                            </button>
                        </div>
                    );
                })()}
        </>
    );
};

export default ProxyActionDialogs;
