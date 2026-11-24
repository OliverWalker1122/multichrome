#!/usr/bin/env node
/**
 * Cross-platform static asset copy for Electron main build.
 * Replaces `npx cpx2 "electron/{preload.cjs,kernelManifest.json}"` which fails
 * on macOS due to shell brace expansion splitting a single glob into two args.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const srcDir = path.join(projectRoot, 'electron');
const destDir = path.join(projectRoot, 'dist', 'electron');

const ASSETS = ['preload.cjs', 'kernelManifest.json'];

fs.mkdirSync(destDir, { recursive: true });
for (const filename of ASSETS) {
    const src = path.join(srcDir, filename);
    const dest = path.join(destDir, filename);
    if (!fs.existsSync(src)) {
        throw new Error(`Missing required Electron asset: ${src}`);
    }
    fs.copyFileSync(src, dest);
}
