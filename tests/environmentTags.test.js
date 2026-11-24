import test from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_TAG_LENGTH,
    MAX_TAGS_PER_ENV,
    collectTagStats,
    filterEnvironmentsByTags,
    matchesTagFilter,
    normalizeEnvironmentTags,
    normalizeTagName,
    parseStoredEnvironmentTags,
    parseTagInput,
} from '../electron/domain/environmentTags.js';

test('normalizeTagName trims, collapses spaces, and enforces max length', () => {
    assert.equal(normalizeTagName('  US   West  '), 'US West');
    assert.equal(normalizeTagName('   '), '');
    assert.equal(normalizeTagName(null), '');
    assert.equal(normalizeTagName(123), '');

    const longTag = 'a'.repeat(MAX_TAG_LENGTH + 10);
    assert.equal(normalizeTagName(longTag).length, MAX_TAG_LENGTH);
});

test('parseTagInput splits comma/semicolon/newline separated tags and deduplicates', () => {
    assert.deepEqual(
        parseTagInput('US,  us，Work; 测试\n工作；WORK'),
        ['US', 'Work', '测试', '工作'],
    );
});

test('normalizeEnvironmentTags preserves first casing and caps tag count', () => {
    assert.deepEqual(
        normalizeEnvironmentTags(['VIP', 'vip', '  US ', '', 'us']),
        ['VIP', 'US'],
    );

    const many = Array.from({ length: MAX_TAGS_PER_ENV + 5 }, (_, idx) => `tag-${idx + 1}`);
    const normalized = normalizeEnvironmentTags(many);
    assert.equal(normalized.length, MAX_TAGS_PER_ENV);
    assert.equal(normalized[0], 'tag-1');
    assert.equal(normalized[MAX_TAGS_PER_ENV - 1], `tag-${MAX_TAGS_PER_ENV}`);
});

test('parseStoredEnvironmentTags handles valid, empty, and malformed JSON safely', () => {
    assert.deepEqual(parseStoredEnvironmentTags('["US","Shop","us"]'), ['US', 'Shop']);
    assert.deepEqual(parseStoredEnvironmentTags(''), []);
    assert.deepEqual(parseStoredEnvironmentTags(null), []);
    assert.deepEqual(parseStoredEnvironmentTags('{bad json'), []);
    assert.deepEqual(parseStoredEnvironmentTags('{"not":"array"}'), []);
    assert.deepEqual(parseStoredEnvironmentTags(['A', 'B']), ['A', 'B']);
});

test('collectTagStats aggregates counts case-insensitively and sorts by count desc', () => {
    const stats = collectTagStats([
        { tags: ['US', 'Main', 'us'] },
        { tags: ['us', 'Backup'] },
        { tags: ['JP', 'Main'] },
        { tags: [] },
    ]);

    assert.deepEqual(stats, [
        { tag: 'Main', count: 2 },
        { tag: 'US', count: 2 },
        { tag: 'Backup', count: 1 },
        { tag: 'JP', count: 1 },
    ]);
});

test('matchesTagFilter and filterEnvironmentsByTags support AND and OR modes', () => {
    const envs = [
        { id: '1', tags: ['US', 'Main'] },
        { id: '2', tags: ['US', 'Backup'] },
        { id: '3', tags: ['JP', 'Main'] },
        { id: '4', tags: [] },
    ];

    assert.equal(matchesTagFilter(['US'], [], 'all'), true);
    assert.equal(matchesTagFilter([], ['US'], 'all'), false);
    assert.equal(matchesTagFilter(['US', 'Main'], ['us', 'MAIN'], 'all'), true);
    assert.equal(matchesTagFilter(['US'], ['us', 'main'], 'all'), false);
    assert.equal(matchesTagFilter(['US'], ['us', 'main'], 'any'), true);

    assert.deepEqual(
        filterEnvironmentsByTags(envs, ['us', 'main'], 'all').map((e) => e.id),
        ['1'],
    );
    assert.deepEqual(
        filterEnvironmentsByTags(envs, ['us', 'main'], 'any').map((e) => e.id),
        ['1', '2', '3'],
    );
    assert.deepEqual(
        filterEnvironmentsByTags(envs, [], 'all').map((e) => e.id),
        ['1', '2', '3', '4'],
    );
});
