import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Button,
    Select,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowSyncRegular,
    ChevronDownRegular,
    ChevronUpRegular,
    DeleteRegular,
    DismissRegular,
    PauseRegular,
    PlayRegular,
    SearchRegular,
} from '@fluentui/react-icons';
import { ManagedProxy, ProxyLog } from '../../types';
import { translateBackendMessage, useI18n } from '../../i18n';
import {
    type LogLevelFilter,
    type LogScope,
} from '../../utils/logWorkspace';

export type { LogScope, LogLevelFilter };

interface LogDockPanelProps {
    open: boolean;
    height: number;
    onHeightChange: (nextHeight: number) => void;
    onCollapse: () => void;
    proxies: ManagedProxy[];
    scopeLabel: string;
    hasTarget: boolean;
    emptyMessage?: string;
    errorMessage?: string;
    scope: LogScope;
    onScopeChange: (scope: LogScope) => void;
    level: LogLevelFilter;
    onLevelChange: (level: LogLevelFilter) => void;
    logs: ProxyLog[];
    paused: boolean;
    onTogglePaused: () => void;
    followLatest: boolean;
    onToggleFollowLatest: () => void;
    onRefresh: () => void;
    onClear: () => void;
    busy?: boolean;
    jumpToErrorTick?: number;
}

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        backgroundColor: 'var(--glass-card)',
        borderTop: '1px solid var(--glass-border)',
        position: 'relative',
        overflow: 'hidden',
        minHeight: '120px',
    },
    resizer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '5px',
        cursor: 'ns-resize',
        zIndex: 4,
        '&:hover': {
            backgroundColor: tokens.colorBrandBackground,
            opacity: 0.45,
        },
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        minHeight: '38px',
        padding: '4px 14px 4px 20px',
        flexShrink: 0,
    },
    headerLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
        flex: 1,
    },
    title: {
        fontSize: '13px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
        whiteSpace: 'nowrap',
    },
    select: {
        minWidth: '116px',
        maxWidth: '200px',
        flexShrink: 1,
    },
    liveMeta: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '240px',
        minWidth: 0,
    },
    headerRight: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        flexShrink: 0,
    },
    followToggle: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '26px',
        padding: '0 10px',
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid transparent',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '12px',
        fontWeight: 500,
        fontFamily: 'inherit',
        cursor: 'pointer',
        transitionProperty: 'background-color, border-color, color',
        transitionDuration: '100ms',
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground1,
        },
        '&:disabled': {
            opacity: 0.45,
            cursor: 'not-allowed',
        },
        '&:focus-visible': {
            outline: `1px solid ${tokens.colorBrandForeground1}`,
            outlineOffset: '1px',
        },
    },
    followToggleActive: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
        color: tokens.colorBrandForeground1,
        fontWeight: 600,
    },
    followDot: {
        width: '6px',
        height: '6px',
        borderRadius: '999px',
        backgroundColor: tokens.colorNeutralForeground4,
    },
    followDotActive: {
        backgroundColor: tokens.colorBrandForeground1,
    },
    console: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'auto',
        padding: '6px 14px 8px 20px',
        fontFamily: tokens.fontFamilyMonospace,
        fontSize: '12px',
        lineHeight: '1.65',
        backgroundColor: 'var(--glass-card-inner)',
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    line: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '10px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        padding: '1px 4px',
        margin: '0 -4px',
        borderRadius: tokens.borderRadiusSmall,
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
        },
    },
    time: {
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
        fontVariantNumeric: 'tabular-nums',
    },
    levelInfo: {
        color: tokens.colorBrandForeground1,
        fontWeight: 600,
        flexShrink: 0,
        minWidth: '28px',
    },
    levelError: {
        color: tokens.colorPaletteRedForeground1,
        fontWeight: 600,
        flexShrink: 0,
        minWidth: '28px',
    },
    message: {
        color: tokens.colorNeutralForeground1,
    },
    messageError: {
        color: tokens.colorPaletteRedForeground1,
    },
    lineHighlighted: {
        backgroundColor: tokens.colorPaletteRedBackground1,
        borderRadius: '4px',
        padding: '1px 4px',
        margin: '0 -4px',
    },
    lineSearchActive: {
        backgroundColor: tokens.colorPaletteYellowBackground2,
        borderRadius: '4px',
        padding: '1px 4px',
        margin: '0 -4px',
    },
    searchBar: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 14px 4px 20px',
        backgroundColor: tokens.colorNeutralBackground3,
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        flexShrink: 0,
    },
    searchInputWrap: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flex: '0 1 280px',
        minWidth: '140px',
        height: '26px',
        padding: '0 8px',
        borderRadius: tokens.borderRadiusMedium,
        border: `1px solid ${tokens.colorNeutralStroke1}`,
        backgroundColor: tokens.colorNeutralBackground1,
        '&:focus-within': {
            border: `1px solid ${tokens.colorBrandStroke1}`,
        },
    },
    searchInput: {
        flex: 1,
        minWidth: 0,
        border: 'none',
        outline: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground1,
        fontSize: '12px',
        fontFamily: 'inherit',
    },
    searchMeta: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        fontVariantNumeric: 'tabular-nums',
        minWidth: '52px',
        whiteSpace: 'nowrap',
    },
    searchMark: {
        backgroundColor: tokens.colorPaletteYellowBackground3,
        color: tokens.colorNeutralForeground1,
        borderRadius: '2px',
        padding: '0 1px',
    },
    searchMarkActive: {
        backgroundColor: tokens.colorPaletteDarkOrangeBackground3,
        color: tokens.colorNeutralForegroundInverted,
        borderRadius: '2px',
        padding: '0 1px',
        fontWeight: 600,
    },
    empty: {
        color: tokens.colorNeutralForeground2,
        fontFamily: tokens.fontFamilyBase,
        fontSize: '13px',
        padding: '14px 0',
    },
    error: {
        color: tokens.colorPaletteRedForeground1,
        fontFamily: tokens.fontFamilyBase,
        fontSize: '13px',
        padding: '6px 0',
    },
});

const LogDockPanel: React.FC<LogDockPanelProps> = ({
    open,
    height,
    onHeightChange,
    onCollapse,
    proxies,
    scopeLabel,
    hasTarget,
    emptyMessage,
    errorMessage,
    scope,
    onScopeChange,
    level,
    onLevelChange,
    logs,
    paused,
    onTogglePaused,
    followLatest,
    onToggleFollowLatest,
    onRefresh,
    onClear,
    busy,
    jumpToErrorTick = 0,
}) => {
    const styles = useStyles();
    const { locale, isEn, t } = useI18n();
    const consoleRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [highlightedLogId, setHighlightedLogId] = useState<string | null>(
        null,
    );
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [activeMatchIdx, setActiveMatchIdx] = useState(0);
    const dragRef = useRef<{ startY: number; startHeight: number } | null>(
        null,
    );
    const dragCleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => () => dragCleanupRef.current?.(), []);

    const visibleLogs = useMemo(
        () => logs.filter((entry) => level === 'all' || entry.level === level),
        [logs, level],
    );
    const visibleLogsRef = useRef(visibleLogs);
    visibleLogsRef.current = visibleLogs;
    const lastLogId =
        visibleLogs.length > 0 ? visibleLogs[visibleLogs.length - 1].id : '';

    const normalizedQuery = searchOpen ? searchQuery.trim().toLowerCase() : '';

    const matchedIds = useMemo(() => {
        if (!normalizedQuery) return [] as string[];
        const proxyNameById = new Map(proxies.map((p) => [p.id, p.name]));
        const deletedLabel = isEn ? 'Deleted Proxy' : '已删除代理';
        const ids: string[] = [];
        for (const entry of visibleLogs) {
            const proxyName = proxyNameById.get(entry.proxyId) || deletedLabel;
            const text = translateBackendMessage(entry.message, locale);
            const timeStr = new Date(entry.time).toLocaleTimeString(locale, {
                hour12: false,
            });
            const levelLabel =
                entry.level === 'error'
                    ? isEn
                        ? 'ERR error'
                        : '错误 error'
                    : isEn
                      ? 'INFO info'
                      : '信息 info';
            const haystack =
                `${timeStr} ${levelLabel} [${proxyName}] ${text}`.toLowerCase();
            if (haystack.includes(normalizedQuery)) {
                ids.push(entry.id);
            }
        }
        return ids;
    }, [normalizedQuery, visibleLogs, proxies, isEn, locale]);

    const safeMatchIdx =
        matchedIds.length > 0
            ? Math.min(activeMatchIdx, matchedIds.length - 1)
            : 0;
    const activeMatchedId =
        matchedIds.length > 0 ? matchedIds[safeMatchIdx] : null;

    // 面板展开时拦截 Ctrl+F / Cmd+F 打开日志搜索栏
    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                (event.ctrlKey || event.metaKey) &&
                !event.altKey &&
                event.key.toLowerCase() === 'f'
            ) {
                if (document.querySelector('[role="dialog"]')) return;
                event.preventDefault();
                setSearchOpen(true);
                window.requestAnimationFrame(() => {
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                });
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    // 滚动到当前命中的搜索结果行
    useEffect(() => {
        if (!open || !activeMatchedId) return;
        const container = consoleRef.current;
        if (!container) return;
        const frame = window.requestAnimationFrame(() => {
            const el = container.querySelector<HTMLElement>(
                `[data-log-id="${CSS.escape(activeMatchedId)}"]`,
            );
            el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [open, activeMatchedId, safeMatchIdx]);

    const handleStepMatch = (delta: 1 | -1) => {
        if (matchedIds.length === 0) return;
        setActiveMatchIdx(
            (prev) =>
                (prev + delta + matchedIds.length) % matchedIds.length,
        );
    };

    const renderHighlightedText = (text: string, isActiveRow: boolean) => {
        if (!normalizedQuery) return text;
        const lower = text.toLowerCase();
        const nodes: React.ReactNode[] = [];
        let cursor = 0;
        let matchIndex = lower.indexOf(normalizedQuery, cursor);
        let keySeq = 0;
        while (matchIndex !== -1) {
            if (matchIndex > cursor) {
                nodes.push(text.slice(cursor, matchIndex));
            }
            const hit = text.slice(
                matchIndex,
                matchIndex + normalizedQuery.length,
            );
            nodes.push(
                <mark
                    key={keySeq++}
                    className={
                        isActiveRow
                            ? styles.searchMarkActive
                            : styles.searchMark
                    }
                >
                    {hit}
                </mark>,
            );
            cursor = matchIndex + normalizedQuery.length;
            matchIndex = lower.indexOf(normalizedQuery, cursor);
        }
        if (cursor < text.length) {
            nodes.push(text.slice(cursor));
        }
        return nodes;
    };

    // 仅在开启“跟随最新”且有新日志到达时滚动到底部；搜索激活时不抢占滚动位置
    useEffect(() => {
        if (!open || !followLatest || paused || Boolean(normalizedQuery)) return;
        const container = consoleRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
    }, [open, followLatest, paused, normalizedQuery, lastLogId, visibleLogs.length]);

    // 点击状态栏错误计数徽章时，定位并高亮最新错误日志
    useEffect(() => {
        if (!open || !jumpToErrorTick) return;
        const container = consoleRef.current;
        const errorEntries = visibleLogsRef.current.filter(
            (entry) => entry.level === 'error',
        );
        const targetEntry =
            errorEntries.length > 0
                ? errorEntries[errorEntries.length - 1]
                : null;
        if (!targetEntry) return;
        setHighlightedLogId(targetEntry.id);
        const frame = window.requestAnimationFrame(() => {
            const el = container?.querySelector<HTMLElement>(
                `[data-log-id="${CSS.escape(targetEntry.id)}"]`,
            );
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (container) {
                container.scrollTop = container.scrollHeight;
            }
        });
        const timer = window.setTimeout(() => {
            setHighlightedLogId((current) =>
                current === targetEntry.id ? null : current,
            );
        }, 1800);
        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(timer);
        };
    }, [open, jumpToErrorTick]);

    const handleResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragCleanupRef.current?.();
        dragRef.current = { startY: event.clientY, startHeight: height };

        const handleMouseMove = (moveEvent: MouseEvent) => {
            if (!dragRef.current) return;
            const delta = dragRef.current.startY - moveEvent.clientY;
            const maxHeight = Math.max(
                120,
                Math.floor(window.innerHeight * 0.48),
            );
            const next = Math.min(
                maxHeight,
                Math.max(120, dragRef.current.startHeight + delta),
            );
            onHeightChange(next);
        };

        const handleMouseUp = () => {
            dragRef.current = null;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
            dragCleanupRef.current = null;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        dragCleanupRef.current = handleMouseUp;
    };

    if (!open) return null;

    const followActive = followLatest && !paused;
    const maxHeight = Math.max(120, Math.floor(window.innerHeight * 0.48));
    const missingPinnedProxy =
        scope !== '__selected__' &&
        scope !== '__all__' &&
        !proxies.some((proxy) => proxy.id === scope);

    return (
        <section
            id="proxy-log-dock"
            className={styles.root}
            style={{ height: `${height}px` }}
            aria-label={t('运行日志面板', 'Runtime log panel')}
        >
            <div
                className={styles.resizer}
                role="separator"
                aria-orientation="horizontal"
                aria-label={t('拖拽调整日志面板高度', 'Drag to resize log panel')}
                aria-valuenow={Math.round(height)}
                aria-valuemin={120}
                aria-valuemax={maxHeight}
                tabIndex={0}
                onMouseDown={handleResizeStart}
                onKeyDown={(event) => {
                    const next =
                        event.key === 'ArrowUp'
                            ? height + 20
                            : event.key === 'ArrowDown'
                              ? height - 20
                              : event.key === 'Home'
                                ? 120
                                : event.key === 'End'
                                  ? maxHeight
                                  : null;
                    if (next === null) return;
                    event.preventDefault();
                    onHeightChange(Math.min(maxHeight, Math.max(120, next)));
                }}
            />

            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <span className={styles.title}>
                        {t('代理日志', 'Proxy Logs')}
                    </span>
                    <Select
                        size="small"
                        appearance="filled-lighter"
                        aria-label={t('日志代理范围', 'Log proxy scope')}
                        className={styles.select}
                        value={scope}
                        onChange={(_, data) => onScopeChange(data.value)}
                    >
                        <option value="__selected__">
                            {t('跟随所选', 'Follow Selected')}
                        </option>
                        <option value="__all__">
                            {t('全部代理', 'All Proxies')}
                        </option>
                        {missingPinnedProxy && (
                            <option value={scope}>
                                {t('固定：代理已移除', 'Pinned: Removed')}
                            </option>
                        )}
                        {proxies.map((proxy) => (
                            <option key={proxy.id} value={proxy.id}>
                                {isEn ? `Pinned: ${proxy.name}` : `固定：${proxy.name}`}
                            </option>
                        ))}
                    </Select>
                    <Select
                        size="small"
                        appearance="filled-lighter"
                        aria-label={t('日志级别筛选', 'Filter by log level')}
                        value={level}
                        onChange={(_, data) =>
                            onLevelChange(data.value as LogLevelFilter)
                        }
                    >
                        <option value="all">{t('全部级别', 'All Levels')}</option>
                        <option value="info">{t('仅信息', 'Info Only')}</option>
                        <option value="error">{t('仅错误', 'Errors Only')}</option>
                    </Select>
                    <span
                        className={styles.liveMeta}
                        title={`${scopeLabel} · ${paused ? t('已暂停', 'Paused') : t('自动刷新', 'Auto-refreshing')}`}
                    >
                        {scopeLabel}
                    </span>
                </div>

                <div className={styles.headerRight}>
                    <Tooltip
                        content={t('搜索日志 (Ctrl+F)', 'Find in logs (Ctrl+F)')}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance={searchOpen ? 'secondary' : 'subtle'}
                            icon={<SearchRegular />}
                            aria-label={t('搜索日志', 'Find in logs')}
                            aria-pressed={searchOpen}
                            onClick={() => {
                                setSearchOpen((prev) => {
                                    const next = !prev;
                                    if (next) {
                                        window.requestAnimationFrame(() => {
                                            searchInputRef.current?.focus();
                                            searchInputRef.current?.select();
                                        });
                                    }
                                    return next;
                                });
                            }}
                        />
                    </Tooltip>
                    <button
                        type="button"
                        aria-pressed={followActive}
                        disabled={paused || !hasTarget}
                        className={mergeClasses(
                            styles.followToggle,
                            followActive && styles.followToggleActive,
                        )}
                        onClick={onToggleFollowLatest}
                    >
                        <span
                            className={mergeClasses(
                                styles.followDot,
                                followActive && styles.followDotActive,
                            )}
                        />
                        {t('跟随最新', 'Follow Latest')}
                    </button>
                    <Tooltip
                        content={
                            paused
                                ? t('恢复自动刷新', 'Resume auto-refresh')
                                : t('暂停自动刷新', 'Pause auto-refresh')
                        }
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance={paused ? 'secondary' : 'subtle'}
                            icon={paused ? <PlayRegular /> : <PauseRegular />}
                            disabled={!hasTarget}
                            onClick={onTogglePaused}
                        >
                            {paused ? t('继续', 'Resume') : t('暂停', 'Pause')}
                        </Button>
                    </Tooltip>
                    <Tooltip
                        content={t('立即刷新日志', 'Refresh logs now')}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ArrowSyncRegular />}
                            aria-label={t('刷新日志', 'Refresh logs')}
                            disabled={!hasTarget}
                            onClick={onRefresh}
                        />
                    </Tooltip>
                    <Tooltip
                        content={t('清空当前范围日志', 'Clear logs in current scope')}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<DeleteRegular />}
                            aria-label={t('清空日志', 'Clear logs')}
                            disabled={busy || !hasTarget}
                            onClick={onClear}
                        />
                    </Tooltip>
                    <Tooltip
                        content={t('收起日志面板', 'Collapse log panel')}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ChevronDownRegular />}
                            aria-label={t('收起日志面板', 'Collapse log panel')}
                            onClick={onCollapse}
                        />
                    </Tooltip>
                </div>
            </div>

            {searchOpen && (
                <div
                    className={styles.searchBar}
                    role="search"
                    aria-label={t('搜索代理日志', 'Search proxy logs')}
                >
                    <div className={styles.searchInputWrap}>
                        <SearchRegular
                            style={{
                                fontSize: '13px',
                                color: tokens.colorNeutralForeground3,
                                flexShrink: 0,
                            }}
                        />
                        <input
                            ref={searchInputRef}
                            type="text"
                            className={styles.searchInput}
                            value={searchQuery}
                            placeholder={t(
                                '搜索域名、IP 或错误信息… (Enter 下一个)',
                                'Find host, IP, or error… (Enter for next)',
                            )}
                            onChange={(event) => {
                                setSearchQuery(event.target.value);
                                setActiveMatchIdx(0);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    handleStepMatch(event.shiftKey ? -1 : 1);
                                } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    setSearchOpen(false);
                                }
                            }}
                        />
                    </div>
                    <span className={styles.searchMeta}>
                        {normalizedQuery
                            ? matchedIds.length > 0
                                ? `${safeMatchIdx + 1} / ${matchedIds.length}`
                                : t('无匹配', '0 / 0')
                            : ''}
                    </span>
                    <Tooltip
                        content={t('上一个匹配 (Shift+Enter)', 'Previous match (Shift+Enter)')}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ChevronUpRegular />}
                            aria-label={t('上一个匹配', 'Previous match')}
                            disabled={matchedIds.length === 0}
                            onClick={() => handleStepMatch(-1)}
                        />
                    </Tooltip>
                    <Tooltip
                        content={t('下一个匹配 (Enter)', 'Next match (Enter)')}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<ChevronDownRegular />}
                            aria-label={t('下一个匹配', 'Next match')}
                            disabled={matchedIds.length === 0}
                            onClick={() => handleStepMatch(1)}
                        />
                    </Tooltip>
                    <Tooltip
                        content={t('关闭搜索 (Esc)', 'Close search (Esc)')}
                        relationship="label"
                    >
                        <Button
                            size="small"
                            appearance="subtle"
                            icon={<DismissRegular />}
                            aria-label={t('关闭搜索', 'Close search')}
                            onClick={() => setSearchOpen(false)}
                        />
                    </Tooltip>
                </div>
            )}

            <div
                ref={consoleRef}
                className={styles.console}
                role="log"
                aria-label={t('代理连接与运行记录', 'Proxy connection and runtime logs')}
                aria-live="off"
                data-selectable="true"
                onScroll={() => {
                    const el = consoleRef.current;
                    if (!el || !followLatest) return;
                    const nearBottom =
                        el.scrollHeight - el.scrollTop - el.clientHeight < 28;
                    if (!nearBottom) {
                        onToggleFollowLatest();
                    }
                }}
            >
                {errorMessage && (
                    <div className={styles.error} role="status">
                        {errorMessage}
                    </div>
                )}
                {visibleLogs.length > 0 ? (
                    visibleLogs.map((entry) => {
                        const proxyName =
                            proxies.find((p) => p.id === entry.proxyId)?.name ||
                            t('已删除代理', 'Deleted Proxy');
                        const isError = entry.level === 'error';
                        const isActiveMatch = activeMatchedId === entry.id;
                        const timeText = new Date(entry.time).toLocaleTimeString(
                            locale,
                            {
                                hour12: false,
                            },
                        );
                        const levelText = isError
                            ? t('错误', 'ERR')
                            : t('信息', 'INFO');
                        const renderedMessage = `[${proxyName}] ${translateBackendMessage(
                            entry.message,
                            locale,
                        )}`;
                        return (
                            <div
                                key={entry.id}
                                data-log-id={entry.id}
                                className={mergeClasses(
                                    styles.line,
                                    highlightedLogId === entry.id &&
                                        styles.lineHighlighted,
                                    isActiveMatch && styles.lineSearchActive,
                                )}
                            >
                                <time className={styles.time}>
                                    {renderHighlightedText(
                                        timeText,
                                        isActiveMatch,
                                    )}
                                </time>
                                <span
                                    className={
                                        isError
                                            ? styles.levelError
                                            : styles.levelInfo
                                    }
                                >
                                    {renderHighlightedText(
                                        levelText,
                                        isActiveMatch,
                                    )}
                                </span>
                                <span
                                    className={mergeClasses(
                                        styles.message,
                                        isError && styles.messageError,
                                    )}
                                >
                                    {renderHighlightedText(
                                        renderedMessage,
                                        isActiveMatch,
                                    )}
                                </span>
                            </div>
                        );
                    })
                ) : (
                    <div className={styles.empty}>
                        {emptyMessage ||
                            (paused
                                ? t(
                                      '已暂停。继续刷新以查看当前范围的日志。',
                                      'Paused. Resume to view logs for the current scope.',
                                  )
                                : level !== 'all'
                                  ? t(
                                        '当前范围没有此级别的日志。',
                                        'No logs at this level in the current scope.',
                                    )
                                  : t(
                                        '暂无日志。启动代理并打开已绑定环境后，这里会显示连接与运行记录。',
                                        'No logs yet. Start a proxy and launch a bound environment to see connection records here.',
                                    ))}
                    </div>
                )}
            </div>
        </section>
    );
};

export default LogDockPanel;
