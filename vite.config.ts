import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { devNull } from 'node:os';

// https://vitejs.dev/config/
export default defineConfig({
    // Vite 5 falls back to the project root for a falsy envDir. The null
    // device cannot contain env files, on either Windows or Unix.
    envDir: devNull,
    envPrefix: [],
    plugins: [react()],
    resolve: {
        alias: {
            '@': resolve(__dirname, './src'),
        },
    },
    base: './',
    build: {
        outDir: 'dist/renderer',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom'],
                    'fluent-icons': ['@fluentui/react-icons'],
                    'fluent-components': ['@fluentui/react-components'],
                },
            },
        },
    },
    server: {
        port: 5173,
    }
});
