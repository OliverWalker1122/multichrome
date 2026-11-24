import type { ProxyEditorState } from '../types';

export const PROXY_JSON_EXAMPLE = JSON.stringify(
    {
        type: 'vless',
        tag: 'my-vless',
        server: 'proxy.example.com',
        server_port: 443,
        uuid: '00000000-0000-4000-8000-000000000000',
        tls: { enabled: true, server_name: 'proxy.example.com' },
    },
    null,
    2,
);

export const createEmptyProxyEditor = (): ProxyEditorState => ({
    mode: 'line',
    name: '',
    protocol: 'http',
    host: '',
    port: '',
    username: '',
    password: '',
    hasPassword: false,
    clearCredentials: false,
    line: '',
    config: '',
});
