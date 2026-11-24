import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function listSourceFiles(dir) {
    const results = [];
    if (!fs.existsSync(dir)) return results;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...listSourceFiles(full));
        } else if (/\.(js|cjs|mjs|ts|tsx)$/.test(entry.name)) {
            results.push(full);
        }
    }
    return results;
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

function extractModuleSpecifiers(content) {
    const clean = stripComments(content);
    const specs = [];
    const importFromRe =
        /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    const requireOrDynamicRe = /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = importFromRe.exec(clean)) !== null) {
        specs.push(match[1]);
    }
    while ((match = requireOrDynamicRe.exec(clean)) !== null) {
        specs.push(match[1]);
    }
    return specs;
}

const ELECTRON_LAYER_RANK = {
    domain: 0,
    repositories: 1,
    drivers: 1,
    services: 2,
    ipc: 3,
    transport: 3,
    app: 3,
    root: 4,
};

function getElectronLayer(filePath) {
    const rel = path
        .relative(path.join(ROOT, 'electron'), filePath)
        .replaceAll('\\', '/');
    const parts = rel.split('/');
    if (parts.length === 1) {
        return Object.prototype.hasOwnProperty.call(
            ELECTRON_LAYER_RANK,
            parts[0],
        )
            ? parts[0]
            : 'root';
    }
    return parts[0];
}

test('Backend (electron/) strictly obeys 5-layer bottom-up unidirectional dependency DAG', () => {
    const electronDir = path.join(ROOT, 'electron');
    const files = listSourceFiles(electronDir);
    assert.ok(files.length >= 25, 'Expected layered electron source files');

    const forbiddenDomainPackages = new Set([
        'fs',
        'node:fs',
        'fs/promises',
        'node:fs/promises',
        'http',
        'node:http',
        'https',
        'node:https',
        'child_process',
        'node:child_process',
        'tls',
        'node:tls',
        'electron',
        'better-sqlite3',
        'electron-store',
        'ws',
    ]);

    const violations = [];

    for (const file of files) {
        const relFile = path.relative(ROOT, file).replaceAll('\\', '/');
        const fromLayer = getElectronLayer(file);
        const fromRank = ELECTRON_LAYER_RANK[fromLayer];
        assert.notEqual(
            fromRank,
            undefined,
            `Unexpected top-level folder in electron/: ${relFile}`,
        );

        const rawContent = fs.readFileSync(file, 'utf8');
        const content = stripComments(rawContent);
        const specifiers = extractModuleSpecifiers(rawContent);

        // Rule 1: `ipcMain.handle` may ONLY appear inside `electron/ipc/`
        if (fromLayer !== 'ipc' && /\bipcMain\.handle\b/.test(content)) {
            violations.push(
                `${relFile}: ipcMain.handle is forbidden outside electron/ipc/`,
            );
        }

        // Rule 2: `BrowserWindow` may ONLY appear inside `electron/app/`, `electron/ipc/`, or `electron/main.ts`
        if (
            fromRank <= 2 &&
            /\bBrowserWindow\b/.test(content)
        ) {
            violations.push(
                `${relFile}: BrowserWindow is forbidden in ${fromLayer}/`,
            );
        }

        for (const spec of specifiers) {
            // Layer 0 (`domain`) must remain 100% pure (zero I/O, zero DB, zero Electron)
            if (fromLayer === 'domain' && forbiddenDomainPackages.has(spec)) {
                violations.push(
                    `${relFile}: domain module must not import I/O or framework package "${spec}"`,
                );
            }

            // Layer 2 (`services`) must not directly import `electron`, `better-sqlite3`, or `electron-store`
            if (
                fromLayer === 'services' &&
                (spec === 'electron' ||
                    spec === 'better-sqlite3' ||
                    spec === 'electron-store')
            ) {
                violations.push(
                    `${relFile}: service module must delegate "${spec}" to repositories/app layers`,
                );
            }

            if (spec.startsWith('.')) {
                const resolved = path.resolve(path.dirname(file), spec);
                if (resolved.startsWith(electronDir)) {
                    const toLayer = getElectronLayer(resolved);
                    const toRank = ELECTRON_LAYER_RANK[toLayer];
                    if (toRank !== undefined && toRank > fromRank) {
                        violations.push(
                            `${relFile} (L${fromRank}:${fromLayer}) -> ${spec} (L${toRank}:${toLayer}): upward dependency forbidden`,
                        );
                    }
                    // Sibling isolation at L3: `ipc`, `transport`, and `app` should not cross-import arbitrarily except ipc -> app/windowManager types if needed
                    if (
                        fromLayer === 'domain' &&
                        toLayer !== 'domain'
                    ) {
                        violations.push(
                            `${relFile}: domain module must only import sibling domain modules, got ${spec}`,
                        );
                    }
                }
            }
        }
    }

    assert.deepEqual(violations, []);
});

const SRC_LAYER_RANK = {
    types: 0,
    utils: 0,
    theme: 0,
    i18n: 0,
    common: 0,
    services: 1,
    contexts: 2,
    hooks: 2,
    featureComponents: 3,
    appRoot: 3,
};

function getSrcLayer(filePath) {
    const rel = path
        .relative(path.join(ROOT, 'src'), filePath)
        .replaceAll('\\', '/');
    const parts = rel.split('/');
    if (parts[0] === 'components') {
        return parts[1] === 'common' ? 'common' : 'featureComponents';
    }
    if (Object.prototype.hasOwnProperty.call(SRC_LAYER_RANK, parts[0])) {
        return parts[0];
    }
    if (parts.length === 1) return 'appRoot';
    return parts[0];
}

test('Frontend (src/) strictly obeys 4-layer bottom-up dependency DAG and IPC gateway encapsulation', () => {
    const srcDir = path.join(ROOT, 'src');
    const files = listSourceFiles(srcDir);
    assert.ok(files.length >= 25, 'Expected layered src files');

    const violations = [];

    for (const file of files) {
        const relFile = path.relative(ROOT, file).replaceAll('\\', '/');
        const fromLayer = getSrcLayer(file);
        const fromRank = SRC_LAYER_RANK[fromLayer];
        if (fromRank === undefined) continue;

        const rawContent = fs.readFileSync(file, 'utf8');
        const content = stripComments(rawContent);

        // Gateway invariant: `electronAPI` must ONLY appear in `src/types/` and `src/services/ipcGateway.ts`
        if (
            relFile !== 'src/services/ipcGateway.ts' &&
            !relFile.startsWith('src/types/') &&
            /\belectronAPI\b/.test(content)
        ) {
            violations.push(
                `${relFile}: direct window.electronAPI access is forbidden outside src/services/ipcGateway.ts`,
            );
        }

        const specifiers = extractModuleSpecifiers(rawContent);
        for (const spec of specifiers) {
            let resolved = null;
            if (spec.startsWith('.')) {
                resolved = path.resolve(path.dirname(file), spec);
            } else if (spec.startsWith('@/')) {
                resolved = path.resolve(srcDir, spec.slice(2));
            }
            if (!resolved || !resolved.startsWith(srcDir)) continue;

            const toLayer = getSrcLayer(resolved);
            const toRank = SRC_LAYER_RANK[toLayer];
            if (toRank !== undefined && toRank > fromRank) {
                violations.push(
                    `${relFile} (L${fromRank}:${fromLayer}) -> ${spec} (L${toRank}:${toLayer}): upward dependency forbidden`,
                );
            }
        }
    }

    assert.deepEqual(violations, []);
});
