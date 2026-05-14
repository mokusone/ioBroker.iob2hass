import assert from 'node:assert/strict';
import { isOwnWrite, buildSelfId } from '../../src/lib/loop-guard';

describe('isOwnWrite', () => {
    const selfId = 'system.adapter.iob2hass.0';

    it('detects our own writes', () => {
        assert.equal(isOwnWrite({ from: selfId }, selfId), true);
    });
    it('passes foreign writes through', () => {
        assert.equal(isOwnWrite({ from: 'system.adapter.shelly.0' }, selfId), false);
    });
    it('treats missing from as foreign (safe default — pass through)', () => {
        assert.equal(isOwnWrite({}, selfId), false);
    });
});

describe('buildSelfId', () => {
    it('builds canonical id from instance', () => {
        assert.equal(buildSelfId(0), 'system.adapter.iob2hass.0');
        assert.equal(buildSelfId(3), 'system.adapter.iob2hass.3');
    });
});
