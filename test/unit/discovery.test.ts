import assert from 'node:assert/strict';
import { selectDomain, detectDeviceClass, detectStateClass, buildConfig, buildAttributes } from '../../src/lib/discovery';
import type { IobStateObjectMinimal, RuntimeConfig } from '../../src/types';

function obj(common: Partial<IobStateObjectMinimal['common']>): IobStateObjectMinimal {
    return { common: { ...common } };
}

describe('selectDomain', () => {
    it('writable boolean → switch', () => {
        assert.equal(selectDomain(obj({ type: 'boolean', write: true })), 'switch');
    });
    it('readonly boolean → binary_sensor', () => {
        assert.equal(selectDomain(obj({ type: 'boolean', write: false })), 'binary_sensor');
    });
    it('writable number with dimmer role → light', () => {
        assert.equal(
            selectDomain(obj({ type: 'number', write: true, role: 'level.dimmer', min: 0, max: 100 })),
            'light',
        );
    });
    it('writable number without dimmer indicators → number', () => {
        assert.equal(
            selectDomain(obj({ type: 'number', write: true, role: 'value.power' })),
            'number',
        );
    });
    it('writable string → text', () => {
        assert.equal(selectDomain(obj({ type: 'string', write: true })), 'text');
    });
    it('writable mixed → text (fallback)', () => {
        assert.equal(selectDomain(obj({ type: 'mixed', write: true })), 'text');
    });
    it('readonly number → sensor', () => {
        assert.equal(selectDomain(obj({ type: 'number', write: false })), 'sensor');
    });
    it('readonly anything else → sensor', () => {
        assert.equal(selectDomain(obj({ type: 'string', write: false })), 'sensor');
    });
    it('missing write defaults to false (readonly)', () => {
        assert.equal(selectDomain(obj({ type: 'boolean' })), 'binary_sensor');
    });
});

describe('detectDeviceClass', () => {
    it('value.power → power', () => {
        assert.equal(detectDeviceClass(obj({ role: 'value.power' })), 'power');
    });
    it('unit=W → power', () => {
        assert.equal(detectDeviceClass(obj({ unit: 'W' })), 'power');
    });
    it('unit=kWh → energy', () => {
        assert.equal(detectDeviceClass(obj({ unit: 'kWh' })), 'energy');
    });
    it('value.temperature → temperature', () => {
        assert.equal(detectDeviceClass(obj({ role: 'value.temperature' })), 'temperature');
    });
    it('unit=°C → temperature', () => {
        assert.equal(detectDeviceClass(obj({ unit: '°C' })), 'temperature');
    });
    it('value.humidity → humidity', () => {
        assert.equal(detectDeviceClass(obj({ role: 'value.humidity' })), 'humidity');
    });
    it('sensor.motion → motion', () => {
        assert.equal(detectDeviceClass(obj({ role: 'sensor.motion' })), 'motion');
    });
    it('sensor.window → opening', () => {
        assert.equal(detectDeviceClass(obj({ role: 'sensor.window' })), 'opening');
    });
    it('unit=V → voltage', () => {
        assert.equal(detectDeviceClass(obj({ unit: 'V' })), 'voltage');
    });
    it('unit=A → current', () => {
        assert.equal(detectDeviceClass(obj({ unit: 'A' })), 'current');
    });
    it('unknown → undefined', () => {
        assert.equal(detectDeviceClass(obj({ role: 'state' })), undefined);
    });
    it('unit wins over role conflict (Shelly EM-3: role=value.power, unit=Wh → energy)', () => {
        assert.equal(detectDeviceClass(obj({ role: 'value.power', unit: 'Wh' })), 'energy');
    });
    it('unit=W with role=value.energy → power (unit wins)', () => {
        assert.equal(detectDeviceClass(obj({ role: 'value.energy', unit: 'W' })), 'power');
    });
});

describe('detectStateClass', () => {
    it('energy → total_increasing', () => {
        assert.equal(detectStateClass(obj({ unit: 'kWh' })), 'total_increasing');
    });
    it('power → measurement', () => {
        assert.equal(detectStateClass(obj({ unit: 'W' })), 'measurement');
    });
    it('temperature → measurement', () => {
        assert.equal(detectStateClass(obj({ unit: '°C' })), 'measurement');
    });
    it('unknown → undefined', () => {
        assert.equal(detectStateClass(obj({ role: 'state' })), undefined);
    });
});

const baseConfig: RuntimeConfig = {
    mqtt: { host: 'h', port: 1883, user: '', password: '', tls: false, baseTopic: 'iob2hass', discoveryPrefix: 'homeassistant' },
    mode: 'live',
    entityPrefix: 'iob_',
    autoDeleteOrphans: false,
    markAsDiagnostic: false,
    verboseDiscoverLog: false,
    republishOnBoot: true,
    whitelist: [],
    overrides: [],
};

describe('buildConfig', () => {
    it('builds switch with availability + per-DP device + command_topic + name=null', () => {
        const cfg = buildConfig('shelly.0.Relay0', obj({ type: 'boolean', write: true, name: 'Relay 0' }), baseConfig, 0);
        assert.equal(cfg.domain, 'switch');
        const p = cfg.payload;
        assert.equal(p.unique_id, 'iob_shelly_0_relay0');
        assert.equal(p.object_id, 'iob_shelly_0_relay0');
        assert.equal(p.name, null);
        assert.equal(p.state_topic, 'iob2hass/state/iob_shelly_0_relay0');
        assert.equal(p.command_topic, 'iob2hass/cmd/iob_shelly_0_relay0');
        assert.equal(p.json_attributes_topic, 'iob2hass/attrs/iob_shelly_0_relay0');
        assert.deepEqual(p.availability, { topic: 'iob2hass/status', payload_available: 'online', payload_not_available: 'offline' });
        const dev = p.device as Record<string, unknown>;
        assert.deepEqual(dev.identifiers, ['iob2hass-0-iob_shelly_0_relay0']);
        assert.equal(dev.name, 'iob_shelly_0_relay0');
        assert.equal(dev.model, 'ioBroker Mirror');
        assert.equal(dev.via_device, undefined);
        // payload_on/off are strings (HA-mqtt-switch validator expects strings,
        // not booleans). Must match the JSON.stringify(true|false) we publish.
        assert.equal(p.payload_on, 'true');
        assert.equal(p.payload_off, 'false');
    });

    it('sensor for read-only number with power detection', () => {
        const cfg = buildConfig('shelly.0.Power', obj({ type: 'number', write: false, role: 'value.power', unit: 'W' }), baseConfig, 0);
        assert.equal(cfg.domain, 'sensor');
        assert.equal(cfg.payload.device_class, 'power');
        assert.equal(cfg.payload.state_class, 'measurement');
        assert.equal(cfg.payload.unit_of_measurement, 'W');
        assert.equal(cfg.payload.command_topic, undefined);
    });

    it('alias path with umlaut transliterates to ae', () => {
        const cfg = buildConfig(
            'alias.0.HN5.STATES.Personen.Sebastian.Ladegerät.Handy',
            obj({ type: 'boolean', write: true }),
            baseConfig,
            0,
        );
        assert.equal(cfg.payload.unique_id, 'iob_alias_0_hn5_states_personen_sebastian_ladegeraet_handy');
        const dev = cfg.payload.device as Record<string, unknown>;
        assert.equal(dev.name, 'iob_alias_0_hn5_states_personen_sebastian_ladegeraet_handy');
    });

    it('override unit patches auto-detected unit', () => {
        const cfg = buildConfig(
            'shelly.0.Power',
            obj({ type: 'number', write: false, role: 'value.power', unit: 'W' }),
            { ...baseConfig, overrides: [{ pattern: 'shelly.0.Power', unit: 'mW' }] },
            0,
        );
        assert.equal(cfg.payload.unit_of_measurement, 'mW');
        assert.equal(cfg.payload.device_class, 'power');
    });

    it('override domain switches domain entirely', () => {
        const cfg = buildConfig(
            'shelly.0.X',
            obj({ type: 'number', write: true }),
            { ...baseConfig, overrides: [{ pattern: '*.X', domain: 'light' }] },
            0,
        );
        assert.equal(cfg.domain, 'light');
    });

    it('later override wins over earlier (merge-by-order)', () => {
        const cfg = buildConfig(
            'shelly.0.Power',
            obj({ type: 'number', write: false }),
            {
                ...baseConfig,
                overrides: [
                    { pattern: '*.Power', unit: 'W', device_class: 'power' },
                    { pattern: 'shelly.0.Power', unit: 'mW' },
                ],
            },
            0,
        );
        assert.equal(cfg.payload.unit_of_measurement, 'mW');
        assert.equal(cfg.payload.device_class, 'power');
    });

    it('buildAttributes carries unmodified DP id and common fields', () => {
        const attrs = buildAttributes(
            'alias.0.HN5.STATES.Personen.Sebastian.Ladegerät.handy',
            obj({ type: 'boolean', role: 'state', write: false, unit: undefined }),
        );
        assert.equal(attrs.iob_id, 'alias.0.HN5.STATES.Personen.Sebastian.Ladegerät.handy');
        assert.equal(attrs.iob_role, 'state');
        assert.equal(attrs.iob_type, 'boolean');
        assert.equal(attrs.iob_write, false);
        assert.equal(attrs.iob_unit, undefined);
    });

    it('binary_sensor payload_on/off explicitly "true"/"false" (matching JSON.stringify output)', () => {
        const cfg = buildConfig('a.b', obj({ type: 'boolean', write: false }), baseConfig, 0);
        assert.equal(cfg.domain, 'binary_sensor');
        assert.equal(cfg.payload.payload_on, 'true');
        assert.equal(cfg.payload.payload_off, 'false');
    });

    it('light payload_on/off explicitly "true"/"false" (matching JSON.stringify output)', () => {
        const cfg = buildConfig(
            'shelly.0.dimmer',
            obj({ type: 'number', write: true, role: 'level.dimmer', min: 0, max: 100 }),
            baseConfig,
            0,
        );
        assert.equal(cfg.domain, 'light');
        assert.equal(cfg.payload.payload_on, 'true');
        assert.equal(cfg.payload.payload_off, 'false');
    });

    it('markAsDiagnostic sets entity_category', () => {
        const cfg = buildConfig(
            'a.b',
            obj({ type: 'boolean', write: false }),
            { ...baseConfig, markAsDiagnostic: true },
            0,
        );
        assert.equal(cfg.payload.entity_category, 'diagnostic');
    });
});
