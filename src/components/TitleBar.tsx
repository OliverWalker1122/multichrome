import React from 'react';
import { Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import {
    LocalLanguageRegular,
    WeatherMoonRegular,
    WeatherSunnyRegular,
} from '@fluentui/react-icons';
import AppBrandIcon from './AppBrandIcon';
import { ThemeMode } from '../types';
import { useI18n } from '../i18n';

interface TitleBarProps {
    themeMode: ThemeMode;
    isDark: boolean;
    onToggleTheme: () => void;
    runningCount: number;
    singboxReady: boolean;
    onOpenSettings: () => void;
}

const useStyles = makeStyles({
    root: {
        height: '40px',
        minHeight: '40px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground1,
        paddingLeft: '10px',
        paddingRight: '146px', // 为 Windows 原生 titleBarOverlay（最小化/最大化/关闭）预留安全区
        userSelect: 'none',
    },
    rootMac: {
        paddingLeft: '78px',
        paddingRight: '14px',
    },
    rootLinux: {
        height: '38px',
        minHeight: '38px',
        paddingLeft: '10px',
        paddingRight: '14px',
        borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    left: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: 0,
    },
    brand: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        paddingLeft: '2px',
    },
    appName: {
        fontSize: '13px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground1,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
    },
    right: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
    },
    iconBtn: {
        width: '28px',
        height: '28px',
        borderRadius: tokens.borderRadiusMedium,
        border: '1px solid transparent',
        backgroundColor: 'transparent',
        color: tokens.colorNeutralForeground2,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: 0,
        fontSize: '15px',
        transitionProperty: 'background-color, color, border-color',
        transitionDuration: '120ms',
        '&:hover': {
            backgroundColor: tokens.colorSubtleBackgroundHover,
            color: tokens.colorNeutralForeground1,
        },
        '&:focus-visible': {
            outline: `2px solid ${tokens.colorStrokeFocus2}`,
            outlineOffset: '-1px',
        },
    },
    compactAction: {
        width: 'auto',
        padding: '0 7px',
        gap: '5px',
        fontFamily: 'inherit',
        fontSize: '12px',
    },
    runningStatus: {
        paddingRight: '6px',
        color: tokens.colorNeutralForeground2,
        fontSize: '12px',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontVariantNumeric: 'tabular-nums',
    },
    dot: {
        width: '7px',
        height: '7px',
        borderRadius: '999px',
        flexShrink: 0,
    },
    dotGreen: {
        backgroundColor: tokens.colorPaletteGreenForeground1,
    },
    dotAmber: {
        backgroundColor: tokens.colorPaletteMarigoldForeground1,
    },
});

const TitleBar: React.FC<TitleBarProps> = ({
    themeMode,
    isDark,
    onToggleTheme,
    runningCount,
    singboxReady,
    onOpenSettings,
}) => {
    const styles = useStyles();
    const { isEn, setLocale, t } = useI18n();
    const platform = window.electronAPI?.app?.platform || 'win32';
    const isMac = platform === 'darwin';
    const isLinux = platform === 'linux';

    const themeLabel =
        themeMode === 'system'
            ? isEn
                ? `Following system (${isDark ? 'Dark' : 'Light'}), click to toggle`
                : `当前跟随系统（${isDark ? '深色' : '浅色'}），点击切换`
            : isDark
              ? t('深色模式，点击切换浅色', 'Dark mode, click for light')
              : t('浅色模式，点击切换深色', 'Light mode, click for dark');

    const langLabel = isEn
        ? 'Switch language to Chinese (简体中文)'
        : '切换界面语言为英文 (English)';

    return (
        <header
            className={mergeClasses(
                styles.root,
                isMac && styles.rootMac,
                isLinux && styles.rootLinux,
                !isLinux && 'win11-drag',
            )}
            aria-label={t('应用顶栏', 'Application title bar')}
        >
            <div className={styles.left}>
                {/* 品牌图标始终位于最左侧（Linux 使用系统原生标题栏时不重复渲染） */}
                {!isLinux && (
                    <div className={styles.brand}>
                        <AppBrandIcon size={20} />
                        <span className={styles.appName}>MultiChrome</span>
                    </div>
                )}
            </div>

            <div className={mergeClasses(styles.right, 'win11-no-drag')}>
                {runningCount > 0 && (
                    <span
                        className={styles.runningStatus}
                        title={t(
                            '当前运行中的浏览器环境数量',
                            'Number of running browser environments',
                        )}
                    >
                        <span className={mergeClasses(styles.dot, styles.dotGreen)} />
                        <span>
                            {isEn
                                ? `${runningCount} running`
                                : `${runningCount} 个运行中`}
                        </span>
                    </span>
                )}

                {!singboxReady && (
                    <Tooltip
                        content={t(
                            '点击前往设置页一键下载官方 sing-box 代理核心',
                            'Click to open Settings and download the official sing-box proxy core',
                        )}
                        relationship="label"
                    >
                        <button
                            type="button"
                            className={mergeClasses(styles.iconBtn, styles.compactAction)}
                            onClick={onOpenSettings}
                        >
                            <span
                                className={mergeClasses(styles.dot, styles.dotAmber)}
                            />
                            <span>{t('安装 sing-box', 'Install sing-box')}</span>
                        </button>
                    </Tooltip>
                )}

                <Tooltip content={langLabel} relationship="label">
                    <button
                        type="button"
                        className={mergeClasses(styles.iconBtn, styles.compactAction)}
                        aria-label={langLabel}
                        onClick={() => void setLocale(isEn ? 'zh-CN' : 'en-US')}
                    >
                        <LocalLanguageRegular style={{ fontSize: '14px' }} />
                        <span>{isEn ? 'EN' : '中'}</span>
                    </button>
                </Tooltip>

                <Tooltip content={themeLabel} relationship="label">
                    <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={themeLabel}
                        onClick={onToggleTheme}
                    >
                        {isDark ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
                    </button>
                </Tooltip>
            </div>
        </header>
    );
};

export default TitleBar;
