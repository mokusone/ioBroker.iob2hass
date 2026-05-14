import assert from 'node:assert/strict';
import { normalizeConfig, ConfigError } from '../../src/lib/config';

describe('normalizeConfig', () => {
    it('fills defaults for missing fields', () => {
        const cfg = normalizeConfig({});
        assert.equal(cfg.mqtt.host, 'core-mosquitto');
        assert.equal(cfg.mqtt.port, 1883);
        assert.equal(cfg.mqtt.baseTopic, 'iob2hass');
        assert.equal(cfg.mqtt.discoveryPrefix, 'homeassistant');
        assert.equal(cfg.mode, 'discover');
        assert.equal(cfg.entityPrefix, 'iob_');
        assert.deepEqual(cfg.whitelist, []);
        assert.deepEqual(cfg.overrides, []);
    });

    it('throws on invalid mode', () => {
        assert.throws(() => normalizeConfig({ mode: 'nope' }), ConfigError);
    });

    it('coerces active flag in whitelist entries', () => {
        const cfg = normalizeConfig({ whitelist: [{ pattern: 'a.*' }] });
        assert.equal(cfg.whitelist[0].active, true);
    });

    it('drops whitelist entries with empty pattern', () => {
        const cfg = normalizeConfig({ whitelist: [{ pattern: '', active: true }, { pattern: 'shelly.*' }] });
        assert.equal(cfg.whitelist.length, 1);
        assert.equal(cfg.whitelist[0].pattern, 'shelly.*');
    });

    it('drops override entries with empty pattern', () => {
        const cfg = normalizeConfig({ overrides: [{ pattern: '' }, { pattern: '*.X', unit: 'V' }] });
        assert.equal(cfg.overrides.length, 1);
    });
});
