import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import inspectPixelScan from '../scripts/inspect-pixelscan.cjs';

function inspect(body, { title = 'Fingerprint Scan', frames = [], navigationError = false } = {}) {
    const document = {
        title,
        body: { innerText: body },
        querySelector: selector => selector === '#main-frame-error' && navigationError,
        querySelectorAll: () => frames,
    };
    // Exercise the same serialized function as Runtime.evaluate.
    const result = runInNewContext('(' + inspectPixelScan.toString() + ')(document)', { document });
    return { ...result };
}

test('PixelScan reads explicit verdicts on one or two lines', () => {
    for (const verdict of ['consistent', 'inconsistent']) {
        for (const separator of [' ', '\n', '\r\n\n']) {
            assert.deepEqual(inspect('Fingerprint Scan\nYour Browser Fingerprint is' + separator + verdict), {
                ready: true,
                verdict,
            });
        }
    }
});

test('PixelScan ignores explanatory copy, pending states and contradictory results', () => {
    for (const sample of [
        'Your browser fingerprint is scanning\nMasking detected',
        'Fingerprint Scan\nInconsistent',
        'FAQ\nYour browser fingerprint is consistent',
        'Your browser fingerprint is consistent\nYour browser fingerprint is inconsistent',
        'No proxy detected\nNo automated behavior detected',
        '',
    ]) {
        assert.deepEqual(inspect(sample), { ready: false });
    }
    const result = 'Your Browser Fingerprint is\nInconsistent';
    const footer = '\nFrequently Asked Questions\nYour browser fingerprint is consistent\nVerify you are human';
    assert.deepEqual(inspect('CAPTCHA guide\n' + result + footer), { ready: true, verdict: 'inconsistent' });
});

test('PixelScan stops at an active challenge, including when a stale verdict remains visible', () => {
    const blocked = { blocked: 'CAPTCHA/Challenge' };
    const body = 'Your browser fingerprint is consistent';
    assert.deepEqual(inspect(body, { title: 'Just a moment...' }), blocked);
    assert.deepEqual(inspect('Verify you are human by completing the action below.'), blocked);
    const frame = visible => ({ clientWidth: 250, clientHeight: 65, checkVisibility: () => visible });
    assert.deepEqual(inspect(body, { frames: [frame(true)] }), blocked);
    assert.deepEqual(inspect(body, { frames: [frame(false)] }), { ready: true, verdict: 'consistent' });
});

test('PixelScan reports navigation and missing-page errors without exposing page contents', () => {
    assert.deepEqual(inspect('', { navigationError: true }), { error: 'Browser navigation error' });
    assert.deepEqual(inspect('404 - Page not found'), { error: 'Page not found' });
});
