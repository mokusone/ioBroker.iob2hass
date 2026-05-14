import assert from 'node:assert/strict';
import { globToRegex, matches, anyMatches } from '../../src/lib/matcher';

describe('globToRegex', () => {
    it('escapes regex special chars except *', () => {
        const re = globToRegex('shelly.0.*');
        assert.equal(re.source, '^shelly\\.0\\..*$');
    });
    it('treats * as ".*"', () => {
        const re = globToRegex('*.Power');
        assert.equal(re.source, '^.*\\.Power$');
    });
});

describe('matches', () => {
    it('exact match', () => {
        assert.equal(matches('shelly.0.SHSW1', 'shelly.0.SHSW1'), true);
    });
    it('wildcard match', () => {
        assert.equal(matches('shelly.0.SHSW1.Power', 'shelly.0.*'), true);
        assert.equal(matches('homematic.0.x', 'shelly.0.*'), false);
    });
    it('cross-adapter wildcard match', () => {
        assert.equal(matches('shelly.0.SHSW1.Power', '*.Power'), true);
        assert.equal(matches('homematic.0.dev.Power', '*.Power'), true);
        assert.equal(matches('shelly.0.SHSW1.Energy', '*.Power'), false);
    });
    it('special chars in DP id are matched literally', () => {
        assert.equal(matches('shelly.0.SHSW1#abc', 'shelly.0.SHSW1#*'), true);
    });
});

describe('anyMatches', () => {
    it('returns true if any pattern matches', () => {
        assert.equal(
            anyMatches('shelly.0.x', ['homematic.0.*', 'shelly.0.*']),
            true,
        );
    });
    it('returns false if no pattern matches', () => {
        assert.equal(anyMatches('a.b', ['c.*', 'd.*']), false);
    });
});
