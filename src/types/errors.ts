export enum ErrorType {
    VALIDATION = 'VALIDATION',
    NOT_FOUND = 'NOT_FOUND',
    PERMISSION = 'PERMISSION',
    CHROME_PROCESS = 'CHROME_PROCESS',
    FILE_SYSTEM = 'FILE_SYSTEM',
    NETWORK = 'NETWORK',
    UNKNOWN = 'UNKNOWN',
}

export interface AppError {
    type: ErrorType;
    message: string;
    details?: string;
    stack?: string;
}

export function createAppError(error: unknown): AppError {
    if (error instanceof Error) {
        return {
            type: ErrorType.UNKNOWN,
            message: error.message,
            stack: error.stack,
        };
    }

    return {
        type: ErrorType.UNKNOWN,
        message: String(error),
    };
}

export const ERROR_MESSAGES: Record<ErrorType, string> = {
    [ErrorType.VALIDATION]: '输入数据格式有误',
    [ErrorType.NOT_FOUND]: '找不到指定的资源',
    [ErrorType.PERMISSION]: '权限不足',
    [ErrorType.CHROME_PROCESS]: 'Chrome进程操作失败',
    [ErrorType.FILE_SYSTEM]: '文件系统操作失败',
    [ErrorType.NETWORK]: '网络连接错误',
    [ErrorType.UNKNOWN]: '未知错误',
};

export const ERROR_MESSAGES_EN: Record<ErrorType, string> = {
    [ErrorType.VALIDATION]: 'Invalid input format',
    [ErrorType.NOT_FOUND]: 'Resource not found',
    [ErrorType.PERMISSION]: 'Insufficient permissions',
    [ErrorType.CHROME_PROCESS]: 'Chrome process operation failed',
    [ErrorType.FILE_SYSTEM]: 'File system operation failed',
    [ErrorType.NETWORK]: 'Network connection error',
    [ErrorType.UNKNOWN]: 'Unknown error',
};
