import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyLanguagePreferences,
    isValidIanaTimeZone,
    parseGeoProbeResponse,
    resolveChromiumCountryId,
    resolveEffectiveLanguage,
    resolveLocaleForCountry,
    resolveTimezoneForCountry,
} from '../electron/domain/proxyGeo.js';

test('parseGeoProbeResponse parses ip-api, ipinfo, and ipwho.is responses including chunked HTTP', () => {
    const ipApiResp = Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n' +
            JSON.stringify({
                status: 'success',
                countryCode: 'BO',
                timezone: 'America/La_Paz',
                query: '198.51.100.10',
            }),
    );
    assert.deepEqual(parseGeoProbeResponse(ipApiResp), {
        ip: '198.51.100.10',
        timezone: 'America/La_Paz',
        countryCode: 'BO',
    });

    const ipInfoResp = Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n' +
            JSON.stringify({
                ip: '203.0.113.20',
                country: 'US',
                timezone: 'America/Los_Angeles',
            }),
    );
    assert.deepEqual(parseGeoProbeResponse(ipInfoResp), {
        ip: '203.0.113.20',
        timezone: 'America/Los_Angeles',
        countryCode: 'US',
    });

    const ipWhoBody = JSON.stringify({
        ip: '192.0.2.30',
        success: true,
        country_code: 'JP',
        timezone: { id: 'Asia/Tokyo', abbr: 'JST' },
    });
    const chunked = Buffer.from(
        `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${ipWhoBody.length.toString(16)}\r\n${ipWhoBody}\r\n0\r\n\r\n`,
    );
    assert.deepEqual(parseGeoProbeResponse(chunked), {
        ip: '192.0.2.30',
        timezone: 'Asia/Tokyo',
        countryCode: 'JP',
    });
});

test('parseGeoProbeResponse rejects error statuses and unsafe timezone strings', () => {
    const blocked = Buffer.from('HTTP/1.1 403 Forbidden\r\n\r\n{"ip":"1.2.3.4","timezone":"UTC"}');
    assert.equal(parseGeoProbeResponse(blocked), null);

    const failBody = Buffer.from('HTTP/1.1 200 OK\r\n\r\n{"status":"fail","query":"1.2.3.4"}');
    assert.equal(parseGeoProbeResponse(failBody), null);

    const badTz = Buffer.from(
        'HTTP/1.1 200 OK\r\n\r\n{"ip":"1.2.3.4","timezone":"Invalid/Zone;alert(1)"}',
    );
    assert.deepEqual(parseGeoProbeResponse(badTz), {
        ip: '1.2.3.4',
        timezone: undefined,
        countryCode: undefined,
    });

    assert.equal(isValidIanaTimeZone('America/La_Paz'), true);
    assert.equal(isValidIanaTimeZone('Not/ARealTimezone'), false);
    assert.equal(isValidIanaTimeZone('America/New_York";evil()'), false);
});

test('language defaults to en-US when unset and preserves explicit language when configured', () => {
    assert.equal(resolveEffectiveLanguage(undefined), 'en-US');
    assert.equal(resolveEffectiveLanguage(''), 'en-US');
    assert.equal(resolveEffectiveLanguage('   '), 'en-US');
    assert.equal(resolveEffectiveLanguage('en-GB'), 'en-GB');
    assert.equal(resolveEffectiveLanguage('ja-JP'), 'ja-JP');

    const prefs = {
        intl: {
            accept_languages: 'en,en-US,zh-CN,zh',
            selected_languages: 'zh-CN,zh',
        },
        translate_blocked_languages: ['zh-CN', 'zh'],
    };
    applyLanguagePreferences(prefs, undefined);
    assert.equal(prefs.intl.accept_languages, 'en-US,en');
    assert.equal(prefs.intl.selected_languages, 'en-US,en');
    assert.deepEqual(prefs.translate_blocked_languages, ['en']);
    assert.equal(prefs.countryid_at_install, 21843); // US

    applyLanguagePreferences(prefs, 'ja-JP');
    assert.equal(prefs.intl.accept_languages, 'ja-JP,en-US,en');
    assert.equal(prefs.intl.selected_languages, 'ja-JP,en-US,en');
    // Preserves already-initialized countryid_at_install
    assert.equal(prefs.countryid_at_install, 21843);

    assert.equal(resolveChromiumCountryId('en-US'), 21843);
    assert.equal(resolveChromiumCountryId('en-GB'), (71 << 8) | 66);
    assert.equal(resolveChromiumCountryId('ja-JP'), (74 << 8) | 80);
    assert.equal(resolveChromiumCountryId('en'), 21843);
});

test('auto language matches proxy exit country when enabled or configured as auto', () => {
    assert.equal(resolveLocaleForCountry('JP'), 'ja-JP');
    assert.equal(resolveLocaleForCountry('BO'), 'es-BO');
    assert.equal(resolveLocaleForCountry('de'), 'de-DE');
    assert.equal(resolveLocaleForCountry('TW'), 'zh-TW');
    assert.equal(resolveLocaleForCountry('ZZ', 'en-GB'), 'en-GB');

    // Explicit 'auto' follows countryCode
    assert.equal(
        resolveEffectiveLanguage('auto', { countryCode: 'JP', defaultLanguage: 'en-US' }),
        'ja-JP',
    );
    // Blank + global autoMatchLanguage=true follows countryCode
    assert.equal(
        resolveEffectiveLanguage('', {
            autoMatchLanguage: true,
            countryCode: 'FR',
            defaultLanguage: 'en-US',
        }),
        'fr-FR',
    );
    // Blank + global autoMatchLanguage=false uses defaultLanguage
    assert.equal(
        resolveEffectiveLanguage('', {
            autoMatchLanguage: false,
            countryCode: 'FR',
            defaultLanguage: 'en-GB',
        }),
        'en-GB',
    );
    // Explicit manual language always wins over autoMatchLanguage
    assert.equal(
        resolveEffectiveLanguage('ko-KR', {
            autoMatchLanguage: true,
            countryCode: 'US',
            defaultLanguage: 'en-US',
        }),
        'ko-KR',
    );
});

test('parseGeoProbeResponse extracts valid latitude and longitude when present', () => {
    const ipApiWithCoords = Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n' +
            JSON.stringify({
                status: 'success',
                countryCode: 'JP',
                timezone: 'Asia/Tokyo',
                query: '198.51.100.20',
                lat: 35.6895,
                lon: 139.6917,
            }),
    );
    assert.deepEqual(parseGeoProbeResponse(ipApiWithCoords), {
        ip: '198.51.100.20',
        timezone: 'Asia/Tokyo',
        countryCode: 'JP',
        latitude: 35.6895,
        longitude: 139.6917,
    });

    const ipInfoWithLoc = Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n' +
            JSON.stringify({
                ip: '203.0.113.25',
                country: 'US',
                timezone: 'America/Los_Angeles',
                loc: '34.0522,-118.2437',
            }),
    );
    assert.deepEqual(parseGeoProbeResponse(ipInfoWithLoc), {
        ip: '203.0.113.25',
        timezone: 'America/Los_Angeles',
        countryCode: 'US',
        latitude: 34.0522,
        longitude: -118.2437,
    });

    // Country-level timezone fallback when upstream payload omits timezone
    assert.equal(resolveTimezoneForCountry('BO'), 'America/La_Paz');
    const countryOnlyResp = Buffer.from(
        'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n' +
            JSON.stringify({
                ip: '198.51.100.88',
                country: 'BO',
            }),
    );
    assert.deepEqual(parseGeoProbeResponse(countryOnlyResp), {
        ip: '198.51.100.88',
        timezone: 'America/La_Paz',
        countryCode: 'BO',
    });
});
