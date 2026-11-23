import React, { useId, useState } from 'react';
import {
    Button,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
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
    GridRegular,
    MoreHorizontalRegular,
    PanelLeftContractRegular,
    PanelLeftExpandRegular,
    SettingsRegular,
    WindowMultipleRegular,
} from '@fluentui/react-icons';
import { useI18n } from '../i18n';

export type NavSection = 'environments' | 'proxies' | 'trash' | 'settings';

interface NavigationSidebarProps {
    activeSection: NavSection;
    onSelectSection: (section: NavSection) => void;
    collapsed: boolean;
    canToggleCollapsed: boolean;
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
        width: 'clamp(204px, 18.5vw, 228px)',
        minWidth: '204px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'transparent',
        padding: '18px 10px 8px',
        flexShrink: 0,
        transitionProperty: 'width, min-width',
        transitionDuration: '140ms',
        transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
        overflow: 'hidden',
    },
    sidebarCollapsed: {
        width: '56px',
        minWidth: '56px',
        padding: '12px 6px 8px',
    },
    settingsRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        '& > div:first-child': {
            flex: 1,
            minWidth: 0,
        },
    },
    settingsRowCollapsed: {
        flexDirection: 'column',
        alignItems: 'stretch',
    },
    toggleBtn: {
        minWidth: '32px',
        height: '32px',
        flexShrink: 0,
        borderRadius: '8px',
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground3,
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
        gap: '3px',
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
        height: '40px',
        width: '100%',
        padding: '0 10px',
        borderRadius: tokens.borderRadiusMedium,
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '14px',
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
    sectionTitle: {
        fontSize: '13px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground2,
    },
    activeItem: {
        color: tokens.colorBrandForeground2,
        backgroundColor: tokens.colorSubtleBackgroundSelected,
        fontWeight: 600,
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundSelected,
            color: tokens.colorBrandForeground2,
        },
        '&::before': {
            content: '""',
            position: 'absolute',
            left: '2px',
            top: '50%',
            transform: 'translateY(-50%)',
            height: '16px',
            width: '3px',
            borderRadius: '999px',
            backgroundColor: tokens.colorBrandBackground,
        },
    },
    navIcon: {
        fontSize: '18px',
        width: '20px',
        height: '20px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
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
        fontWeight: 400,
        flexShrink: 0,
        textAlign: 'right',
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
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        padding: 0,
        border: 'none',
        backgroundColor: 'transparent',
        cursor: 'pointer',
        borderRadius: tokens.borderRadiusSmall,
        color: tokens.colorNeutralForeground3,
        flexShrink: 0,
        marginRight: '2px',
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground1,
        },
        '&:focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
        },
    },
    groupList: {
        paddingLeft: '12px',
        marginBottom: '12px',
    },
    groupItems: {
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
    },
    groupItem: {
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'subgrid',
        gridColumn: '1 / -1',
        gridRow: '1',
        alignItems: 'center',
        height: '36px',
        width: '100%',
        padding: 0,
        borderRadius: tokens.borderRadiusMedium,
        border: 'none',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        fontSize: '14px',
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
    groupIcon: {
        width: '18px',
        height: '18px',
        justifySelf: 'end',
        marginRight: '10px',
    },
    groupRow: {
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '42px minmax(0, 1fr) minmax(32px, max-content)',
        alignItems: 'center',
        minWidth: 0,
    },
    editableGroup: {
        '&:hover .mc-group-more, &:focus-within .mc-group-more': {
            opacity: 1,
            pointerEvents: 'auto',
        },
        '&:hover .mc-group-label, &:focus-within .mc-group-label': {
            marginRight: '24px',
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
    groupMore: {
        gridColumn: '2',
        gridRow: '1',
        justifySelf: 'end',
        position: 'relative',
        minWidth: '22px',
        width: '22px',
        height: '22px',
        padding: 0,
        opacity: 0,
        pointerEvents: 'none',
        transitionProperty: 'opacity',
        transitionDuration: '100ms',
    },
    groupCount: {
        padding: '0 10px 0 4px',
    },
    activeCount: {
        color: 'inherit',
    },
});

const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
    activeSection,
    onSelectSection,
    collapsed,
    canToggleCollapsed,
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
    const { t } = useI18n();
    const groupListId = useId();
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
        <div
            className={styles.groupItems}
            role="group"
            aria-label={t('环境分组', 'Environment groups')}
        >
            {['用户分组', ...visibleGroups].map((group) => {
                const isAll = group === '用户分组';
                const label = isAll ? t('全部环境', 'All Environments') : group;
                const count = isAll ? environmentCount : groupCounts[group] || 0;
                const isActive =
                    activeSection === 'environments' && currentGroup === group;
                return (
                    <div
                        key={group}
                        className={mergeClasses(
                            styles.groupRow,
                            !isAll && styles.editableGroup,
                        )}
                    >
                        <button
                            type="button"
                            className={mergeClasses(
                                styles.groupItem,
                                isActive && styles.activeItem,
                            )}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => selectGroup(group)}
                            title={label}
                        >
                            {isAll ? (
                                <GridRegular className={styles.groupIcon} />
                            ) : (
                                <FolderRegular className={styles.groupIcon} />
                            )}
                            <span
                                className={mergeClasses(
                                    styles.navLabel,
                                    'mc-group-label',
                                )}
                            >
                                {label}
                            </span>
                            <span
                                className={mergeClasses(
                                    styles.navCount,
                                    styles.groupCount,
                                    isActive && styles.activeCount,
                                )}
                            >
                                {count}
                            </span>
                        </button>
                        {!isAll && (
                            <Menu>
                                <MenuTrigger disableButtonEnhancement>
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        icon={<MoreHorizontalRegular />}
                                        className={mergeClasses(
                                            styles.groupMore,
                                            'mc-group-more',
                                        )}
                                        aria-label={t(
                                            `管理分组 ${group}`,
                                            `Manage group ${group}`,
                                        )}
                                        title={t('管理分组', 'Manage group')}
                                    />
                                </MenuTrigger>
                                <MenuPopover>
                                    <MenuList>
                                        <MenuItem
                                            icon={<EditRegular />}
                                            onClick={() => {
                                                setGroupPopoverOpen(false);
                                                onRequestRenameGroup(group);
                                            }}
                                        >
                                            {t('重命名分组', 'Rename group')}
                                        </MenuItem>
                                        <MenuItem
                                            icon={<DeleteRegular />}
                                            onClick={() => {
                                                setGroupPopoverOpen(false);
                                                onRequestDeleteGroup(group);
                                            }}
                                        >
                                            {t('删除分组', 'Delete group')}
                                        </MenuItem>
                                    </MenuList>
                                </MenuPopover>
                            </Menu>
                        )}
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
        const isEnvironments = id === 'environments';
        const expandable = isEnvironments && !collapsed;
        const active =
            activeSection === id &&
            (!isEnvironments || (collapsed && !groupPopoverOpen));
        const button = (
            <button
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={dotTooltip ? `${label} (${dotTooltip})` : label}
                title={showDot && dotTooltip ? dotTooltip : undefined}
                className={mergeClasses(
                    styles.navItem,
                    collapsed && styles.navItemCollapsed,
                    active && styles.activeItem,
                    expandable && styles.sectionTitle,
                )}
                onClick={() => {
                    onSelectSection(id);
                    if (expandable) setGroupsExpanded(true);
                }}
            >
                <span className={styles.navIcon}>{icon}</span>
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
                        aria-controls={groupListId}
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
                <nav
                    className={styles.topNav}
                    aria-label={t('核心功能', 'Primary')}
                >
                    {renderPrimaryItem(
                        'environments',
                        t('环境', 'Environments'),
                        <WindowMultipleRegular />,
                    )}
                    {!collapsed && (
                        <div
                            id={groupListId}
                            className={styles.groupList}
                            hidden={!groupsExpanded}
                        >
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
                    <div
                        className={mergeClasses(
                            styles.settingsRow,
                            collapsed && styles.settingsRowCollapsed,
                        )}
                    >
                        {renderPrimaryItem(
                            'settings',
                            t('设置', 'Settings'),
                            <SettingsRegular />,
                            undefined,
                            settingsBadge,
                            settingsBadgeTooltip,
                        )}
                        {canToggleCollapsed && (
                            <Tooltip
                                content={
                                    collapsed
                                        ? t('展开导航栏', 'Expand sidebar')
                                        : t('收起导航栏', 'Collapse sidebar')
                                }
                                relationship="label"
                                positioning={collapsed ? 'after' : 'above'}
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
                        )}
                    </div>
                </nav>
            </aside>
        </>
    );
};

export default NavigationSidebar;
