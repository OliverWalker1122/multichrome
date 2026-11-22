import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
    MessageBar,
    MessageBarBody,
    MessageBarActions,
    Button,
    tokens,
} from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import { tr } from '../i18n';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface Notification {
    id: string;
    type: NotificationType;
    message: string;
    duration?: number;
}

interface NotificationContextType {
    notifications: Notification[];
    showNotification: (type: NotificationType, message: string, duration?: number) => void;
    removeNotification: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const useNotification = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotification must be used within a NotificationProvider');
    }
    return context;
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const removeNotification = useCallback((id: string) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, []);

    const showNotification = useCallback(
        (type: NotificationType, message: string, duration = 4500) => {
            const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const notification: Notification = { id, type, message, duration };

            setNotifications((prev) => [...prev.slice(-3), notification]);

            if (duration > 0) {
                window.setTimeout(() => {
                    removeNotification(id);
                }, duration);
            }
        },
        [removeNotification],
    );

    useEffect(() => {
        const handleGlobalNotification = (event: CustomEvent) => {
            const { type, message, duration } = event.detail;
            showNotification(type, message, duration);
        };

        window.addEventListener('show-notification', handleGlobalNotification as EventListener);
        return () => {
            window.removeEventListener(
                'show-notification',
                handleGlobalNotification as EventListener,
            );
        };
    }, [showNotification]);

    return (
        <NotificationContext.Provider
            value={{ notifications, showNotification, removeNotification }}
        >
            {children}

            {notifications.length > 0 && (
                <div
                    role="region"
                    aria-label={tr('通知消息', 'Notifications')}
                    style={{
                        position: 'fixed',
                        top: '46px',
                        right: '16px',
                        zIndex: 10000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        maxWidth: '420px',
                        pointerEvents: 'none',
                    }}
                >
                    {notifications.map((notification) => (
                        <div
                            key={notification.id}
                            style={{
                                pointerEvents: 'auto',
                                boxShadow: tokens.shadow16,
                                borderRadius: tokens.borderRadiusMedium,
                                overflow: 'hidden',
                            }}
                        >
                            <MessageBar intent={notification.type} layout="multiline">
                                <MessageBarBody>{notification.message}</MessageBarBody>
                                <MessageBarActions
                                    containerAction={
                                        <Button
                                            aria-label={tr('关闭通知', 'Dismiss notification')}
                                            appearance="transparent"
                                            icon={<DismissRegular />}
                                            size="small"
                                            onClick={() => removeNotification(notification.id)}
                                        />
                                    }
                                />
                            </MessageBar>
                        </div>
                    ))}
                </div>
            )}
        </NotificationContext.Provider>
    );
};

export const message = {
    success: (content: string, duration?: number) => {
        window.dispatchEvent(
            new CustomEvent('show-notification', {
                detail: { type: 'success', message: content, duration },
            }),
        );
    },
    error: (content: string, duration?: number) => {
        window.dispatchEvent(
            new CustomEvent('show-notification', {
                detail: { type: 'error', message: content, duration },
            }),
        );
    },
    warning: (content: string, duration?: number) => {
        window.dispatchEvent(
            new CustomEvent('show-notification', {
                detail: { type: 'warning', message: content, duration },
            }),
        );
    },
    info: (content: string, duration?: number) => {
        window.dispatchEvent(
            new CustomEvent('show-notification', {
                detail: { type: 'info', message: content, duration },
            }),
        );
    },
};
