import React from 'react';
import {
    Badge,
    Button,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    MessageBar,
    MessageBarBody,
    OverlayDrawer,
    Select,
    Spinner,
    Textarea,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import {
    CopyRegular,
    DismissRegular,
    EyeOffRegular,
    EyeRegular,
} from '@fluentui/react-icons';
import { ManagedProxy, ProxyConfigView } from '../../types';
import { useI18n } from '../../i18n';

interface ProxyConfigDrawerProps {
    proxyId: string | null;
    proxies: ManagedProxy[];
    configView: ProxyConfigView | null;
    loading: boolean;
    error: string;
    onSelectProxy: (id: string) => void;
    onToggleReveal: () => void;
    onCopy: () => void;
    onClose: () => void;
}

const useStyles = makeStyles({
    drawer: {
        width: 'min(660px, 95vw)',
    },
    content: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        height: '100%',
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
    },
    meta: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
    pathText: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        wordBreak: 'break-all',
    },
    code: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: '12px',
        lineHeight: '1.55',
    },
    loadingBox: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 0',
    },
});

const ProxyConfigDrawer: React.FC<ProxyConfigDrawerProps> = ({
    proxyId,
    proxies,
    configView,
    loading,
    error,
    onSelectProxy,
    onToggleReveal,
    onCopy,
    onClose,
}) => {
    const styles = useStyles();
    const { t } = useI18n();

    return (
        <OverlayDrawer
            position="end"
            open={proxyId !== null}
            modalType="modal"
            className={styles.drawer}
            onOpenChange={(_, data) => {
                if (!data.open) onClose();
            }}
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label={t('关闭完整配置面板', 'Close config drawer')}
                            icon={<DismissRegular />}
                            onClick={onClose}
                        />
                    }
                >
                    {t('完整 sing-box 配置', 'Full sing-box Config')}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                <div className={styles.content}>
                    <div className={styles.toolbar}>
                        <Select
                            aria-label={t('选择代理', 'Select proxy')}
                            style={{ minWidth: '180px', flex: 1 }}
                            value={proxyId || ''}
                            onChange={(_, data) => onSelectProxy(data.value)}
                        >
                            {proxies.map((proxy) => (
                                <option key={proxy.id} value={proxy.id}>
                                    {proxy.name}
                                </option>
                            ))}
                        </Select>
                        <Button
                            size="small"
                            appearance="outline"
                            icon={
                                configView?.redacted === false ? (
                                    <EyeOffRegular />
                                ) : (
                                    <EyeRegular />
                                )
                            }
                            disabled={loading || !configView}
                            onClick={onToggleReveal}
                        >
                            {configView?.redacted === false
                                ? t('隐藏认证', 'Hide Secrets')
                                : t('显示认证', 'Show Secrets')}
                        </Button>
                        <Button
                            size="small"
                            appearance="outline"
                            icon={<CopyRegular />}
                            disabled={loading || !configView}
                            onClick={onCopy}
                        >
                            {configView?.redacted === false
                                ? t('复制完整配置', 'Copy Full Config')
                                : t('复制脱敏配置', 'Copy Redacted')}
                        </Button>
                    </div>

                    {error && (
                        <MessageBar intent="error" layout="multiline">
                            <MessageBarBody>{error}</MessageBarBody>
                        </MessageBar>
                    )}

                    {loading && (
                        <div className={styles.loadingBox}>
                            <Spinner
                                size="small"
                                label={t(
                                    '正在生成完整 sing-box 配置…',
                                    'Generating full sing-box config…',
                                )}
                            />
                        </div>
                    )}

                    {configView && !loading && (
                        <>
                            <div className={styles.meta}>
                                <Badge appearance="tint" color="informative" size="small">
                                    sing-box {configView.coreVersion}
                                </Badge>
                                <Badge
                                    appearance="tint"
                                    color={configView.running ? 'success' : 'subtle'}
                                    size="small"
                                >
                                    {configView.running
                                        ? t('当前运行配置', 'Active Runtime Config')
                                        : t('配置预览', 'Preview')}
                                </Badge>
                                <span>
                                    {configView.redacted
                                        ? t(
                                              '认证字段已脱敏遮盖',
                                              'Credentials are redacted',
                                          )
                                        : t(
                                              '当前包含明文认证，请仅复制到可信位置',
                                              'Contains plaintext credentials — copy only to trusted destinations',
                                          )}
                                </span>
                            </div>

                            <div className={styles.pathText} data-selectable="true">
                                {t('加密存储路径：', 'Encrypted storage path: ')}
                                <code>{configView.sourcePath}</code>
                            </div>

                            <Textarea
                                readOnly
                                rows={20}
                                aria-label={t('完整 sing-box 配置内容', 'Full sing-box config JSON')}
                                textarea={{
                                    className: styles.code,
                                    spellCheck: false,
                                }}
                                value={configView.json}
                            />
                        </>
                    )}
                </div>
            </DrawerBody>

            <DrawerFooter>
                <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                    <Button appearance="secondary" onClick={onClose}>
                        {t('关闭', 'Close')}
                    </Button>
                </div>
            </DrawerFooter>
        </OverlayDrawer>
    );
};

export default ProxyConfigDrawer;
