import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { AppLocale, AppSettings, ThemeMode } from '../types';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { getStoredLocale, I18nProvider, saveStoredLocale } from '../i18n';
import { systemApi } from '../services';

interface SettingsContextType {
    settings: AppSettings;
    loading: boolean;
    themeMode: ThemeMode;
    locale: AppLocale;
    isDark: boolean;
    actions: {
        loadSettings: () => Promise<void>;
        saveSettings: (settings: AppSettings) => Promise<boolean>;
        setThemeMode: (theme: ThemeMode) => Promise<void>;
        setLocale: (locale: AppLocale) => Promise<void>;
    };
}

const SettingsContext = createContext<SettingsContextType | undefined>(
    undefined,
);

function getSystemPrefersDark(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const [settings, setSettings] = useState<AppSettings>({
        dataPath: '',
        globalProxy: { enabled: false, address: '' },
        startupUrl: '',
        theme: 'system',
        locale: getStoredLocale(),
    });
    const [loading, setLoading] = useState<boolean>(true);
    const [systemDark, setSystemDark] =
        useState<boolean>(getSystemPrefersDark);
    const { handleError } = useErrorHandler();

    const themeMode: ThemeMode = settings.theme || 'system';
    const locale: AppLocale = settings.locale === 'en-US' ? 'en-US' : 'zh-CN';
    const isDark =
        themeMode === 'dark' || (themeMode === 'system' && systemDark);

    useEffect(() => {
        saveStoredLocale(locale);
        document.title =
            locale === 'en-US'
                ? 'MultiChrome - Multi-Profile Chrome Manager'
                : 'MultiChrome - Chrome多环境管理工具';
    }, [locale]);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = (event: MediaQueryListEvent) =>
            setSystemDark(event.matches);
        mql.addEventListener('change', listener);
        return () => mql.removeEventListener('change', listener);
    }, []);

    useEffect(() => {
        document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
        void systemApi.setTheme(themeMode, isDark).catch(() => {
            // ignore outside Electron
        });
    }, [themeMode, isDark]);

    const loadSettings = useCallback(async () => {
        if (!systemApi.hasSettingsApi()) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const appSettings = await systemApi.getSettings();
            setSettings({
                ...appSettings,
                theme: appSettings.theme || 'system',
                locale:
                    appSettings.locale === 'en-US' ||
                    appSettings.locale === 'zh-CN'
                        ? appSettings.locale
                        : getStoredLocale(),
            });
        } catch (err) {
            handleError(
                err,
                getStoredLocale() === 'en-US' ? 'Load Settings' : '加载设置',
            );
        } finally {
            setLoading(false);
        }
    }, [handleError]);

    const saveSettings = useCallback(
        async (newSettings: AppSettings): Promise<boolean> => {
            if (!systemApi.hasSettingsApi()) {
                handleError(
                    new Error(
                        getStoredLocale() === 'en-US'
                            ? 'Settings API is not loaded properly'
                            : '设置API未正确加载',
                    ),
                    getStoredLocale() === 'en-US' ? 'Save Settings' : '保存设置',
                );
                return false;
            }

            try {
                const success = await systemApi.saveSettings(newSettings);
                if (success) {
                    setSettings(newSettings);
                }
                return success;
            } catch (err) {
                handleError(
                    err,
                    getStoredLocale() === 'en-US' ? 'Save Settings' : '保存设置',
                );
                return false;
            }
        },
        [handleError],
    );

    const setThemeMode = useCallback(
        async (nextTheme: ThemeMode) => {
            const nextSettings: AppSettings = { ...settings, theme: nextTheme };
            setSettings(nextSettings);
            if (systemApi.hasSettingsApi() && nextSettings.dataPath) {
                try {
                    await systemApi.saveSettings(nextSettings);
                } catch {
                    // keep live theme if dataPath is not ready
                }
            }
        },
        [settings],
    );

    const setLocale = useCallback(
        async (nextLocale: AppLocale) => {
            saveStoredLocale(nextLocale);
            const nextSettings: AppSettings = {
                ...settings,
                locale: nextLocale,
            };
            setSettings(nextSettings);
            if (systemApi.hasSettingsApi() && nextSettings.dataPath) {
                try {
                    await systemApi.saveSettings(nextSettings);
                } catch {
                    // keep local cache if dataPath is not ready
                }
            }
        },
        [settings],
    );

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    const i18nValue = useMemo(
        () => ({ locale, setLocale }),
        [locale, setLocale],
    );

    const contextValue: SettingsContextType = {
        settings,
        loading,
        themeMode,
        locale,
        isDark,
        actions: {
            loadSettings,
            saveSettings,
            setThemeMode,
            setLocale,
        },
    };

    return (
        <SettingsContext.Provider value={contextValue}>
            <I18nProvider value={i18nValue}>{children}</I18nProvider>
        </SettingsContext.Provider>
    );
};

export const useSettings = (): SettingsContextType => {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
