import { createAppError } from '../types/errors';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

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

export function handleGlobalError(
    error: Error,
    errorInfo: { componentStack: string },
    isEn = false,
): void {
    createAppError(error);
    message.error(
        isEn
            ? 'An unexpected application error occurred. Please reload and try again.'
            : '应用出现异常，请刷新页面重试',
        8000,
    );
    if (process.env.NODE_ENV === 'development') {
        console.error('React Error Boundary caught error:', error);
        console.error('Component stack:', errorInfo.componentStack);
    }
}
