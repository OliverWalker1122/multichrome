import { useCallback } from 'react';
import {
    AppError,
    createAppError,
    ERROR_MESSAGES,
    ERROR_MESSAGES_EN,
} from '../types/errors';
import { getStoredLocale, translateBackendMessage } from '../i18n';
import {
    handleGlobalError as dispatchGlobalError,
    message,
} from '../utils/notificationEvents';

interface UseErrorHandlerReturn {
    handleError: (error: unknown, context?: string) => void;
    showError: (error: AppError, context?: string) => void;
}

export function useErrorHandler(): UseErrorHandlerReturn {
    const handleError = useCallback((error: unknown, context?: string) => {
        const appError = createAppError(error);
        showErrorMessage(appError, context);

        if (process.env.NODE_ENV === 'development') {
            console.error(`Error context: ${context || 'unknown'}`, error);
        }
    }, []);

    const showError = useCallback((error: AppError, context?: string) => {
        showErrorMessage(error, context);
    }, []);

    return { handleError, showError };
}

function showErrorMessage(error: AppError, context?: string) {
    const locale = getStoredLocale();
    const isEn = locale === 'en-US';
    const baseMessage = isEn
        ? ERROR_MESSAGES_EN[error.type] || 'Operation failed'
        : ERROR_MESSAGES[error.type] || '操作失败';
    const contextPrefix = context ? `${context}: ` : '';
    const cleanedMessage = (
        error.details ||
        error.message ||
        baseMessage
    ).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
    const displayMessage = translateBackendMessage(cleanedMessage, locale);

    message.error(`${contextPrefix}${displayMessage}`, 5000);
}

export function handleGlobalError(
    error: Error,
    errorInfo: { componentStack: string },
) {
    dispatchGlobalError(error, errorInfo, getStoredLocale() === 'en-US');
}
