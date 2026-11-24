import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseCookiesInput,
    serializeCookiesJson,
    serializeCookiesNetscape,
} from '../electron/domain/cookieCodec.js';

test('parseCookiesInput parses JSON array and { cookies } wrapper with expirationDate & sameSite normalization', () => {
    const jsonCookies = parseCookiesInput(
        JSON.stringify([
            {
                name: 'session_id',
                value: 'abc123',
                domain: '.example.com',
                path: '/app',
                secure: true,
                httpOnly: true,
                sameSite: 'no_restriction',
                expirationDate: 1900000000,
            },
            {
                name: 'prefs',
                value: 'dark',
                domain: 'example.com',
                sameSite: 'lax',
            },
        ]),
    );

    assert.equal(jsonCookies.length, 2);
    assert.deepEqual(jsonCookies[0], {
        name: 'session_id',
        value: 'abc123',
        domain: '.example.com',
        path: '/app',
        secure: true,
        httpOnly: true,
        sameSite: 'None',
        expires: 1900000000,
    });
    assert.equal(jsonCookies[1].sameSite, 'Lax');
    assert.equal(jsonCookies[1].path, '/');

    const wrapped = parseCookiesInput(
        JSON.stringify({
            cookies: [{ name: 'k', value: 'v=1=2', domain: 'example.com' }],
        }),
    );
    assert.equal(wrapped.length, 1);
    assert.equal(wrapped[0].value, 'v=1=2');
});

test('parseCookiesInput parses Netscape format including #HttpOnly_ prefix and serializeCookiesNetscape round-trips', () => {
    const rawNetscape = [
        '# Netscape HTTP Cookie File',
        '# Comment line',
        '#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1950000000\tmc_session\tactive=1',
        'example.com\tFALSE\t/docs\tFALSE\t0\ttheme\tlight',
    ].join('\n');

    const parsed = parseCookiesInput(rawNetscape);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].domain, '.example.com');
    assert.equal(parsed[0].httpOnly, true);
    assert.equal(parsed[0].secure, true);
    assert.equal(parsed[0].value, 'active=1');
    assert.equal(parsed[1].httpOnly, false);
    assert.equal('expires' in parsed[1], false);

    const exportedNetscape = serializeCookiesNetscape(parsed);
    assert.ok(exportedNetscape.includes('#HttpOnly_.example.com\tTRUE\t/\tTRUE\t1950000000\tmc_session\tactive=1'));
    const roundTripped = parseCookiesInput(exportedNetscape);
    assert.equal(roundTripped.length, 2);
    assert.equal(roundTripped[0].httpOnly, true);

    const exportedJson = JSON.parse(serializeCookiesJson(parsed));
    assert.equal(exportedJson.length, 2);
});

test('parseCookiesInput rejects empty or invalid input cleanly', () => {
    assert.throws(() => parseCookiesInput(''), /请输入/);
    assert.throws(() => parseCookiesInput('{bad json'), /JSON 格式无效/);
    assert.throws(() => parseCookiesInput('not a valid netscape line'), /未解析到有效/);
});
