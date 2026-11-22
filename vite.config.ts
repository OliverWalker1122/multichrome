import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    // The renderer has no environment-file configuration. Keep builds and UI
    // checks independent from local credentials.
    envDir: false,
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
    },
    server: {
        port: 5173,
    }
});
