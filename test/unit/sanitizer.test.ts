import assert from 'node:assert/strict';
import { sanitize, buildUniqueId } from '../../src/lib/sanitizer';

describe('sanitize', () => {
    it('lowercases', () => {
        assert.equal(sanitize('Shelly.0'), 'shelly_0');
    });
    it('replaces non [a-z0-9_] with underscore', () => {
        assert.equal(sanitize('shelly.0.SHSW1#abc'), 'shelly_0_shsw1_abc');
    });
    it('collapses multiple underscores', () => {
        assert.equal(sanitize('a..b##c'), 'a_b_c');
    });
    it('trims leading/trailing underscores', () => {
        assert.equal(sanitize('.foo.'), 'foo');
    });
    it('handles realistic Shelly DP', () => {
        assert.equal(
            sanitize('shelly.0.SHSW1#abc.Relay0.Switch'),
            'shelly_0_shsw1_abc_relay0_switch',
        );
    });
    it('transliterates German umlauts (ä→ae, ö→oe, ü→ue, ß→ss)', () => {
        assert.equal(sanitize('Ladegerät'), 'ladegeraet');
        assert.equal(sanitize('Tür'), 'tuer');
        assert.equal(sanitize('Straße'), 'strasse');
        assert.equal(sanitize('Öl'), 'oel');
    });
    it('transliterates in realistic alias path', () => {
        assert.equal(
            sanitize('alias.0.HN5.STATES.Personen.Sebastian.Ladegerät.Handy'),
            'alias_0_hn5_states_personen_sebastian_ladegeraet_handy',
        );
    });
});

describe('buildUniqueId', () => {
    it('prepends entityPrefix', () => {
        assert.equal(
            buildUniqueId('shelly.0.Relay0', 'iob_'),
            'iob_shelly_0_relay0',
        );
    });
    it('handles empty prefix', () => {
        assert.equal(buildUniqueId('a.b', ''), 'a_b');
    });
});
