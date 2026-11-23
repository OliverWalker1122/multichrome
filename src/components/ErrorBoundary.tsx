import React, { Component, ReactNode } from 'react';
import { Button, FluentProvider, Text, tokens } from '@fluentui/react-components';
import { ErrorCircleRegular } from '@fluentui/react-icons';
import { handleGlobalError } from '../hooks/useErrorHandler';
import { getStoredLocale } from '../i18n';
import { win11DarkTheme, win11LightTheme } from '../theme/win11Theme';

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
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            const isEn = getStoredLocale() === 'en-US';
            const theme = document.documentElement.dataset.theme;
            const dark = theme
                ? theme === 'dark'
                : window.matchMedia('(prefers-color-scheme: dark)').matches;
            return (
                <FluentProvider
                    theme={dark ? win11DarkTheme : win11LightTheme}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        minHeight: '100vh',
                        padding: '24px',
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
                        <Text size={300}>
                            {isEn
                                ? 'Reload the window to reopen the workspace.'
                                : '请重新加载窗口，尝试重新打开工作区。'}
                        </Text>
                        {this.state.error?.message && (
                            <details style={{ maxWidth: '100%', overflowWrap: 'anywhere' }}>
                                <summary style={{ cursor: 'pointer' }}>
                                    {isEn ? 'Error details' : '错误详情'}
                                </summary>
                                <span data-selectable="true">{this.state.error.message}</span>
                            </details>
                        )}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <Button appearance="primary" onClick={this.handleRetry}>
                                {isEn ? 'Reload' : '重新加载'}
                            </Button>
                        </div>
                    </div>
                </FluentProvider>
            );
        }

        return this.props.children;
    }
}
