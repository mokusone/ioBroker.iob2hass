import type { DiscoveryConfig, HaDomain, IobStateObjectMinimal, OverrideEntry, RuntimeConfig } from '../types';
import { buildUniqueId } from './sanitizer';
import { matches } from './matcher';

function isDimmer(common: IobStateObjectMinimal['common']): boolean {
    const role = common.role ?? '';
    const hasRange = common.min !== undefined && common.max !== undefined;
    return hasRange && /(level\.dimmer|level\.brightness)/.test(role);
}

export function selectDomain(obj: IobStateObjectMinimal): HaDomain {
    const c = obj.common;
    const write = c.write === true;
    const type = c.type;

    if (write) {
        if (type === 'boolean') {
            return 'switch';
        }
        if (type === 'number') {
            if (isDimmer(c)) {
                return 'light';
            }
            return 'number';
        }
        if (type === 'string') {
            return 'text';
        }
        return 'text'; // mixed / unknown writable → text
    }
    // read-only
    if (type === 'boolean') {
        return 'binary_sensor';
    }
    return 'sensor';
}

const POWER_UNITS = new Set(['W', 'kW']);
const ENERGY_UNITS = new Set(['kWh', 'Wh', 'MWh']);
const TEMP_UNITS = new Set(['°C', '°F']);

export function detectDeviceClass(obj: IobStateObjectMinimal): string | undefined {
    const role = obj.common.role ?? '';
    const unit = obj.common.unit ?? '';

    // Unit takes precedence over role. Units are unambiguous; roles in many
    // ioBroker adapters are sloppily set (e.g. Shelly EM-3 marks energy
    // counters as role=value.power but unit=Wh — unit wins, role is junk).
    if (ENERGY_UNITS.has(unit)) {
        return 'energy';
    }
    if (POWER_UNITS.has(unit)) {
        return 'power';
    }
    if (TEMP_UNITS.has(unit)) {
        return 'temperature';
    }
    if (unit === 'V') {
        return 'voltage';
    }
    if (unit === 'A') {
        return 'current';
    }
    if (unit === '%' && (role.includes('humidity') || role.includes('value.humidity'))) {
        return 'humidity';
    }

    // No unit hint — fall back to role.
    if (role.includes('value.energy')) {
        return 'energy';
    }
    if (role.includes('value.power')) {
        return 'power';
    }
    if (role.includes('value.temperature')) {
        return 'temperature';
    }
    if (role.includes('value.humidity')) {
        return 'humidity';
    }
    if (role.includes('sensor.motion')) {
        return 'motion';
    }
    if (role.includes('sensor.window') || role.includes('sensor.door')) {
        return 'opening';
    }
    if (role.includes('value.voltage')) {
        return 'voltage';
    }
    if (role.includes('value.current')) {
        return 'current';
    }
    return undefined;
}

export function detectStateClass(obj: IobStateObjectMinimal): string | undefined {
    const dc = detectDeviceClass(obj);
    if (dc === 'energy') {
        return 'total_increasing';
    }
    if (dc === 'power' || dc === 'temperature' || dc === 'humidity' || dc === 'voltage' || dc === 'current') {
        return 'measurement';
    }
    return undefined;
}

function applyOverrides(
    target: Record<string, unknown>,
    dpId: string,
    overrides: OverrideEntry[],
): { domain?: HaDomain } {
    let domain: HaDomain | undefined;
    for (const ov of overrides) {
        if (!matches(dpId, ov.pattern)) {
            continue;
        }
        if (ov.domain) {
            domain = ov.domain;
        }
        if (ov.unit !== undefined) {
            target.unit_of_measurement = ov.unit;
        }
        if (ov.device_class !== undefined) {
            target.device_class = ov.device_class;
        }
        if (ov.state_class !== undefined) {
            target.state_class = ov.state_class;
        }
        if (ov.min !== undefined) {
            target.min = ov.min;
        }
        if (ov.max !== undefined) {
            target.max = ov.max;
        }
    }
    return { domain };
}

/**
 * Build the attribute payload for `json_attributes_topic`. Carries the
 * unmodified ioBroker DP id and the original common metadata so the user
 * can reverse-look-up the source from inside HA (entity detail view,
 * templates, automations).
 */
export function buildAttributes(dpId: string, obj: IobStateObjectMinimal): Record<string, unknown> {
    const c = obj.common;
    const attrs: Record<string, unknown> = { iob_id: dpId };
    if (c.role) {
        attrs.iob_role = c.role;
    }
    if (c.unit) {
        attrs.iob_unit = c.unit;
    }
    if (c.type) {
        attrs.iob_type = c.type;
    }
    if (c.min !== undefined) {
        attrs.iob_min = c.min;
    }
    if (c.max !== undefined) {
        attrs.iob_max = c.max;
    }
    if (c.write !== undefined) {
        attrs.iob_write = c.write;
    }
    return attrs;
}

export function buildConfig(
    dpId: string,
    obj: IobStateObjectMinimal,
    config: RuntimeConfig,
    instance: number,
): DiscoveryConfig {
    const uniqueId = buildUniqueId(dpId, config.entityPrefix);
    const auto = selectDomain(obj);
    const deviceClass = detectDeviceClass(obj);
    const stateClass = detectStateClass(obj);

    const payload: Record<string, unknown> = {
        unique_id: uniqueId,
        object_id: uniqueId,
        // name=null tells HA to use device.name for the friendly name and
        // entity_id, instead of "<device>_<entity>". Combined with a per-DP
        // device whose name IS the full sanitized path, this yields
        // entity_ids like switch.iob_alias_0_hn5_..._handy — preserving
        // the full ioBroker DP path in the HA id.
        name: null,
        state_topic: `${config.mqtt.baseTopic}/state/${uniqueId}`,
        // Attribute topic carries the original ioBroker DP id and metadata
        // so the user can reverse-look-up the source without losing info to
        // the entity-id sanitizer.
        json_attributes_topic: `${config.mqtt.baseTopic}/attrs/${uniqueId}`,
        availability: {
            topic: `${config.mqtt.baseTopic}/status`,
            payload_available: 'online',
            payload_not_available: 'offline',
        },
        device: {
            // Per-DP unique identifier — every mirror becomes its own HA
            // device. The device name carries the full sanitized DP path so
            // HA composes entity_id = <domain>.<device-name>.
            // NO via_device: HA bug #131551 creates a phantom "Unbenannter
            // Gerät" hub when via_device points at an unregistered device.
            // Mirrors stay identifiable by manufacturer="iob2hass".
            identifiers: [`iob2hass-${instance}-${uniqueId}`],
            name: uniqueId,
            manufacturer: 'iob2hass',
            model: 'ioBroker Mirror',
        },
    };

    if (deviceClass) {
        payload.device_class = deviceClass;
    }
    if (stateClass) {
        payload.state_class = stateClass;
    }
    if (obj.common.unit) {
        payload.unit_of_measurement = obj.common.unit;
    }
    if (config.markAsDiagnostic) {
        payload.entity_category = 'diagnostic';
    }

    const { domain: overrideDomain } = applyOverrides(payload, dpId, config.overrides);
    const domain: HaDomain = overrideDomain ?? auto;

    if (domain === 'switch' || domain === 'light' || domain === 'number' || domain === 'text' || domain === 'button') {
        payload.command_topic = `${config.mqtt.baseTopic}/cmd/${uniqueId}`;
    }

    // Every domain that takes a boolean state needs payload_on/off as the
    // exact string our publishMirrorState emits via JSON.stringify(true|false).
    // Otherwise HA falls back to its default "ON"/"OFF" and our "true"/"false"
    // payloads never match — entity stays "unknown" forever.
    if (domain === 'switch' || domain === 'binary_sensor' || domain === 'light') {
        payload.payload_on = 'true';
        payload.payload_off = 'false';
    }

    if (domain === 'light' && obj.common.max !== undefined) {
        payload.brightness_command_topic = `${config.mqtt.baseTopic}/cmd/${uniqueId}/brightness`;
        payload.brightness_scale = obj.common.max;
    }

    return { domain, payload };
}
