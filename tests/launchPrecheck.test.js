import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(
    new URL('../src/utils/launchPrecheck.ts', import.meta.url),
    'utf8',
);
const exports = {};
vm.runInNewContext(
    ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
        },
    }).outputText,
    { exports },
);
const { checkProfile, canLaunchProfile } = exports;
const translate = (_zh, en) => en;
const ready = { ok: true, hasError: false, canAutoAlign: false, issues: [] };

test('a missing or interrupted precheck cannot launch, and a successful retry can', async () => {
    const env = { id: 'demo-profile' };
    for (const read of [
        async () => null,
        async () => {
            throw new Error('offline');
        },
    ]) {
        const incomplete = await checkProfile(env, read, translate);
        assert.equal(incomplete.incomplete, true);
        assert.equal(canLaunchProfile(incomplete), false);
    }
    const retried = await checkProfile(
        env,
        async (id) => {
            assert.equal(id, env.id);
            return ready;
        },
        translate,
    );
    assert.equal(canLaunchProfile(retried), true);
});

test('a mixed launch selection includes ready and warning profiles and excludes blocked and unchecked ones', async () => {
    const reports = new Map([
        ['ready', ready],
        ['notice', { ...ready, ok: false }],
        ['blocked', { ...ready, ok: false, hasError: true }],
        ['unchecked', null],
    ]);
    const entries = await Promise.all(
        Array.from(reports.keys(), (id) =>
            checkProfile(
                { id },
                async (target) => reports.get(target),
                translate,
            ),
        ),
    );
    assert.deepEqual(
        entries.filter(canLaunchProfile).map((entry) => entry.env.id),
        ['ready', 'notice'],
    );
});
