import React, { useRef } from 'react';
import {
    Button,
    Checkbox,
    DrawerBody,
    DrawerFooter,
    DrawerHeader,
    DrawerHeaderTitle,
    Field,
    Input,
    MessageBar,
    MessageBarBody,
    OverlayDrawer,
    Select,
    Tab,
    TabList,
    Textarea,
    makeStyles,
    tokens,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { ProxyCoreInfo, SimpleProxyInput } from '../types';
import { useI18n } from '../i18n';
import InfoTip from './InfoTip';

export interface ProxyEditorState {
    id?: string;
    mode: 'line' | 'simple' | 'json';
    name: string;
    protocol: SimpleProxyInput['protocol'];
    host: string;
    port: string;
    username: string;
    password: string;
    hasPassword: boolean;
    clearCredentials: boolean;
    line: string;
    config: string;
}

export const PROXY_JSON_EXAMPLE = JSON.stringify(
    {
        type: 'vless',
        tag: 'my-vless',
        server: 'proxy.example.com',
        server_port: 443,
        uuid: '00000000-0000-4000-8000-000000000000',
        tls: { enabled: true, server_name: 'proxy.example.com' },
    },
    null,
    2,
);

export const createEmptyProxyEditor = (): ProxyEditorState => ({
    mode: 'line',
    name: '',
    protocol: 'http',
    host: '',
    port: '',
    username: '',
    password: '',
    hasPassword: false,
    clearCredentials: false,
    line: '',
    config: '',
});

interface ProxyEditorDrawerProps {
    editor: ProxyEditorState | null;
    onChange: (next: ProxyEditorState) => void;
    onSwitchMode: (mode: ProxyEditorState['mode']) => Promise<void>;
    onSubmit: (event: React.FormEvent) => Promise<void>;
    onClose: () => void;
    formError: string;
    busy: string;
    coreInfo: ProxyCoreInfo | null;
}

const useStyles = makeStyles({
    drawer: {
        width: 'min(540px, 94vw)',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        paddingBottom: '12px',
    },
    rowTwo: {
        display: 'grid',
        gridTemplateColumns: '1fr 120px',
        gap: '10px',
    },
    help: {
        margin: 0,
        fontSize: '12px',
        lineHeight: '1.55',
        color: tokens.colorNeutralForeground3,
    },
    jsonInput: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: '12px',
    },
    footer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        gap: '8px',
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        paddingTop: '12px',
    },
});

const ProxyEditorDrawer: React.FC<ProxyEditorDrawerProps> = ({
    editor,
    onChange,
    onSwitchMode,
    onSubmit,
    onClose,
    formError,
    busy,
    coreInfo,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const formRef = useRef<HTMLFormElement>(null);

    return (
        <OverlayDrawer
            position="end"
            open={editor !== null}
            modalType="modal"
            className={styles.drawer}
            onOpenChange={(_, data) => {
                if (!data.open && !busy) onClose();
            }}
        >
            <DrawerHeader>
                <DrawerHeaderTitle
                    action={
                        <Button
                            appearance="subtle"
                            aria-label={t('关闭编辑面板', 'Close editor')}
                            icon={<DismissRegular />}
                            disabled={!!busy}
                            onClick={onClose}
                        />
                    }
                >
                    {editor?.id
                        ? t('编辑代理配置', 'Edit Proxy')
                        : t('添加代理', 'Add Proxy')}
                </DrawerHeaderTitle>
            </DrawerHeader>

            <DrawerBody>
                {editor && (
                    <form
                        ref={formRef}
                        className={styles.form}
                        onSubmit={(event) => void onSubmit(event)}
                    >
                        {coreInfo && !coreInfo.available && (
                            <MessageBar intent="error" layout="multiline">
                                <MessageBarBody>
                                    {t(
                                        'sing-box 核心不可用，无法校验并保存配置。请使用包含核心的安装包。',
                                        'sing-box core is unavailable. Install it in Settings to validate and save proxies.',
                                    )}
                                </MessageBarBody>
                            </MessageBar>
                        )}

                        {formError && (
                            <MessageBar intent="error" layout="multiline">
                                <MessageBarBody>
                                    {isEn
                                        ? `${formError} (Your unsaved input is preserved — adjust and retry.)`
                                        : `${formError}（当前编辑内容已保留，修正后可直接重新校验保存）`}
                                </MessageBarBody>
                            </MessageBar>
                        )}

                        <Field label={t('代理名称', 'Proxy Name')} required>
                            <Input
                                required
                                maxLength={80}
                                value={editor.name}
                                placeholder={t(
                                    '例如：美国住宅、香港专线',
                                    'e.g., US Residential, HK Direct',
                                )}
                                autoComplete="off"
                                onChange={(_, data) => onChange({ ...editor, name: data.value })}
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
                                    {t('配置方式', 'Input Mode')}
                                    <InfoTip
                                        content={t(
                                            '切换方式会清空未保存的输入；编辑已有代理切换到 JSON 时会自动载入原配置',
                                            'Switching resets unsaved fields; switching to JSON on an existing proxy loads its saved config.',
                                        )}
                                    />
                                </span>
                            }
                        >
                            <TabList
                                size="small"
                                selectedValue={editor.mode}
                                onTabSelect={(_, data) =>
                                    void onSwitchMode(
                                        data.value as ProxyEditorState['mode'],
                                    )
                                }
                            >
                                <Tab value="line" disabled={!!busy}>
                                    {t('一行代理', 'Single Line')}
                                </Tab>
                                <Tab value="simple" disabled={!!busy}>
                                    {t('手动表单', 'Manual Form')}
                                </Tab>
                                <Tab value="json" disabled={!!busy}>
                                    JSON
                                </Tab>
                            </TabList>
                        </Field>

                        {editor.mode === 'line' && (
                            <Field
                                label={
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '5px',
                                        }}
                                    >
                                        {t('代理地址', 'Proxy Line')}
                                        <InfoTip
                                            content={t(
                                                '支持 http://、https://、socks5://，以及 服务器:端口 或 服务器:端口:用户名:密码（无协议默认 HTTP）',
                                                'Supports http://, https://, socks5://, host:port, and host:port:user:pass (defaults to HTTP).',
                                            )}
                                        />
                                    </span>
                                }
                                required
                            >
                                <Input
                                    required
                                    value={editor.line}
                                    placeholder={t(
                                        'http://用户名:密码@服务器:端口',
                                        'http://user:pass@host:port',
                                    )}
                                    autoComplete="off"
                                    spellCheck={false}
                                    onChange={(_, data) =>
                                        onChange({
                                            ...editor,
                                            line: data.value,
                                        })
                                    }
                                />
                            </Field>
                        )}

                        {editor.mode === 'simple' && (
                            <>
                                <Field label={t('协议', 'Protocol')} required>
                                    <Select
                                        value={editor.protocol}
                                        onChange={(_, data) =>
                                            onChange({
                                                ...editor,
                                                protocol: data.value as SimpleProxyInput['protocol'],
                                            })
                                        }
                                    >
                                        <option value="http">HTTP</option>
                                        <option value="https">HTTPS</option>
                                        <option value="socks5">SOCKS5</option>
                                    </Select>
                                </Field>

                                <div className={styles.rowTwo}>
                                    <Field label={t('服务器地址', 'Host')} required>
                                        <Input
                                            required
                                            value={editor.host}
                                            placeholder={t(
                                                'proxy.example.com 或 IP',
                                                'proxy.example.com or IP',
                                            )}
                                            autoComplete="off"
                                            spellCheck={false}
                                            onChange={(_, data) =>
                                                onChange({ ...editor, host: data.value })
                                            }
                                        />
                                    </Field>
                                    <Field label={t('端口', 'Port')} required>
                                        <Input
                                            required
                                            type="number"
                                            min={1}
                                            max={65535}
                                            step={1}
                                            value={editor.port}
                                            placeholder="8080"
                                            onChange={(_, data) =>
                                                onChange({ ...editor, port: data.value })
                                            }
                                        />
                                    </Field>
                                </div>

                                <Field label={t('用户名（可选）', 'Username (Optional)')}>
                                    <Input
                                        disabled={editor.clearCredentials}
                                        value={editor.username}
                                        autoComplete="off"
                                        spellCheck={false}
                                        onChange={(_, data) =>
                                            onChange({ ...editor, username: data.value })
                                        }
                                    />
                                </Field>

                                <Field label={t('密码（可选）', 'Password (Optional)')}>
                                    <Input
                                        type="password"
                                        disabled={editor.clearCredentials}
                                        value={editor.password}
                                        placeholder={
                                            editor.hasPassword
                                                ? t(
                                                      '已保存密码，留空保持不变',
                                                      'Password saved — leave blank to keep',
                                                  )
                                                : t('输入代理密码', 'Enter proxy password')
                                        }
                                        autoComplete="new-password"
                                        onChange={(_, data) =>
                                            onChange({ ...editor, password: data.value })
                                        }
                                    />
                                </Field>

                                {editor.id && (
                                    <Checkbox
                                        checked={editor.clearCredentials}
                                        label={t(
                                            '清除用户名和密码，改为无需认证',
                                            'Clear username and password (no auth)',
                                        )}
                                        onChange={(_, data) =>
                                            onChange({
                                                ...editor,
                                                clearCredentials: Boolean(data.checked),
                                                password: '',
                                            })
                                        }
                                    />
                                )}
                            </>
                        )}

                        {editor.mode === 'json' && (
                            <Field
                                label={
                                    <span
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '5px',
                                        }}
                                    >
                                        {t('代理配置 (JSON)', 'Proxy Config (JSON)')}
                                        <InfoTip
                                            content={t(
                                                '支持 sing-box 单个 outbound 对象或包含 outbounds / dns / endpoints 的配置片段；保存前自动校验并加密存储',
                                                'Accepts a sing-box outbound object or snippet; validated and encrypted locally before saving.',
                                            )}
                                        />
                                    </span>
                                }
                                required
                            >
                                <Textarea
                                    required
                                    rows={14}
                                    resize="vertical"
                                    textarea={{
                                        className: styles.jsonInput,
                                        spellCheck: false,
                                    }}
                                    value={editor.config}
                                    placeholder={PROXY_JSON_EXAMPLE}
                                    onChange={(_, data) =>
                                        onChange({
                                            ...editor,
                                            config: data.value,
                                        })
                                    }
                                />
                            </Field>
                        )}

                        <p className={styles.help}>
                            {t(
                                '认证信息加密存储在应用数据目录，升级时保留；分配给环境后下次启动浏览器自动生效。',
                                'Credentials are stored encrypted in the app data directory and take effect on next browser launch.',
                            )}
                        </p>
                    </form>
                )}
            </DrawerBody>

            <DrawerFooter>
                <div className={styles.footer}>
                    <span className={styles.help}>
                        {busy === 'save'
                            ? t('正在执行 sing-box 校验…', 'Validating with sing-box…')
                            : t('保存前自动校验配置', 'Auto-validated before saving')}
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <Button appearance="secondary" disabled={!!busy} onClick={onClose}>
                            {t('取消', 'Cancel')}
                        </Button>
                        <Button
                            appearance="primary"
                            disabled={!!busy || coreInfo?.available === false}
                            onClick={() => formRef.current?.requestSubmit()}
                        >
                            {busy === 'save'
                                ? t('校验并保存中…', 'Validating & Saving…')
                                : t('校验并保存', 'Validate & Save')}
                        </Button>
                    </div>
                </div>
            </DrawerFooter>
        </OverlayDrawer>
    );
};

export default ProxyEditorDrawer;
