#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
    path.resolve(
        __dirname,
        '..',
        'electron',
        'transport',
        'mcpStdioBridge.js',
    ),
    path.resolve(
        __dirname,
        '..',
        'dist',
        'electron',
        'transport',
        'mcpStdioBridge.js',
    ),
];

const bridgePath = candidates.find((candidate) => fs.existsSync(candidate));
if (!bridgePath) {
    process.stderr.write(
        '[multichrome-mcp] Could not locate mcpStdioBridge.js\n',
    );
    process.exit(1);
}

const { runStdioBridge } = await import(pathToFileURL(bridgePath).href);
await runStdioBridge();
