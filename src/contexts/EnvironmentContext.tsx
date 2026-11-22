import React, { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import {
    BrowserEngineType,
    ChromeEnvironment,
    DeleteGroupOptions,
    DeleteGroupResult,
    FingerprintConfig,
    RenameGroupResult,
} from '../types';
import { useErrorHandler } from '../hooks/useErrorHandler';
import { tr } from '../i18n';

interface EnvironmentState {
    environments: ChromeEnvironment[];
    loading: boolean;
    currentGroup: string;
    emptyGroups: string[];
}

type EnvironmentAction =
    | { type: 'SET_LOADING'; payload: boolean }
    | { type: 'SET_ENVIRONMENTS'; payload: ChromeEnvironment[] }
    | { type: 'SET_CURRENT_GROUP'; payload: string }
    | { type: 'SET_EMPTY_GROUPS'; payload: string[] }
    | { type: 'UPDATE_ENVIRONMENT'; payload: ChromeEnvironment }
    | { type: 'REMOVE_ENVIRONMENT'; payload: string }
    | { type: 'ADD_ENVIRONMENT'; payload: ChromeEnvironment };

const initialState: EnvironmentState = {
    environments: [],
    loading: true,
    currentGroup: '用户分组',
    emptyGroups: [],
};

function environmentReducer(state: EnvironmentState, action: EnvironmentAction): EnvironmentState {
    switch (action.type) {
        case 'SET_LOADING':
            return { ...state, loading: action.payload };
        case 'SET_ENVIRONMENTS':
            return { ...state, environments: action.payload };
        case 'SET_CURRENT_GROUP':
            return { ...state, currentGroup: action.payload };
        case 'SET_EMPTY_GROUPS':
            return { ...state, emptyGroups: action.payload };
        case 'UPDATE_ENVIRONMENT':
            return {
                ...state,
                environments: state.environments.map((env) =>
                    env.id === action.payload.id ? action.payload : env,
                ),
            };
        case 'REMOVE_ENVIRONMENT':
            return {
                ...state,
                environments: state.environments.filter((env) => env.id !== action.payload),
            };
        case 'ADD_ENVIRONMENT':
            return {
                ...state,
                environments: [action.payload, ...state.environments],
            };
        default:
            return state;
    }
}

interface EnvironmentContextType {
    state: EnvironmentState;
    actions: {
        loadEnvironments: (silent?: boolean) => Promise<void>;
        loadEmptyGroups: () => Promise<void>;
        createEnvironment: (
            name: string,
            groupName: string,
            notes: string,
            options?: {
                browserEngine?: BrowserEngineType;
                fingerprintConfig?: Partial<FingerprintConfig>;
                proxyId?: string;
                proxy?: string;
                proxyLabel?: string;
                tags?: string[];
            },
        ) => Promise<ChromeEnvironment>;
        cloneEnvironment: (
            id: string,
            customName?: string,
        ) => Promise<ChromeEnvironment>;
        regenerateFingerprint: (id: string) => Promise<ChromeEnvironment | undefined>;
        launchEnvironment: (id: string) => Promise<void>;
        closeEnvironment: (id: string) => Promise<void>;
        deleteEnvironment: (id: string) => Promise<void>;
        updateEnvironment: (
            id: string,
            data: Partial<ChromeEnvironment>,
            options?: { throwOnError?: boolean },
        ) => Promise<ChromeEnvironment | undefined>;
        renameGroup: (
            oldName: string,
            newName: string,
        ) => Promise<RenameGroupResult>;
        deleteGroup: (
            groupName: string,
            options?: DeleteGroupOptions,
        ) => Promise<DeleteGroupResult>;
        deleteEmptyGroup: (groupName: string) => Promise<void>;
        setCurrentGroup: (group: string) => void;
        refreshEnvironments: () => Promise<void>;
    };
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(undefined);

export const EnvironmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [state, dispatch] = useReducer(environmentReducer, initialState);
    const { handleError } = useErrorHandler();
    const envsRef = useRef<ChromeEnvironment[]>([]);
    envsRef.current = state.environments;

    // 加载环境列表（silent=true 时不触发 loading 闪烁，避免列表跳动或抢焦点）
    const loadEnvironments = useCallback(
        async (silent = false) => {
            if (!window.electronAPI || !window.electronAPI.chromeEnvironments) {
                if (!silent) {
                    handleError(
                        new Error(tr('Electron API未正确加载', 'Electron API failed to load')),
                        tr('加载环境列表', 'Load Environments'),
                    );
                    dispatch({ type: 'SET_LOADING', payload: false });
                }
                return;
            }

            try {
                if (!silent) {
                    dispatch({ type: 'SET_LOADING', payload: true });
                }
                const envs = await window.electronAPI.chromeEnvironments.getAll();
                dispatch({ type: 'SET_ENVIRONMENTS', payload: envs });
            } catch (err) {
                if (!silent) {
                    handleError(err, tr('加载Chrome环境', 'Load Chrome Environments'));
                }
            } finally {
                if (!silent) {
                    dispatch({ type: 'SET_LOADING', payload: false });
                }
            }
        },
        [handleError],
    );

    const loadEmptyGroups = useCallback(async () => {
        if (!window.electronAPI || !window.electronAPI.chromeEnvironments) {
            return;
        }

        try {
            const emptyGroupsList = await window.electronAPI.chromeEnvironments.getEmptyGroups();
            dispatch({ type: 'SET_EMPTY_GROUPS', payload: emptyGroupsList });
        } catch (err) {
            handleError(err, tr('加载空分组', 'Load Empty Groups'));
        }
    }, [handleError]);

    const createEnvironment = useCallback(
        async (
            name: string,
            groupName: string,
            notes: string,
            options?: {
                browserEngine?: BrowserEngineType;
                fingerprintConfig?: Partial<FingerprintConfig>;
                proxyId?: string;
                proxy?: string;
                proxyLabel?: string;
                tags?: string[];
            },
        ) => {
            if (!window.electronAPI || !window.electronAPI.chromeEnvironments) {
                const err = new Error(
                    tr('Electron API未正确加载', 'Electron API failed to load'),
                );
                handleError(err, tr('创建环境', 'Create Environment'));
                throw err;
            }

            try {
                const newEnv = await window.electronAPI.chromeEnvironments.create(
                    name,
                    groupName,
                    notes,
                    options,
                );
                dispatch({ type: 'ADD_ENVIRONMENT', payload: newEnv });
                void loadEmptyGroups();
                return newEnv;
            } catch (err) {
                handleError(err, tr('创建环境', 'Create Environment'));
                throw err;
            }
        },
        [handleError, loadEmptyGroups],
    );

    const cloneEnvironment = useCallback(
        async (id: string, customName?: string) => {
            if (!window.electronAPI?.chromeEnvironments?.clone) {
                const err = new Error(
                    tr('Electron API未正确加载', 'Electron API failed to load'),
                );
                handleError(err, tr('克隆环境', 'Clone Environment'));
                throw err;
            }
            try {
                const cloned = await window.electronAPI.chromeEnvironments.clone(
                    id,
                    customName,
                );
                dispatch({ type: 'ADD_ENVIRONMENT', payload: cloned });
                return cloned;
            } catch (err) {
                handleError(err, tr('克隆环境', 'Clone Environment'));
                throw err;
            }
        },
        [handleError],
    );

    const regenerateFingerprint = useCallback(
        async (id: string) => {
            if (!window.electronAPI?.chromeEnvironments?.regenerateFingerprint) {
                handleError(
                    new Error(tr('Electron API未正确加载', 'Electron API failed to load')),
                    tr('重新生成指纹', 'Regenerate Fingerprint'),
                );
                return undefined;
            }
            try {
                const updated = await window.electronAPI.chromeEnvironments.regenerateFingerprint(id);
                dispatch({ type: 'UPDATE_ENVIRONMENT', payload: updated });
                return updated;
            } catch (err) {
                handleError(err, tr('重新生成指纹', 'Regenerate Fingerprint'));
                return undefined;
            }
        },
        [handleError],
    );

    const launchEnvironment = useCallback(
        async (id: string) => {
            if (!window.electronAPI || !window.electronAPI.chromeEnvironments) {
                handleError(
                    new Error(tr('Electron API未正确加载', 'Electron API failed to load')),
                    tr('启动环境', 'Launch Environment'),
                );
                return;
            }

            try {
                await window.electronAPI.chromeEnvironments.launch(id);
                const updatedEnv = envsRef.current.find((env) => env.id === id);
                if (updatedEnv) {
                    dispatch({
                        type: 'UPDATE_ENVIRONMENT',
                        payload: {
                            ...updatedEnv,
                            isRunning: true,
                            lastUsed: new Date().toISOString(),
                        },
                    });
                }
            } catch (err) {
                handleError(err, tr('启动环境', 'Launch Environment'));
            }
        },
        [handleError],
    );

    const closeEnvironment = useCallback(
        async (id: string) => {
            if (!window.electronAPI || !window.electronAPI.chromeEnvironments) {
                handleError(
                    new Error(tr('Electron API未正确加载', 'Electron API failed to load')),
                    tr('关闭环境', 'Close Environment'),
                );
                return;
            }

            try {
                await window.electronAPI.chromeEnvironments.close(id);
                const updatedEnv = envsRef.current.find((env) => env.id === id);
                if (updatedEnv) {
                    dispatch({
                        type: 'UPDATE_ENVIRONMENT',
                        payload: { ...updatedEnv, isRunning: false },
                    });
                }
            } catch (err) {
                handleError(err, tr('关闭环境', 'Close Environment'));
                void loadEnvironments(true);
            }
        },
        [handleError, loadEnvironments],
    );

    const deleteEnvironment = useCallback(
        async (id: string) => {
            if (!window.electronAPI || !window.electronAPI.chromeEnvironments) {
                handleError(
                    new Error(tr('Electron API未正确加载', 'Electron API failed to load')),
                    tr('删除环境', 'Delete Environment'),
                );
                return;
            }

            try {
                await window.electronAPI.chromeEnvironments.delete(id);
                dispatch({ type: 'REMOVE_ENVIRONMENT', payload: id });
                void loadEmptyGroups();
            } catch (err) {
                handleError(err, tr('删除环境', 'Delete Environment'));
            }
        },
        [handleError, loadEmptyGroups],
    );

    const updateEnvironment = useCallback(
        async (
            id: string,
            data: Partial<ChromeEnvironment>,
            options?: { throwOnError?: boolean },
        ) => {
            if (!window.electronAPI || !window.electronAPI.chromeEnvironments) {
                const err = new Error(
                    tr('Electron API未正确加载', 'Electron API failed to load'),
                );
                if (!options?.throwOnError)
                    handleError(err, tr('更新环境', 'Update Environment'));
                if (options?.throwOnError) throw err;
                return undefined;
            }

            try {
                const updatedEnv = await window.electronAPI.chromeEnvironments.update(id, data);
                dispatch({ type: 'UPDATE_ENVIRONMENT', payload: updatedEnv });
                void loadEmptyGroups();
                return updatedEnv;
            } catch (err) {
                if (options?.throwOnError) {
                    throw err;
                }
                handleError(err, tr('更新环境', 'Update Environment'));
                return undefined;
            }
        },
        [handleError, loadEmptyGroups],
    );

    const renameGroup = useCallback(
        async (oldName: string, newName: string) => {
            if (!window.electronAPI?.chromeEnvironments?.renameGroup) {
                const err = new Error(
                    tr('Electron API未正确加载', 'Electron API failed to load'),
                );
                handleError(err, tr('重命名分组', 'Rename Group'));
                throw err;
            }
            const result = await window.electronAPI.chromeEnvironments.renameGroup(
                oldName,
                newName,
            );
            if (state.currentGroup === oldName) {
                dispatch({ type: 'SET_CURRENT_GROUP', payload: result.newName });
            }
            await Promise.all([loadEnvironments(true), loadEmptyGroups()]);
            return result;
        },
        [handleError, loadEnvironments, loadEmptyGroups, state.currentGroup],
    );

    const deleteGroup = useCallback(
        async (groupName: string, options?: DeleteGroupOptions) => {
            if (!window.electronAPI?.chromeEnvironments?.deleteGroup) {
                const err = new Error(
                    tr('Electron API未正确加载', 'Electron API failed to load'),
                );
                handleError(err, tr('删除分组', 'Delete Group'));
                throw err;
            }

            const result = await window.electronAPI.chromeEnvironments.deleteGroup(
                groupName,
                options,
            );
            if (state.currentGroup === groupName) {
                dispatch({ type: 'SET_CURRENT_GROUP', payload: '用户分组' });
            }
            await Promise.all([loadEnvironments(true), loadEmptyGroups()]);
            return result;
        },
        [handleError, loadEnvironments, loadEmptyGroups, state.currentGroup],
    );

    const deleteEmptyGroup = useCallback(
        async (groupName: string) => {
            if (!window.electronAPI || !window.electronAPI.chromeEnvironments) {
                handleError(
                    new Error(tr('Electron API未正确加载', 'Electron API failed to load')),
                    tr('删除分组', 'Delete Group'),
                );
                return;
            }

            try {
                const success = await window.electronAPI.chromeEnvironments.deleteEmptyGroup(groupName);
                if (success) {
                    if (state.currentGroup === groupName) {
                        dispatch({ type: 'SET_CURRENT_GROUP', payload: '用户分组' });
                    }
                    void loadEmptyGroups();
                }
            } catch (err) {
                handleError(err, tr('删除分组', 'Delete Group'));
            }
        },
        [handleError, loadEmptyGroups, state.currentGroup],
    );

    const setCurrentGroup = useCallback((group: string) => {
        dispatch({ type: 'SET_CURRENT_GROUP', payload: group });
    }, []);

    const refreshEnvironments = useCallback(async () => {
        await Promise.all([loadEnvironments(true), loadEmptyGroups()]);
    }, [loadEnvironments, loadEmptyGroups]);

    useEffect(() => {
        if (window.electronAPI && window.electronAPI.chromeEnvironments) {
            void loadEnvironments(false);
            void loadEmptyGroups();
        } else {
            handleError(
                new Error(
                    tr(
                        'Electron API未正确加载，请重启应用',
                        'Electron API failed to load. Please restart the app.',
                    ),
                ),
                tr('初始化应用', 'Initialize App'),
            );
            dispatch({ type: 'SET_LOADING', payload: false });
        }
    }, [loadEnvironments, loadEmptyGroups, handleError]);

    // 后台状态同步：静默刷新，不重置滚动条、不抢焦点
    useEffect(() => {
        const handleStatusChange = () => {
            void loadEnvironments(true);
        };

        if (window.electronAPI && window.electronAPI.on) {
            window.electronAPI.on('chrome-status-changed', handleStatusChange);
        }

        return () => {
            if (window.electronAPI && window.electronAPI.removeListener) {
                window.electronAPI.removeListener('chrome-status-changed', handleStatusChange);
            }
        };
    }, [loadEnvironments]);

    const contextValue: EnvironmentContextType = {
        state,
        actions: {
            loadEnvironments,
            loadEmptyGroups,
            createEnvironment,
            cloneEnvironment,
            regenerateFingerprint,
            launchEnvironment,
            closeEnvironment,
            deleteEnvironment,
            updateEnvironment,
            renameGroup,
            deleteGroup,
            deleteEmptyGroup,
            setCurrentGroup,
            refreshEnvironments,
        },
    };

    return (
        <EnvironmentContext.Provider value={contextValue}>
            {children}
        </EnvironmentContext.Provider>
    );
};

export const useEnvironment = (): EnvironmentContextType => {
    const context = useContext(EnvironmentContext);
    if (context === undefined) {
        throw new Error('useEnvironment must be used within an EnvironmentProvider');
    }
    return context;
};
