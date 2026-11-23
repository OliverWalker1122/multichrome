import { useCallback } from 'react';
import { message } from '../contexts/NotificationContext';
import {
    AppError,
    createAppError,
    ERROR_MESSAGES,
    ERROR_MESSAGES_EN,
} from '../types/errors';
import { getStoredLocale, translateBackendMessage } from '../i18n';

interface UseErrorHandlerReturn {
    handleError: (error: unknown, context?: string) => void;
    showError: (error: AppError, context?: string) => void;
}

export function useErrorHandler(): UseErrorHandlerReturn {
    const handleError = useCallback((error: unknown, context?: string) => {
        const appError = createAppError(error);
        showErrorMessage(appError, context);

        // 在开发环境中打印详细错误信息
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
    const cleanedMessage = (error.details || error.message || baseMessage).replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        '',
    );
    const displayMessage = translateBackendMessage(cleanedMessage, locale);

    message.error(`${contextPrefix}${displayMessage}`, 5000);
}

// React Error Boundary 错误处理
export function handleGlobalError(error: Error, errorInfo: { componentStack: string }) {
    createAppError(error); // 创建错误对象但不需要存储
    const isEn = getStoredLocale() === 'en-US';
    
    message.error(
        isEn
            ? 'An unexpected application error occurred. Please reload and try again.'
            : '应用出现异常，请刷新页面重试',
        8000,
    );
    
    // 在开发环境中显示组件栈信息
    if (process.env.NODE_ENV === 'development') {
        console.error('React Error Boundary caught error:', error);
        console.error('Component stack:', errorInfo.componentStack);
    }
}