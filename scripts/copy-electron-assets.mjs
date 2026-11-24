#!/usr/bin/env node
/**
 * Cross-platform static asset copy for Electron main build.
 * Replaces `npx cpx2` to avoid shell brace-expansion differences across OSes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const ASSETS = [
    ['electron/preload.cjs', 'dist/electron/preload.cjs'],
    [
        'electron/domain/kernelManifest.json',
        'dist/electron/domain/kernelManifest.json',
    ],
];

for (const [relSrc, relDest] of ASSETS) {
    const src = path.join(projectRoot, relSrc);
    const dest = path.join(projectRoot, relDest);
    if (!fs.existsSync(src)) {
        throw new Error(`Missing required Electron asset: ${src}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}
