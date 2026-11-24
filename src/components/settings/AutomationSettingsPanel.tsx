import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Badge,
    Button,
    Input,
    MessageBar,
    MessageBarActions,
    MessageBarBody,
    Select,
    Spinner,
    Switch,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    CheckmarkRegular,
    ChevronDownRegular,
    ChevronUpRegular,
    CodeRegular,
    CopyRegular,
    EyeOffRegular,
    EyeRegular,
    PlugConnectedRegular,
} from '@fluentui/react-icons';
import { useNotification } from '../../contexts/NotificationContext';
import { translateBackendMessage, useI18n } from '../../i18n';
import { automationApi, environmentApi } from '../../services';
import { getToneStyle } from '../../theme/semanticColors';
import type {
    AutomationConfigPatch,
    AutomationStatus,
    RunningProfileOption,
} from '../../types';
import InfoTip from '../common/InfoTip';

export type { AutomationConfigPatch, AutomationStatus, RunningProfileOption };

type SnippetTab = 'mcpJson' | 'claudeCli' | 'devtoolsMcp' | 'playwrightCode';

const DEFAULT_PORT = 18922;
const MASKED_TOKEN_PLACEHOLDER = '••••••••••••';

const FALLBACK_STATUS: AutomationStatus = {
    enabled: false,
    localApiEnabled: false,
    mcpEnabled: false,
    authRequired: true,
    port: DEFAULT_PORT,
    baseUrl: `http://127.0.0.1:${DEFAULT_PORT}`,
    cdpEndpoint: `http://127.0.0.1:${DEFAULT_PORT}`,
    mcpEndpoint: `http://127.0.0.1:${DEFAULT_PORT}/mcp`,
    running: false,
    activeProfileId: null,
    activeProfileName: null,
    runningProfiles: [],
    stdioBridgePath: 'scripts/mcp-stdio.mjs',
};

function cleanIpcError(err: unknown, fallback: string): string {
    if (err instanceof Error) {
        const cleaned = err.message.replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            '',
        );
        return cleaned || fallback;
    }
    if (typeof err === 'string' && err.trim()) {
        return err.replace(
            /^Error invoking remote method '[^']+': (?:Error: )?/,
            '',
        );
    }
    return fallback;
}

function buildSnippets(
    port: number,
    tokenSegment: string,
): Record<SnippetTab, string> {
    const baseUrl = `http://127.0.0.1:${port}`;
    const hasToken = Boolean(tokenSegment);
    const mcpUrl = hasToken
        ? `${baseUrl}/t/${tokenSegment}/mcp`
        : `${baseUrl}/mcp`;
    const cdpWsUrl = hasToken
        ? `ws://127.0.0.1:${port}/t/${tokenSegment}/devtools/browser`
        : baseUrl;

    return {
        mcpJson: JSON.stringify(
            {
                mcpServers: {
                    multichrome: {
                        url: mcpUrl,
                    },
                    playwright: {
                        command: 'npx',
                        args: [
                            '@playwright/mcp@latest',
                            '--cdp-endpoint',
                            cdpWsUrl,
                        ],
                    },
                },
            },
            null,
            2,
        ),
        claudeCli: [
            `claude mcp add --transport http multichrome ${mcpUrl}`,
            `claude mcp add playwright -- npx @playwright/mcp@latest --cdp-endpoint ${cdpWsUrl}`,
        ].join('\n'),
        devtoolsMcp: [
            `claude mcp add --transport http multichrome ${mcpUrl}`,
            hasToken
                ? `claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest --wsEndpoint=${cdpWsUrl}`
                : `claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest --browserUrl=${baseUrl}`,
        ].join('\n'),
        playwrightCode: hasToken
            ? [
                  "import { chromium } from 'playwright';",
                  '',
                  `const token = '${tokenSegment}';`,
                  `const res = await fetch('${baseUrl}/api/v1/profiles/start', {`,
                  "  method: 'POST',",
                  "  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },",
                  "  body: JSON.stringify({ name: 'Profile-1' }),",
                  '});',
                  'const { data } = await res.json();',
                  'const browser = await chromium.connectOverCDP(data.wsEndpoint, {',
                  '  headers: { Authorization: `Bearer ${token}` },',
                  '});',
                  'const context = browser.contexts()[0];',
              ].join('\n')
            : [
                  "import { chromium } from 'playwright';",
                  '',
                  `const res = await fetch('${baseUrl}/api/v1/profiles/start', {`,
                  "  method: 'POST',",
                  "  headers: { 'Content-Type': 'application/json' },",
                  "  body: JSON.stringify({ name: 'Profile-1' }),",
                  '});',
                  'const { data } = await res.json();',
                  'const browser = await chromium.connectOverCDP(data.wsEndpoint);',
                  'const context = browser.contexts()[0];',
              ].join('\n'),
    };
}

const useStyles = makeStyles({
    stack: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
    },
    card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        padding: '16px 18px',
        borderRadius: '14px',
        backgroundColor: 'var(--glass-card)',
        border: '1px solid var(--glass-border)',
        boxShadow: 'var(--glass-shadow)',
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        flexWrap: 'wrap',
    },
    cardTitleGroup: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
    },
    cardTitle: {
        margin: 0,
        fontSize: '14px',
        fontWeight: 600,
        lineHeight: '20px',
        color: tokens.colorNeutralForeground1,
    },
    sectionIcon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '24px',
        height: '24px',
        borderRadius: '7px',
        fontSize: '14px',
        flexShrink: 0,
    },
    headerMeta: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        flexShrink: 0,
    },
    addressMeta: {
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        fontVariantNumeric: 'tabular-nums',
        userSelect: 'text',
    },
    mutedMeta: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
    },
    row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        minHeight: '34px',
    },
    rowLabel: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '13px',
        fontWeight: 500,
        color: tokens.colorNeutralForeground1,
    },
    divider: {
        height: '1px',
        backgroundColor: tokens.colorNeutralStroke2,
    },
    inlineControls: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
    },
    profileSelect: {
        minWidth: '180px',
        maxWidth: '260px',
    },
    portInput: {
        width: '96px',
    },
    portApplyBtn: {
        minWidth: '60px',
    },
    portAutoBtn: {
        minWidth: 'auto',
        paddingLeft: '8px',
        paddingRight: '8px',
    },
    tokenBadge: {
        padding: '3px 8px',
        borderRadius: '6px',
        backgroundColor: 'var(--glass-card-inner)',
        border: '1px solid var(--glass-border)',
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: '12px',
        color: tokens.colorNeutralForeground2,
        maxWidth: '210px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        userSelect: 'text',
    },
    snippetToolbar: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        flexWrap: 'wrap',
    },
    pillTabsBar: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        padding: '3px',
        borderRadius: '9px',
        backgroundColor: 'var(--glass-pill)',
        border: '1px solid var(--glass-border)',
        flexWrap: 'wrap',
    },
    pillTab: {
        display: 'inline-flex',
        alignItems: 'center',
        height: '26px',
        padding: '0 10px',
        borderRadius: '6px',
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '12px',
        fontWeight: 500,
        fontFamily: 'inherit',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transitionProperty: 'background-color, color, box-shadow',
        transitionDuration: '120ms',
        ':hover': {
            color: tokens.colorNeutralForeground1,
            backgroundColor: tokens.colorSubtleBackgroundHover,
        },
        ':focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '-2px',
        },
    },
    pillTabActive: {
        backgroundColor: tokens.colorNeutralBackground1,
        color: tokens.colorBrandForeground1,
        fontWeight: 600,
        boxShadow: tokens.shadow2,
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1,
            color: tokens.colorBrandForeground1,
        },
    },
    codeSurface: {
        margin: 0,
        padding: '12px 14px',
        borderRadius: '10px',
        backgroundColor: 'var(--glass-card-inner)',
        border: '1px solid var(--glass-border)',
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: '12px',
        lineHeight: '1.6',
        color: tokens.colorNeutralForeground1,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        userSelect: 'text',
    },
    loadingBox: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        color: tokens.colorNeutralForeground2,
    },
});

const AutomationSettingsPanel: React.FC = () => {
    const styles = useStyles();
    const { locale, t } = useI18n();
    const { showNotification } = useNotification();

    const bridgeAvailable = automationApi.isAvailable();
    const mountedRef = useRef(true);
    const copyTimerRef = useRef<number | null>(null);
    const localeRef = useRef(locale);
    localeRef.current = locale;

    const [status, setStatus] = useState<AutomationStatus>(FALLBACK_STATUS);
    const [loading, setLoading] = useState(bridgeAvailable);
    const [busy, setBusy] = useState(false);
    const [actionError, setActionError] = useState('');
    const [portInput, setPortInput] = useState(String(DEFAULT_PORT));
    const [snippetsOpen, setSnippetsOpen] = useState(false);
    const [snippetTab, setSnippetTab] = useState<SnippetTab>('mcpJson');
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [tokenValue, setTokenValue] = useState<string>('');
    const [tokenRevealed, setTokenRevealed] = useState(false);

    const applyStatus = useCallback((next: AutomationStatus) => {
        if (!mountedRef.current) return;
        setStatus(next);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (copyTimerRef.current !== null) {
                window.clearTimeout(copyTimerRef.current);
            }
        };
    }, []);

    const refreshStatus = useCallback(async () => {
        if (!automationApi.isAvailable()) {
            setLoading(false);
            return;
        }
        try {
            const latest = await automationApi.getStatus();
            if (latest) {
                applyStatus(latest);
            }
        } catch (err) {
            if (mountedRef.current) {
                const fallback =
                    localeRef.current === 'en-US'
                        ? 'Failed to load local service status'
                        : '获取本地服务状态失败';
                setActionError(cleanIpcError(err, fallback));
            }
        } finally {
            if (mountedRef.current) {
                setLoading(false);
            }
        }
    }, [applyStatus]);

    useEffect(() => {
        void refreshStatus();
    }, [refreshStatus]);

    useEffect(() => {
        const unsubAutomation = automationApi.onStateChanged((candidate) => {
            if (typeof candidate.port === 'number') {
                applyStatus(candidate);
            } else {
                void refreshStatus();
            }
        });
        const unsubChrome = environmentApi.onStatusChanged(() => {
            void refreshStatus();
        });
        return () => {
            unsubAutomation();
            unsubChrome();
        };
    }, [applyStatus, refreshStatus]);

    useEffect(() => {
        setPortInput(String(status.port || DEFAULT_PORT));
    }, [status.port]);

    const reportActionError = useCallback(
        (err: unknown, fallbackZh: string, fallbackEn: string) => {
            if (!mountedRef.current) return;
            const fallback =
                localeRef.current === 'en-US' ? fallbackEn : fallbackZh;
            setActionError(cleanIpcError(err, fallback));
        },
        [],
    );

    const resolveStartFailureMessage = useCallback(
        (next: AutomationStatus): string => {
            const shouldRun = Boolean(
                next.enabled ?? (next.localApiEnabled || next.mcpEnabled),
            );
            if (next.lastError) {
                return translateBackendMessage(
                    cleanIpcError(next.lastError, next.lastError),
                    localeRef.current,
                );
            }
            if (shouldRun && !next.running) {
                return localeRef.current === 'en-US'
                    ? `Local service failed to start on port ${next.port}`
                    : `本地服务未能在端口 ${next.port} 启动`;
            }
            return '';
        },
        [],
    );

    const handleUpdateConfig = async (
        patch: AutomationConfigPatch,
        successZh?: string,
        successEn?: string,
    ) => {
        if (!bridgeAvailable || busy) return;
        try {
            setBusy(true);
            setActionError('');
            const updated = await automationApi.updateConfig(patch);
            applyStatus(updated);
            const failureMsg = resolveStartFailureMessage(updated);
            if (failureMsg) {
                showNotification('error', failureMsg);
            } else if (successZh && successEn) {
                showNotification('success', t(successZh, successEn));
            }
        } catch (err) {
            reportActionError(
                err,
                '更新本地服务配置失败',
                'Failed to update service settings',
            );
        } finally {
            if (mountedRef.current) {
                setBusy(false);
            }
        }
    };

    const handleApplyPort = async () => {
        const trimmed = portInput.trim();
        const parsed = Number(trimmed);
        if (
            !/^\d+$/.test(trimmed) ||
            !Number.isInteger(parsed) ||
            parsed < 1024 ||
            parsed > 65535
        ) {
            setActionError(
                t(
                    '监听端口必须为 1024 到 65535 之间的整数',
                    'Port must be an integer between 1024 and 65535',
                ),
            );
            return;
        }
        const serviceEnabled = Boolean(
            status.enabled ?? (status.localApiEnabled || status.mcpEnabled),
        );
        await handleUpdateConfig(
            { port: parsed },
            serviceEnabled
                ? `监听端口已更新为 ${parsed}，服务已启动`
                : `监听端口已保存为 ${parsed}`,
            serviceEnabled
                ? `Listening port updated to ${parsed}; server is running`
                : `Listening port saved as ${parsed}`,
        );
    };

    const handlePickAvailablePort = async () => {
        if (!bridgeAvailable || busy) return;
        try {
            setBusy(true);
            setActionError('');
            const updated = await automationApi.pickAvailablePort();
            applyStatus(updated);
            const failureMsg = resolveStartFailureMessage(updated);
            if (failureMsg) {
                showNotification('error', failureMsg);
            } else if (updated.running) {
                showNotification(
                    'success',
                    t(
                        `已自动切换至可用端口 ${updated.port}，服务已启动`,
                        `Switched to available port ${updated.port}; server is running`,
                    ),
                );
            } else {
                showNotification(
                    'success',
                    t(
                        `已自动选择可用端口 ${updated.port}`,
                        `Selected available port ${updated.port}`,
                    ),
                );
            }
        } catch (err) {
            reportActionError(
                err,
                '自动选择可用端口失败',
                'Failed to find an available port',
            );
        } finally {
            if (mountedRef.current) {
                setBusy(false);
            }
        }
    };

    const handleActiveProfileChange = async (value: string) => {
        if (!bridgeAvailable || busy) return;
        try {
            setBusy(true);
            setActionError('');
            const nextId = value ? value : null;
            const updated = await automationApi.setActiveProfile(nextId);
            applyStatus(updated);
        } catch (err) {
            reportActionError(
                err,
                '切换调试目标环境失败',
                'Failed to switch target profile',
            );
        } finally {
            if (mountedRef.current) {
                setBusy(false);
            }
        }
    };

    const ensureTokenLoaded = useCallback(async (): Promise<string> => {
        if (tokenValue) return tokenValue;
        const fetched = await automationApi.getToken();
        if (fetched && mountedRef.current) {
            setTokenValue(fetched);
        }
        return fetched || '';
    }, [tokenValue]);

    const handleToggleRevealToken = async () => {
        if (tokenRevealed) {
            setTokenRevealed(false);
            return;
        }
        try {
            const loaded = await ensureTokenLoaded();
            if (loaded && mountedRef.current) {
                setTokenRevealed(true);
            }
        } catch (err) {
            reportActionError(
                err,
                '读取访问密钥失败',
                'Failed to read access token',
            );
        }
    };

    const handleCopyToken = async () => {
        try {
            const loaded = await ensureTokenLoaded();
            if (!loaded) return;
            await navigator.clipboard.writeText(loaded);
            setCopiedKey('token');
            if (copyTimerRef.current !== null) {
                window.clearTimeout(copyTimerRef.current);
            }
            copyTimerRef.current = window.setTimeout(() => {
                if (mountedRef.current) {
                    setCopiedKey(null);
                }
            }, 1800);
            showNotification(
                'success',
                t('访问密钥已复制', 'Access token copied to clipboard'),
            );
        } catch {
            showNotification(
                'error',
                t('复制访问密钥失败', 'Failed to copy access token'),
            );
        }
    };

    const handleRotateToken = async () => {
        if (!bridgeAvailable || busy) return;
        try {
            setBusy(true);
            setActionError('');
            const nextToken = await automationApi.rotateToken();
            if (nextToken && mountedRef.current) {
                setTokenValue(nextToken);
            }
            showNotification(
                'success',
                t(
                    '访问密钥已重置，旧连接已自动断开',
                    'Access token reset; previous connections disconnected',
                ),
            );
        } catch (err) {
            reportActionError(
                err,
                '重置访问密钥失败',
                'Failed to reset access token',
            );
        } finally {
            if (mountedRef.current) {
                setBusy(false);
            }
        }
    };

    const handleCopySnippet = async () => {
        try {
            const authActive = status.authRequired !== false;
            const liveTok = authActive ? await ensureTokenLoaded() : '';
            const liveSnippets = buildSnippets(
                status.port || DEFAULT_PORT,
                liveTok,
            );
            await navigator.clipboard.writeText(liveSnippets[snippetTab]);
            setCopiedKey(snippetTab);
            if (copyTimerRef.current !== null) {
                window.clearTimeout(copyTimerRef.current);
            }
            copyTimerRef.current = window.setTimeout(() => {
                if (mountedRef.current) {
                    setCopiedKey(null);
                }
            }, 1800);
            showNotification(
                'success',
                t('接入命令已复制', 'Command copied to clipboard'),
            );
        } catch {
            showNotification(
                'error',
                t(
                    '无法访问剪贴板，请手动选择并复制',
                    'Clipboard unavailable. Please select and copy manually.',
                ),
            );
        }
    };

    const authRequired = status.authRequired !== false;
    const visibleTokenSegment = !authRequired
        ? ''
        : tokenRevealed && tokenValue
          ? tokenValue
          : MASKED_TOKEN_PLACEHOLDER;

    const snippets = useMemo(
        () =>
            buildSnippets(status.port || DEFAULT_PORT, visibleTokenSegment),
        [status.port, visibleTokenSegment],
    );

    const isEnabled = Boolean(
        status.enabled ?? (status.localApiEnabled || status.mcpEnabled),
    );
    const listenAddress =
        status.baseUrl || `http://127.0.0.1:${status.port || DEFAULT_PORT}`;
    const portDirty = portInput.trim() !== String(status.port || DEFAULT_PORT);
    const hasStartFailure = isEnabled && !status.running;
    const controlsDisabled = busy || loading || !bridgeAvailable;
    const runningProfiles = status.runningProfiles || [];

    const translatedLastError = status.lastError
        ? translateBackendMessage(
              cleanIpcError(status.lastError, status.lastError),
              locale,
          )
        : '';
    const isPortBindError = Boolean(
        status.lastError &&
            /端口|port|EADDRINUSE|EACCES|占用|保留|in use|reserved/i.test(
                status.lastError,
            ),
    );
    const translatedActionError = actionError
        ? translateBackendMessage(actionError, locale)
        : '';

    const snippetTabs: Array<{
        id: SnippetTab;
        label: string;
        testId: string;
    }> = [
        {
            id: 'mcpJson',
            label: 'MCP JSON',
            testId: 'automation-snippet-tab-mcp-json',
        },
        {
            id: 'claudeCli',
            label: 'Claude Code',
            testId: 'automation-snippet-tab-claude-cli',
        },
        {
            id: 'devtoolsMcp',
            label: 'DevTools MCP',
            testId: 'automation-snippet-tab-devtools-mcp',
        },
        {
            id: 'playwrightCode',
            label: 'Playwright',
            testId: 'automation-snippet-tab-playwright-code',
        },
    ];

    return (
        <div className={styles.stack} data-testid="automation-settings-panel">
            {/* 1. 本地服务 */}
            <div className={styles.card} data-testid="automation-status-card">
                <div className={styles.cardHeader}>
                    <div className={styles.cardTitleGroup}>
                        <PlugConnectedRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('blue')}
                        />
                        <h2 className={styles.cardTitle}>
                            {t('本地服务', 'Local Service')}
                        </h2>
                        <InfoTip
                            content={t(
                                '在 127.0.0.1 提供标准 CDP 透传守卫与 4 个环境启停 MCP 工具，兼容官方 @playwright/mcp 与 chrome-devtools-mcp；自动忽略外部指纹覆盖指令，并在代理断开时同步断开连接。',
                                'Exposes a guarded standard CDP endpoint and 4 profile lifecycle MCP tools on 127.0.0.1. Compatible with official @playwright/mcp and chrome-devtools-mcp while ignoring external fingerprint overrides and disconnecting if the proxy drops.',
                            )}
                        />
                    </div>
                    <div className={styles.headerMeta}>
                        <code
                            className={styles.addressMeta}
                            data-testid="automation-base-url"
                        >
                            {listenAddress}
                        </code>
                        <Badge
                            data-testid="automation-running-badge"
                            appearance="tint"
                            color={
                                status.running
                                    ? 'success'
                                    : hasStartFailure
                                      ? 'danger'
                                      : 'subtle'
                            }
                        >
                            {status.running
                                ? t('运行中', 'Running')
                                : hasStartFailure
                                  ? t('启动失败', 'Start Failed')
                                  : t('已停止', 'Stopped')}
                        </Badge>
                    </div>
                </div>

                {loading && (
                    <div className={styles.loadingBox}>
                        <Spinner size="tiny" />
                        <span>
                            {t('正在读取服务状态…', 'Loading service status…')}
                        </span>
                    </div>
                )}

                {!bridgeAvailable && !loading && (
                    <MessageBar intent="warning" layout="multiline">
                        <MessageBarBody>
                            {t(
                                '当前运行环境尚未挂载本地自动化接口。',
                                'Local automation IPC bridge is unavailable.',
                            )}
                        </MessageBarBody>
                    </MessageBar>
                )}

                {translatedLastError && (
                    <MessageBar
                        intent="error"
                        layout="multiline"
                        data-testid="automation-last-error"
                    >
                        <MessageBarBody>{translatedLastError}</MessageBarBody>
                        {automationApi.canPickAvailablePort() &&
                            isPortBindError && (
                            <MessageBarActions>
                                <Button
                                    type="button"
                                    size="small"
                                    appearance="outline"
                                    data-testid="automation-auto-pick-port-banner"
                                    disabled={busy || loading}
                                    onClick={() =>
                                        void handlePickAvailablePort()
                                    }
                                >
                                    {t('自动切换可用端口', 'Use Free Port')}
                                </Button>
                            </MessageBarActions>
                        )}
                    </MessageBar>
                )}

                {translatedActionError && (
                    <MessageBar
                        intent="error"
                        layout="multiline"
                        data-testid="automation-action-error"
                    >
                        <MessageBarBody>{translatedActionError}</MessageBarBody>
                    </MessageBar>
                )}

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('启用本地 CDP 与 MCP', 'Enable Local CDP & MCP')}
                    </span>
                    <Switch
                        data-testid="automation-enable-switch"
                        checked={isEnabled}
                        disabled={controlsDisabled}
                        onChange={(_, data) =>
                            void handleUpdateConfig({
                                enabled: data.checked,
                            })
                        }
                    />
                </div>

                <div className={styles.divider} />

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('当前调试环境', 'Target Profile')}
                        <InfoTip
                            content={t(
                                '官方 @playwright/mcp 或 chrome-devtools-mcp 连接固定端口时默认控制的环境；仅运行 1 个环境时自动命中，运行多个环境时在此选择防连错号。',
                                'Target profile controlled by @playwright/mcp or chrome-devtools-mcp on the fixed port. Automatically selects when 1 profile is running; pick explicitly when multiple profiles are open.',
                            )}
                        />
                    </span>
                    <Select
                        className={styles.profileSelect}
                        data-testid="automation-active-profile-select"
                        disabled={controlsDisabled || runningProfiles.length === 0}
                        value={status.activeProfileId || ''}
                        aria-label={t('当前调试环境', 'Target Profile')}
                        onChange={(_, data) =>
                            void handleActiveProfileChange(data.value)
                        }
                    >
                        <option value="">
                            {runningProfiles.length === 0
                                ? t('暂无运行中的环境', 'No running profiles')
                                : t(
                                      '自动（单环境自动命中）',
                                      'Auto (Single running profile)',
                                  )}
                        </option>
                        {runningProfiles.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                            </option>
                        ))}
                    </Select>
                </div>

                <div className={styles.divider} />

                <div className={styles.row}>
                    <span className={styles.rowLabel}>
                        {t('监听端口', 'Port')}
                        <InfoTip
                            content={t(
                                '仅监听 127.0.0.1 回环接口（范围 1024–65535），修改后立即生效。',
                                'Binds strictly to 127.0.0.1 loopback (1024–65535) and applies immediately.',
                            )}
                        />
                    </span>
                    <div className={styles.inlineControls}>
                        <Input
                            data-testid="automation-port-input"
                            className={styles.portInput}
                            type="number"
                            min={1024}
                            max={65535}
                            disabled={controlsDisabled}
                            value={portInput}
                            aria-label={t(
                                '本地服务端口',
                                'Local service port',
                            )}
                            onChange={(_, data) => {
                                setPortInput(data.value);
                                if (actionError) setActionError('');
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void handleApplyPort();
                                }
                            }}
                        />
                        <Button
                            type="button"
                            className={styles.portApplyBtn}
                            data-testid="automation-apply-port"
                            appearance="outline"
                            disabled={
                                controlsDisabled ||
                                (!portDirty && !hasStartFailure)
                            }
                            onClick={() => void handleApplyPort()}
                        >
                            {!portDirty && hasStartFailure
                                ? t('重试', 'Retry')
                                : t('应用', 'Apply')}
                        </Button>
                        {automationApi.canPickAvailablePort() && (
                            <Tooltip
                                content={t(
                                    '自动探测并切换到可用端口',
                                    'Find and apply an available port',
                                )}
                                relationship="label"
                            >
                                <Button
                                    type="button"
                                    className={styles.portAutoBtn}
                                    data-testid="automation-auto-pick-port"
                                    appearance="subtle"
                                    disabled={busy || loading}
                                    onClick={() =>
                                        void handlePickAvailablePort()
                                    }
                                >
                                    {t('自动', 'Auto')}
                                </Button>
                            </Tooltip>
                        )}
                    </div>
                </div>

                {authRequired && (
                    <>
                        <div className={styles.divider} />

                        <div className={styles.row}>
                            <span className={styles.rowLabel}>
                                {t('访问密钥', 'Access Token')}
                                <InfoTip
                                    content={t(
                                        '本地 CDP 与 MCP 接口强制校验随机访问密钥（经系统密钥链加密保存、恒定时间比对），防止本机未授权进程接管浏览器会话；点击下方快速接入的复制按钮会自动填入真实密钥。',
                                        'Local CDP and MCP endpoints require an encrypted random access token verified in constant time so unauthorized local processes cannot hijack browser sessions. Copying a snippet below fills in the active token automatically.',
                                    )}
                                />
                            </span>
                            <div
                                className={styles.inlineControls}
                                data-testid="automation-token-controls"
                            >
                                <code
                                    className={styles.tokenBadge}
                                    data-testid="automation-token-display"
                                >
                                    {tokenRevealed && tokenValue
                                        ? tokenValue
                                        : MASKED_TOKEN_PLACEHOLDER}
                                </code>
                                <Tooltip
                                    content={
                                        tokenRevealed
                                            ? t('隐藏密钥', 'Hide token')
                                            : t('显示密钥', 'Show token')
                                    }
                                    relationship="label"
                                >
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        data-testid="automation-toggle-token"
                                        icon={
                                            tokenRevealed ? (
                                                <EyeOffRegular />
                                            ) : (
                                                <EyeRegular />
                                            )
                                        }
                                        aria-label={
                                            tokenRevealed
                                                ? t('隐藏密钥', 'Hide token')
                                                : t('显示密钥', 'Show token')
                                        }
                                        disabled={controlsDisabled}
                                        onClick={() =>
                                            void handleToggleRevealToken()
                                        }
                                    />
                                </Tooltip>
                                <Tooltip
                                    content={t('复制密钥', 'Copy token')}
                                    relationship="label"
                                >
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        data-testid="automation-copy-token"
                                        icon={
                                            copiedKey === 'token' ? (
                                                <CheckmarkRegular />
                                            ) : (
                                                <CopyRegular />
                                            )
                                        }
                                        aria-label={t('复制密钥', 'Copy token')}
                                        disabled={controlsDisabled}
                                        onClick={() => void handleCopyToken()}
                                    />
                                </Tooltip>
                                <Tooltip
                                    content={t(
                                        '重置密钥并立即断开旧连接',
                                        'Reset token and disconnect existing sessions',
                                    )}
                                    relationship="label"
                                >
                                    <Button
                                        type="button"
                                        size="small"
                                        appearance="subtle"
                                        data-testid="automation-rotate-token"
                                        icon={<ArrowClockwiseRegular />}
                                        aria-label={t('重置密钥', 'Reset token')}
                                        disabled={controlsDisabled}
                                        onClick={() => void handleRotateToken()}
                                    />
                                </Tooltip>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* 2. 快速接入（默认折叠） */}
            <div className={styles.card} data-testid="automation-snippets-card">
                <div className={styles.cardHeader}>
                    <div className={styles.cardTitleGroup}>
                        <CodeRegular
                            className={styles.sectionIcon}
                            style={getToneStyle('violet')}
                        />
                        <h2 className={styles.cardTitle}>
                            {t('快速接入', 'Quick Connect')}
                        </h2>
                    </div>
                    <div className={styles.headerMeta}>
                        {!snippetsOpen && (
                            <span className={styles.mutedMeta}>
                                @playwright/mcp · chrome-devtools-mcp · Playwright
                            </span>
                        )}
                        <Button
                            type="button"
                            size="small"
                            appearance="subtle"
                            data-testid="automation-snippets-toggle"
                            icon={
                                snippetsOpen ? (
                                    <ChevronUpRegular />
                                ) : (
                                    <ChevronDownRegular />
                                )
                            }
                            iconPosition="after"
                            onClick={() => setSnippetsOpen((prev) => !prev)}
                        >
                            {snippetsOpen
                                ? t('收起', 'Collapse')
                                : t('展开', 'Expand')}
                        </Button>
                    </div>
                </div>

                {snippetsOpen && (
                    <>
                        <div className={styles.snippetToolbar}>
                            <div
                                className={styles.pillTabsBar}
                                role="tablist"
                                aria-label={t(
                                    '接入标准选择',
                                    'Integration standard',
                                )}
                            >
                                {snippetTabs.map((tab) => {
                                    const active = snippetTab === tab.id;
                                    return (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            role="tab"
                                            aria-selected={active}
                                            data-testid={tab.testId}
                                            className={mergeClasses(
                                                styles.pillTab,
                                                active && styles.pillTabActive,
                                            )}
                                            onClick={() =>
                                                setSnippetTab(tab.id)
                                            }
                                        >
                                            {tab.label}
                                        </button>
                                    );
                                })}
                            </div>

                            <Button
                                type="button"
                                size="small"
                                appearance="subtle"
                                data-testid="automation-copy-snippet"
                                icon={
                                    copiedKey === snippetTab ? (
                                        <CheckmarkRegular />
                                    ) : (
                                        <CopyRegular />
                                    )
                                }
                                onClick={() => void handleCopySnippet()}
                            >
                                {copiedKey === snippetTab
                                    ? t('已复制', 'Copied')
                                    : t('复制', 'Copy')}
                            </Button>
                        </div>

                        <pre
                            className={styles.codeSurface}
                            data-testid="automation-snippet-code"
                        >
                            {snippets[snippetTab]}
                        </pre>
                    </>
                )}
            </div>
        </div>
    );
};

export default AutomationSettingsPanel;
