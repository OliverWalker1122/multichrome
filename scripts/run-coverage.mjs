#!/usr/bin/env node
/**
 * MultiChrome L1 Unit & Integration Test Coverage Runner (Native Node 20 V8 Coverage).
 *
 * Measures real line, branch, and function coverage across production source modules
 * (excluding test & script harnesses), prints a per-layer summary, and optionally
 * emits shields.io-compatible JSON + SVG badges and GitHub Step Summary tables.
 *
 * Usage:
 *   npm run test:coverage
 *   node scripts/run-coverage.mjs --badge-out=coverage.svg --json-out=coverage-badge.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderBadgeSvg } from './generate-badge-svg.mjs';

function parseArgs(argv) {
    const opts = { badgeOut: '', jsonOut: '' };
    for (const arg of argv) {
        if (arg.startsWith('--badge-out=')) {
            opts.badgeOut = arg.slice('--badge-out='.length);
        } else if (arg.startsWith('--json-out=')) {
            opts.jsonOut = arg.slice('--json-out='.length);
        }
    }
    return opts;
}

const opts = parseArgs(process.argv.slice(2));

const proc = spawnSync(
    process.execPath,
    [
        '--test',
        '--experimental-test-coverage',
        '--test-coverage-exclude=tests/**',
        '--test-coverage-exclude=scripts/**',
        '--test-reporter=spec',
    ],
    {
        cwd: process.cwd(),
        env: {
            ...process.env,
            SKIP_DOTENV: 'true',
            DOTENV_CONFIG_PATH: '/dev/null',
        },
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
    },
);

const combined = `${proc.stdout || ''}\n${proc.stderr || ''}`;
process.stdout.write(proc.stdout || '');
if (proc.stderr) {
    process.stderr.write(proc.stderr);
}

// Parse test pass summary from Node's spec reporter
const totalTests = Number((combined.match(/ℹ tests (\d+)/) || [])[1] || 0);
const passTests = Number((combined.match(/ℹ pass (\d+)/) || [])[1] || 0);
const failTests = Number((combined.match(/ℹ fail (\d+)/) || [])[1] || 0);

// Parse V8 overall coverage row: `ℹ all files | 82.45 | 73.12 | 87.90 |`
const allFilesMatch = combined.match(
    /all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/,
);
const linePct = allFilesMatch ? Number(allFilesMatch[1]) : 0;
const branchPct = allFilesMatch ? Number(allFilesMatch[2]) : 0;
const funcPct = allFilesMatch ? Number(allFilesMatch[3]) : 0;

const lineLabel = linePct.toFixed(1);
const branchLabel = branchPct.toFixed(1);
const funcLabel = funcPct.toFixed(1);
const color =
    failTests === 0 && linePct >= 80
        ? '16a34a'
        : failTests === 0 && linePct >= 65
          ? 'ca8a04'
          : 'dc2626';

const badgePayload = {
    schemaVersion: 1,
    label: 'coverage',
    message: `${lineLabel}% lines`,
    color,
    metrics: {
        lines: linePct,
        branches: branchPct,
        functions: funcPct,
        testsTotal: totalTests,
        testsPassed: passTests,
        testsFailed: failTests,
    },
};

console.log('\n==================================================');
console.log(
    `L1 V8 Code Coverage (prod modules): Lines ${lineLabel}% | Branches ${branchLabel}% | Functions ${funcLabel}% | Tests ${passTests}/${totalTests}`,
);
console.log('==================================================');

if (opts.jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(opts.jsonOut)), { recursive: true });
    fs.writeFileSync(
        opts.jsonOut,
        JSON.stringify(badgePayload, null, 2) + '\n',
        'utf8',
    );
}

if (opts.badgeOut) {
    fs.mkdirSync(path.dirname(path.resolve(opts.badgeOut)), {
        recursive: true,
    });
    const svg = renderBadgeSvg({
        label: badgePayload.label,
        message: badgePayload.message,
        color: `#${badgePayload.color}`,
    });
    fs.writeFileSync(opts.badgeOut, svg, 'utf8');
}

if (process.env.GITHUB_STEP_SUMMARY) {
    const summaryMd = [
        `### Code Coverage (${process.env.RUNNER_OS || process.platform})`,
        '',
        '| Metric | Coverage |',
        '| :--- | :---: |',
        `| **Lines** | **${lineLabel}%** |`,
        `| **Branches** | ${branchLabel}% |`,
        `| **Functions** | ${funcLabel}% |`,
        `| **L1 Tests** | ${passTests}/${totalTests} passed |`,
        '',
    ].join('\n');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMd, 'utf8');
}

process.exit(typeof proc.status === 'number' ? proc.status : 1);
