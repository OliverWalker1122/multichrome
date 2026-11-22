import React, { Component, ReactNode } from 'react';
import { Button, Text, tokens } from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';
import { handleGlobalError } from '../hooks/useErrorHandler';
import { getStoredLocale } from '../i18n';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        handleGlobalError(error, { componentStack: errorInfo.componentStack || '' });
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: undefined });
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const isEn = getStoredLocale() === 'en-US';
            return (
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: '100vh',
                        padding: '24px',
                        backgroundColor: tokens.colorNeutralBackground3,
                        color: tokens.colorNeutralForeground1,
                    }}
                >
                    <div
                        style={{
                            maxWidth: '520px',
                            width: '100%',
                            padding: '28px',
                            borderRadius: tokens.borderRadiusXLarge,
                            backgroundColor: tokens.colorNeutralBackground1,
                            border: `1px solid ${tokens.colorNeutralStroke2}`,
                            textAlign: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '12px',
                        }}
                    >
                        <ErrorCircleRegular
                            style={{
                                fontSize: '44px',
                                color: tokens.colorPaletteRedForeground1,
                            }}
                        />
                        <Text size={500} weight="semibold">
                            {isEn ? 'Application Error' : '应用遇到异常'}
                        </Text>
                        <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
                            {this.state.error?.message ||
                                (isEn
                                    ? 'An unexpected rendering error occurred. Reloading usually resolves it.'
                                    : '界面渲染出现意外错误，刷新后通常可恢复。')}
                        </Text>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <Button appearance="primary" onClick={this.handleRetry}>
                                {isEn ? 'Reload' : '重新加载'}
                            </Button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
