import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    Button,
    Dialog,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Input,
    MessageBar,
    MessageBarBody,
    Select,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    DeleteRegular,
    DismissRegular,
    PauseRegular,
    PlayRegular,
    SearchRegular,
} from '@fluentui/react-icons';
import { AppLog } from '../../types';
import { translateBackendMessage, useI18n } from '../../i18n';
import { systemApi } from '../../services';

const useStyles = makeStyles({
    surface: {
        width: 'min(960px, calc(100vw - 48px))',
        maxWidth: '960px',
        height: 'min(660px, calc(100vh - 84px))',
        maxHeight: 'calc(100vh - 84px)',
        padding: '20px',
        overflow: 'hidden',
    },
    body: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexShrink: 0,
    },
    content: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        gap: '12px',
    },
    subtitle: {
        color: tokens.colorNeutralForeground3,
        fontSize: '12px',
        margin: 0,
    },
    toolbar: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap',
        flexShrink: 0,
    },
    search: { flex: 1, minWidth: '180px' },
    log: {
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        border: '1px solid var(--glass-border)',
        borderRadius: tokens.borderRadiusMedium,
        backgroundColor: 'var(--glass-card-inner)',
        padding: '8px 10px',
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: '12px',
        lineHeight: '1.65',
        userSelect: 'text',
        outlineOffset: '-2px',
    },
    row: {
        display: 'grid',
        gridTemplateColumns: '154px 36px minmax(0, 1fr)',
        columnGap: '10px',
        padding: '2px 0',
    },
    time: {
        color: tokens.colorNeutralForeground3,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
    },
    message: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
    info: { color: tokens.colorBrandForeground1 },
    debug: { color: tokens.colorNeutralForeground3 },
    warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
    error: { color: tokens.colorPaletteRedForeground1 },
    footer: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
    },
    empty: {
        padding: '30px 12px',
        textAlign: 'center',
        color: tokens.colorNeutralForeground3,
        fontFamily: tokens.fontFamilyBase,
    },
});

/** A separate application log viewer; proxy connection logs remain in the dock. */
const ApplicationLogsPanel: React.FC<{ onClose: () => void }> = ({
    onClose,
}) => {
    const styles = useStyles();
    const { locale, isEn, t } = useI18n();
    const levelLabels = useMemo(
        () => ({
            debug: t('调试', 'DBG'),
            info: t('信息', 'INFO'),
            warn: t('警告', 'WARN'),
            error: t('错误', 'ERR'),
        }),
        [t],
    );
    const [entries, setEntries] = useState<AppLog[]>([]);
    const [level, setLevel] = useState('all');
    const [search, setSearch] = useState('');
    const [paused, setPaused] = useState(false);
    const [following, setFollowing] = useState(true);
    const [loading, setLoading] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [error, setError] = useState('');
    const alive = useRef(false);
    const clearingRef = useRef(false);
    const generation = useRef(0);
    const pending = useRef<Promise<AppLog[]> | null>(null);
    const entriesSigRef = useRef('');
    const logRef = useRef<HTMLDivElement>(null);
    const previousFocus = useRef<HTMLElement | null>(
        document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
    );

    const load = useCallback(
        async (silent = false) => {
            if (!alive.current || pending.current || clearingRef.current)
                return;
            if (silent && document.hidden) return;
            const version = generation.current;
            if (!silent) setLoading(true);
            let request: Promise<AppLog[]> | null = null;
            try {
                request = systemApi.getAppLogs();
                pending.current = request;
                const logs = await request;
                if (alive.current && version === generation.current) {
                    const firstId = logs[0]?.id || '';
                    const lastId = logs[logs.length - 1]?.id || '';
                    const nextSig = `${logs.length}|${firstId}|${lastId}`;
                    if (nextSig !== entriesSigRef.current) {
                        entriesSigRef.current = nextSig;
                        setEntries(logs);
                    }
                    setError((prev) => (prev ? '' : prev));
                }
            } catch {
                if (alive.current && version === generation.current) {
                    setError(
                        t(
                            '无法读取后台日志，请点击刷新重试。',
                            'Failed to read application logs. Click Refresh to retry.',
                        ),
                    );
                }
            } finally {
                if (pending.current === request) pending.current = null;
                if (alive.current && !silent) setLoading(false);
            }
        },
        [t],
    );

    useEffect(() => {
        alive.current = true;
        if (!previousFocus.current?.isConnected) {
            previousFocus.current =
                document.activeElement instanceof HTMLElement
                    ? document.activeElement
                    : null;
        }
        void load(false);
        return () => {
            alive.current = false;
            generation.current += 1;
            const previous = previousFocus.current;
            requestAnimationFrame(() => {
                if (
                    !document.querySelector('[data-application-logs]') &&
                    previous?.isConnected
                )
                    previous.focus({ preventScroll: true });
            });
        };
    }, [load]);

    useEffect(() => {
        if (paused || clearing) return;
        const handleVisibilityChange = () => {
            if (!document.hidden) {
                void load(true);
            }
        };
        const timer = window.setInterval(() => void load(true), 2000);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            );
        };
    }, [paused, clearing, load]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return entries.filter((entry) => {
            if (level !== 'all' && entry.level !== level) return false;
            if (!term) return true;
            const displayMessage = translateBackendMessage(
                entry.message,
                locale,
            );
            return (
                displayMessage.toLowerCase().includes(term) ||
                entry.message.toLowerCase().includes(term)
            );
        });
    }, [entries, level, search, locale]);

    useEffect(() => {
        if (following && logRef.current)
            logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [filtered, following]);

    const clear = async () => {
        if (clearingRef.current) return;
        clearingRef.current = true;
        generation.current += 1;
        setClearing(true);
        try {
            await systemApi.clearAppLogs();
            if (alive.current) {
                entriesSigRef.current = '';
                setEntries([]);
                setError('');
            }
        } catch {
            if (alive.current)
                setError(
                    t(
                        '清空后台日志失败，请重试。',
                        'Failed to clear application logs. Please retry.',
                    ),
                );
        } finally {
            clearingRef.current = false;
            if (alive.current) setClearing(false);
        }
    };

    return (
        <Dialog
            open
            onOpenChange={(_, data) => {
                if (!data.open) onClose();
            }}
        >
            <DialogSurface className={styles.surface} data-application-logs>
                <DialogBody className={styles.body}>
                    <div className={styles.header}>
                        <DialogTitle>{t('后台日志', 'Application Logs')}</DialogTitle>
                        <Button
                            appearance="subtle"
                            icon={<DismissRegular />}
                            aria-label={t('关闭后台日志', 'Close application logs')}
                            onClick={onClose}
                        />
                    </div>
                    <DialogContent className={styles.content}>
                        <p className={styles.subtitle}>
                            {t(
                                '应用启动、环境操作与错误记录 · 仅保留本次运行最近 1000 条',
                                'App startup, environment actions, and error records · Keeps last 1,000 entries for this session',
                            )}
                        </p>
                        <div className={styles.toolbar}>
                            <Input
                                className={styles.search}
                                contentBefore={<SearchRegular />}
                                placeholder={t('搜索后台日志', 'Search application logs')}
                                aria-label={t('搜索后台日志', 'Search application logs')}
                                value={search}
                                onChange={(_, data) => setSearch(data.value)}
                            />
                            <Select
                                aria-label={t('后台日志级别', 'Application log level')}
                                value={level}
                                onChange={(_, data) => setLevel(data.value)}
                            >
                                <option value="all">{t('全部级别', 'All Levels')}</option>
                                <option value="error">{t('错误', 'Error')}</option>
                                <option value="warn">{t('警告', 'Warn')}</option>
                                <option value="info">{t('信息', 'Info')}</option>
                                <option value="debug">{t('调试', 'Debug')}</option>
                            </Select>
                            <Button
                                size="small"
                                icon={
                                    paused ? <PlayRegular /> : <PauseRegular />
                                }
                                onClick={() => setPaused((value) => !value)}
                            >
                                {paused
                                    ? t('继续刷新', 'Resume')
                                    : t('暂停刷新', 'Pause')}
                            </Button>
                            <Button
                                size="small"
                                icon={<ArrowClockwiseRegular />}
                                disabled={loading || clearing}
                                onClick={() => void load()}
                            >
                                {t('刷新', 'Refresh')}
                            </Button>
                            <Button
                                size="small"
                                icon={<DeleteRegular />}
                                disabled={loading || clearing || entries.length === 0}
                                onClick={() => void clear()}
                            >
                                {clearing
                                    ? t('清空中…', 'Clearing…')
                                    : t('清空', 'Clear')}
                            </Button>
                        </div>
                        {error && (
                            <MessageBar intent="error">
                                <MessageBarBody>{error}</MessageBarBody>
                            </MessageBar>
                        )}
                        <div
                            ref={logRef}
                            className={styles.log}
                            role="log"
                            aria-label={t('应用后台日志记录', 'Application log entries')}
                            aria-live="off"
                            tabIndex={0}
                            data-selectable="true"
                            onScroll={() => {
                                const node = logRef.current;
                                if (
                                    node &&
                                    node.scrollHeight -
                                        node.scrollTop -
                                        node.clientHeight >
                                        24
                                )
                                    setFollowing(false);
                            }}
                        >
                            {filtered.length ? (
                                filtered.map((entry) => (
                                    <div key={entry.id} className={styles.row}>
                                        <time
                                            className={styles.time}
                                            dateTime={entry.time}
                                        >
                                            {new Date(
                                                entry.time,
                                            ).toLocaleString(locale, {
                                                month: '2-digit',
                                                day: '2-digit',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                                hour12: false,
                                            })}
                                        </time>
                                        <span
                                            className={mergeClasses(
                                                styles[entry.level],
                                            )}
                                        >
                                            {levelLabels[entry.level]}
                                        </span>
                                        <span className={styles.message}>
                                            {translateBackendMessage(
                                                entry.message,
                                                locale,
                                            )}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className={styles.empty}>
                                    {loading
                                        ? t(
                                              '正在读取后台日志…',
                                              'Loading application logs…',
                                          )
                                        : error && entries.length === 0
                                          ? null
                                          : search || level !== 'all'
                                            ? t('没有匹配的日志', 'No matching logs')
                                            : t('暂无后台日志', 'No application logs yet')}
                                    {!loading && !error && (search || level !== 'all') && (
                                        <Button appearance="subtle" size="small" onClick={() => { setSearch(''); setLevel('all'); }}>
                                            {t('清除筛选', 'Clear filters')}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className={styles.footer}>
                            <span>
                                {isEn
                                    ? `${filtered.length} / ${entries.length} entries · ${paused ? 'Auto-refresh paused' : 'Refreshing every 2s'}`
                                    : `${filtered.length} / ${entries.length} 条 · ${paused ? '已暂停自动刷新' : '每 2 秒刷新'}`}
                            </span>
                            <Button
                                size="small"
                                appearance={following ? 'primary' : 'subtle'}
                                aria-pressed={following}
                                onClick={() => setFollowing((value) => !value)}
                            >
                                {t('跟随最新', 'Follow Latest')}
                            </Button>
                        </div>
                    </DialogContent>
                </DialogBody>
            </DialogSurface>
        </Dialog>
    );
};

export default ApplicationLogsPanel;
