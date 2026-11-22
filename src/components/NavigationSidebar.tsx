import React, { useState } from 'react';
import {
    Button,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Tooltip,
    makeStyles,
    mergeClasses,
    tokens,
} from '@fluentui/react-components';
import {
    ChevronDownRegular,
    ChevronRightRegular,
    DeleteRegular,
    EditRegular,
    FolderRegular,
    GlobeRegular,
    PanelLeftContractRegular,
    PanelLeftExpandRegular,
    SettingsRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import {
    getGroupStyle,
    getToneStyle,
    AccentTone,
} from '../theme/semanticColors';
import { useI18n } from '../i18n';

export type NavSection = 'environments' | 'proxies' | 'trash' | 'settings';

interface NavigationSidebarProps {
    activeSection: NavSection;
    onSelectSection: (section: NavSection) => void;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    environmentCount: number;
    proxyCount: number;
    trashCount: number;
    groups: string[];
    groupCounts: Record<string, number>;
    currentGroup: string;
    emptyGroups: string[];
    onSelectGroup: (group: string) => void;
    onRequestRenameGroup: (group: string) => void;
    onRequestDeleteGroup: (group: string) => void;
    settingsBadge?: boolean;
    settingsBadgeTooltip?: string;
}

const useStyles = makeStyles({
    sidebar: {
        width: '192px',
        minWidth: '192px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'transparent',
        padding: '4px 8px 8px 8px',
        flexShrink: 0,
        transitionProperty: 'width, min-width',
        transitionDuration: '140ms',
        transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
        overflow: 'hidden',
    },
    sidebarCollapsed: {
        width: '56px',
        minWidth: '56px',
        padding: '4px 6px 8px 6px',
    },
    toggleRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        flexShrink: 0,
        marginBottom: '4px',
        paddingLeft: '5px',
    },
    toggleRowCollapsed: {
        justifyContent: 'center',
        paddingLeft: 0,
    },
    toggleBtn: {
        width: '36px',
        height: '32px',
        borderRadius: '8px',
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        fontSize: '17px',
        transitionProperty: 'background-color, color',
        transitionDuration: '120ms',
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground1,
        },
        '&:active': {
            backgroundColor: tokens.colorSubtleBackgroundPressed,
        },
        '&:focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '-2px',
        },
    },
    topNav: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
    bottomNav: {
        flexShrink: 0,
        paddingTop: '8px',
        marginTop: '6px',
        borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    navItem: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        height: '38px',
        width: '100%',
        padding: '0 10px',
        borderRadius: '10px',
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '13.5px',
        fontWeight: 500,
        fontFamily: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
        transitionProperty: 'background-color, color',
        transitionDuration: '120ms',
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground1,
        },
        '&:active': {
            backgroundColor: tokens.colorSubtleBackgroundPressed,
        },
        '&:focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '-2px',
        },
    },
    navItemCollapsed: {
        justifyContent: 'center',
        padding: '0',
    },
    navRow: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        flexShrink: 0,
    },
    expandableItem: {
        paddingRight: '32px',
    },
    navItemActive: {
        backgroundColor: tokens.colorNeutralBackground1Selected,
        fontWeight: 600,
        '&::before': {
            content: '""',
            position: 'absolute',
            left: '0px',
            top: '9px',
            bottom: '9px',
            width: '3px',
            borderRadius: '999px',
            backgroundColor: tokens.colorBrandBackground,
        },
    },
    navIcon: {
        fontSize: '18px',
        width: '26px',
        height: '26px',
        borderRadius: '7px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: tokens.colorNeutralForeground2,
    },
    navLabel: {
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    navCount: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground3,
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
        minWidth: '20px',
        textAlign: 'center',
        borderRadius: '6px',
        lineHeight: '20px',
        backgroundColor: tokens.colorNeutralBackgroundAlpha2,
    },
    navDot: {
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        backgroundColor: tokens.colorPaletteRedBackground3,
        flexShrink: 0,
    },
    navDotCollapsed: {
        position: 'absolute',
        top: '6px',
        right: '6px',
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        backgroundColor: tokens.colorPaletteRedBackground3,
        boxShadow: `0 0 0 1.5px ${tokens.colorNeutralBackground3}`,
    },
    chevronBtn: {
        position: 'absolute',
        right: '4px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '26px',
        height: '28px',
        padding: 0,
        border: 'none',
        backgroundColor: 'transparent',
        cursor: 'pointer',
        borderRadius: tokens.borderRadiusSmall,
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground1,
        },
        '&:focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
        },
    },
    groupList: {
        display: 'flex',
        flexDirection: 'column',
        gap: '1px',
        paddingLeft: '10px',
        marginTop: '2px',
        marginBottom: '4px',
    },
    groupItem: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        height: '32px',
        width: '100%',
        padding: '0 8px',
        borderRadius: tokens.borderRadiusMedium,
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '13px',
        fontFamily: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground1,
        },
        '&:focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '-2px',
        },
    },
    groupItemActive: {
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground1,
        fontWeight: 600,
    },
    groupIcon: {
        fontSize: '14px',
        width: '22px',
        height: '22px',
        padding: '3px',
        borderRadius: '5px',
        flexShrink: 0,
        color: tokens.colorNeutralForeground3,
    },
    groupRow: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minWidth: 0,
        '&:hover .mc-group-actions': {
            opacity: 1,
            pointerEvents: 'auto',
        },
        '&:focus-within .mc-group-actions': {
            opacity: 1,
            pointerEvents: 'auto',
        },
        '&:hover .mc-group-count': {
            opacity: 0,
        },
        '&:focus-within .mc-group-count': {
            opacity: 0,
        },
    },
    groupSurface: {
        width: '260px',
        maxHeight: 'min(460px, calc(100vh - 80px))',
        overflowY: 'auto',
        padding: '10px',
    },
    groupSurfaceTitle: {
        margin: '0 8px 8px',
        fontSize: '13px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground2,
    },
    groupActions: {
        position: 'absolute',
        right: '4px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '1px',
        opacity: 0,
        pointerEvents: 'none',
        transitionProperty: 'opacity',
        transitionDuration: '100ms',
        backgroundColor: tokens.colorNeutralBackground3,
        borderRadius: tokens.borderRadiusSmall,
    },
    groupActionBtn: {
        minWidth: '22px',
        width: '22px',
        height: '22px',
        padding: 0,
        color: tokens.colorNeutralForeground3,
        '&:hover': {
            color: tokens.colorNeutralForeground1,
        },
    },
    groupDeleteBtn: {
        minWidth: '22px',
        width: '22px',
        height: '22px',
        padding: 0,
        color: tokens.colorNeutralForeground3,
        '&:hover': {
            color: tokens.colorPaletteRedForeground1,
            backgroundColor: tokens.colorPaletteRedBackground1,
        },
    },
    groupCount: {
        transitionProperty: 'opacity',
        transitionDuration: '100ms',
    },
});

const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
    activeSection,
    onSelectSection,
    collapsed,
    onToggleCollapsed,
    environmentCount,
    proxyCount,
    trashCount,
    groups,
    groupCounts,
    currentGroup,
    emptyGroups,
    onSelectGroup,
    onRequestRenameGroup,
    onRequestDeleteGroup,
    settingsBadge = false,
    settingsBadgeTooltip,
}) => {
    const styles = useStyles();
    const { isEn, t } = useI18n();
    const [groupsExpanded, setGroupsExpanded] = useState(true);
    const [groupPopoverOpen, setGroupPopoverOpen] = useState(false);

    const visibleGroups = Array.from(
        new Set([...groups, ...emptyGroups]),
    ).filter((g) => g && g !== '全部' && g !== '用户分组');

    const selectGroup = (group: string) => {
        onSelectGroup(group);
        onSelectSection('environments');
        setGroupPopoverOpen(false);
    };

    const renderGroups = () => (
        <div role="group" aria-label={t('环境分组', 'Environment groups')}>
            <button
                type="button"
                className={mergeClasses(
                    styles.groupItem,
                    activeSection === 'environments' &&
                        currentGroup === '用户分组' &&
                        styles.groupItemActive,
                )}
                aria-current={
                    activeSection === 'environments' &&
                    currentGroup === '用户分组'
                        ? 'page'
                        : undefined
                }
                onClick={() => selectGroup('用户分组')}
            >
                <WindowMultipleRegular className={styles.groupIcon} />
                <span className={styles.navLabel}>
                    {t('全部环境', 'All Environments')}
                </span>
                <span className={styles.navCount}>{environmentCount}</span>
            </button>
            {visibleGroups.map((group) => {
                const isActive =
                    activeSection === 'environments' && currentGroup === group;
                const count = groupCounts[group] || 0;
                return (
                    <div key={group} className={styles.groupRow}>
                        <button
                            type="button"
                            className={mergeClasses(
                                styles.groupItem,
                                isActive && styles.groupItemActive,
                            )}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => selectGroup(group)}
                            title={group}
                        >
                            <FolderRegular
                                className={styles.groupIcon}
                                style={getGroupStyle(group)}
                            />
                            <span className={styles.navLabel}>{group}</span>
                            <span
                                className={mergeClasses(
                                    styles.navCount,
                                    styles.groupCount,
                                    'mc-group-count',
                                )}
                            >
                                {count}
                            </span>
                        </button>
                        <div
                            className={mergeClasses(
                                styles.groupActions,
                                'mc-group-actions',
                            )}
                        >
                            <Tooltip
                                content={t('重命名分组', 'Rename group')}
                                relationship="label"
                            >
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={
                                        <EditRegular
                                            style={{ fontSize: '13px' }}
                                        />
                                    }
                                    className={styles.groupActionBtn}
                                    aria-label={
                                        isEn
                                            ? `Rename group ${group}`
                                            : `重命名分组 ${group}`
                                    }
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setGroupPopoverOpen(false);
                                        onRequestRenameGroup(group);
                                    }}
                                />
                            </Tooltip>
                            <Tooltip
                                content={t('删除分组', 'Delete group')}
                                relationship="label"
                            >
                                <Button
                                    appearance="subtle"
                                    size="small"
                                    icon={
                                        <DeleteRegular
                                            style={{ fontSize: '13px' }}
                                        />
                                    }
                                    className={styles.groupDeleteBtn}
                                    aria-label={
                                        isEn
                                            ? `Delete group ${group}`
                                            : `删除分组 ${group}`
                                    }
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setGroupPopoverOpen(false);
                                        onRequestDeleteGroup(group);
                                    }}
                                />
                            </Tooltip>
                        </div>
                    </div>
                );
            })}
        </div>
    );

    const renderPrimaryItem = (
        id: NavSection,
        label: string,
        icon: React.ReactNode,
        count?: number,
        showDot?: boolean,
        dotTooltip?: string,
    ) => {
        const active = activeSection === id;
        const expandable =
            id === 'environments' && !collapsed && visibleGroups.length > 0;
        const iconTone = {
            environments: 'blue',
            proxies: 'teal',
            trash: 'amber',
            settings: 'violet',
        }[id];
        const button = (
            <button
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={dotTooltip ? `${label} (${dotTooltip})` : label}
                title={showDot && dotTooltip ? dotTooltip : undefined}
                className={mergeClasses(
                    styles.navItem,
                    collapsed && styles.navItemCollapsed,
                    active && styles.navItemActive,
                    expandable && styles.expandableItem,
                )}
                onClick={() => onSelectSection(id)}
            >
                <span
                    className={styles.navIcon}
                    style={getToneStyle(iconTone as AccentTone)}
                >
                    {icon}
                </span>
                {collapsed && showDot && (
                    <span
                        className={styles.navDotCollapsed}
                        aria-hidden="true"
                    />
                )}
                {!collapsed && (
                    <>
                        <span className={styles.navLabel}>{label}</span>
                        {showDot && (
                            <span
                                className={styles.navDot}
                                aria-hidden="true"
                            />
                        )}
                        {typeof count === 'number' && (
                            <span className={styles.navCount}>{count}</span>
                        )}
                    </>
                )}
            </button>
        );

        if (collapsed && id === 'environments') {
            return (
                <Popover
                    key={id}
                    open={groupPopoverOpen}
                    onOpenChange={(_, data) => setGroupPopoverOpen(data.open)}
                    positioning="after-top"
                    trapFocus
                >
                    <PopoverTrigger disableButtonEnhancement>
                        {button}
                    </PopoverTrigger>
                    <PopoverSurface
                        className={styles.groupSurface}
                        aria-label={t('选择环境分组', 'Select environment group')}
                    >
                        <p className={styles.groupSurfaceTitle}>
                            {t('环境分组', 'Groups')}
                        </p>
                        {renderGroups()}
                    </PopoverSurface>
                </Popover>
            );
        }

        return collapsed ? (
            <Tooltip
                key={id}
                content={
                    showDot && dotTooltip
                        ? `${label} · ${dotTooltip}`
                        : typeof count === 'number'
                          ? `${label} (${count})`
                          : label
                }
                positioning="after"
                relationship="label"
            >
                {button}
            </Tooltip>
        ) : (
            <div key={id} className={styles.navRow}>
                {button}
                {expandable && (
                    <button
                        type="button"
                        aria-label={
                            groupsExpanded
                                ? t('收起环境分组', 'Collapse groups')
                                : t('展开环境分组', 'Expand groups')
                        }
                        aria-expanded={groupsExpanded}
                        className={styles.chevronBtn}
                        onClick={() => setGroupsExpanded((prev) => !prev)}
                    >
                        {groupsExpanded ? (
                            <ChevronDownRegular />
                        ) : (
                            <ChevronRightRegular />
                        )}
                    </button>
                )}
            </div>
        );
    };

    return (
        <>
            <aside
                aria-label={t('主导航', 'Main navigation')}
                className={mergeClasses(
                    styles.sidebar,
                    collapsed && styles.sidebarCollapsed,
                )}
            >
                <div
                    className={mergeClasses(
                        styles.toggleRow,
                        collapsed && styles.toggleRowCollapsed,
                    )}
                >
                    <Tooltip
                        content={
                            collapsed
                                ? t('展开导航栏', 'Expand sidebar')
                                : t('收起导航栏', 'Collapse sidebar')
                        }
                        relationship="label"
                        positioning="after"
                    >
                        <button
                            type="button"
                            className={styles.toggleBtn}
                            aria-label={
                                collapsed
                                    ? t('展开导航栏', 'Expand sidebar')
                                    : t('收起导航栏', 'Collapse sidebar')
                            }
                            aria-expanded={!collapsed}
                            onClick={onToggleCollapsed}
                        >
                            {collapsed ? (
                                <PanelLeftExpandRegular />
                            ) : (
                                <PanelLeftContractRegular />
                            )}
                        </button>
                    </Tooltip>
                </div>

                <nav
                    className={styles.topNav}
                    aria-label={t('核心功能', 'Primary')}
                >
                    {renderPrimaryItem(
                        'environments',
                        t('环境', 'Environments'),
                        <WindowMultipleRegular />,
                        environmentCount,
                    )}
                    {!collapsed &&
                        groupsExpanded &&
                        visibleGroups.length > 0 && (
                            <div className={styles.groupList}>
                                {renderGroups()}
                            </div>
                        )}

                    {renderPrimaryItem(
                        'proxies',
                        t('代理', 'Proxies'),
                        <GlobeRegular />,
                        proxyCount,
                    )}
                </nav>

                <nav
                    className={styles.bottomNav}
                    aria-label={t('系统工具', 'System')}
                >
                    {renderPrimaryItem(
                        'trash',
                        t('回收站', 'Trash'),
                        <DeleteRegular />,
                        trashCount > 0 ? trashCount : undefined,
                    )}
                    {renderPrimaryItem(
                        'settings',
                        t('设置', 'Settings'),
                        <SettingsRegular />,
                        undefined,
                        settingsBadge,
                        settingsBadgeTooltip,
                    )}
                </nav>
            </aside>
        </>
    );
};

export default NavigationSidebar;
