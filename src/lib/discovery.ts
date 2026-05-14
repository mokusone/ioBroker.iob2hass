import type {
    DiscoveryConfig,
    HaDomain,
    IobStateObjectMinimal,
    OverrideEntry,
    RuntimeConfig,
} from '../types';
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
        if (type === 'boolean') return 'switch';
        if (type === 'number') {
            if (isDimmer(c)) return 'light';
            return 'number';
        }
        if (type === 'string') return 'text';
        return 'text'; // mixed / unknown writable → text
    }
    // read-only
    if (type === 'boolean') return 'binary_sensor';
    return 'sensor';
}

const POWER_UNITS = new Set(['W', 'kW']);
const ENERGY_UNITS = new Set(['kWh', 'Wh', 'MWh']);
const TEMP_UNITS = new Set(['°C', '°F']);

export function detectDeviceClass(obj: IobStateObjectMinimal): string | undefined {
    const role = obj.common.role ?? '';
    const unit = obj.common.unit ?? '';

    if (role.includes('value.power') || POWER_UNITS.has(unit)) return 'power';
    if (role.includes('value.energy') || ENERGY_UNITS.has(unit)) return 'energy';
    if (role.includes('value.temperature') || TEMP_UNITS.has(unit)) return 'temperature';
    if (role.includes('value.humidity') || (role.includes('humidity') && unit === '%')) return 'humidity';
    if (role.includes('sensor.motion')) return 'motion';
    if (role.includes('sensor.window') || role.includes('sensor.door')) return 'opening';
    if (role.includes('value.voltage') || unit === 'V') return 'voltage';
    if (role.includes('value.current') || unit === 'A') return 'current';
    return undefined;
}

export function detectStateClass(obj: IobStateObjectMinimal): string | undefined {
    const dc = detectDeviceClass(obj);
    if (dc === 'energy') return 'total_increasing';
    if (dc === 'power' || dc === 'temperature' || dc === 'humidity' || dc === 'voltage' || dc === 'current') {
        return 'measurement';
    }
    return undefined;
}

function resolveName(_dpId: string, obj: IobStateObjectMinimal, uniqueId: string): string {
    const n = obj.common.name;
    if (typeof n === 'string' && n.length > 0) return n;
    if (n && typeof n === 'object') {
        return n.en ?? n.de ?? Object.values(n)[0] ?? uniqueId;
    }
    return uniqueId;
}

function applyOverrides(
    target: Record<string, unknown>,
    dpId: string,
    overrides: OverrideEntry[],
): { domain?: HaDomain } {
    let domain: HaDomain | undefined;
    for (const ov of overrides) {
        if (!matches(dpId, ov.pattern)) continue;
        if (ov.domain) domain = ov.domain;
        if (ov.unit !== undefined) target.unit_of_measurement = ov.unit;
        if (ov.device_class !== undefined) target.device_class = ov.device_class;
        if (ov.state_class !== undefined) target.state_class = ov.state_class;
        if (ov.min !== undefined) target.min = ov.min;
        if (ov.max !== undefined) target.max = ov.max;
    }
    return { domain };
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
        name: resolveName(dpId, obj, uniqueId),
        state_topic: `${config.mqtt.baseTopic}/state/${uniqueId}`,
        availability: {
            topic: `${config.mqtt.baseTopic}/status`,
            payload_available: 'online',
            payload_not_available: 'offline',
        },
        device: {
            identifiers: [`iob2hass-${instance}`],
            name: 'ioBroker Bridge',
            manufacturer: 'iob2hass',
            model: 'Mirror-Bridge',
        },
    };

    if (deviceClass) payload.device_class = deviceClass;
    if (stateClass) payload.state_class = stateClass;
    if (obj.common.unit) payload.unit_of_measurement = obj.common.unit;
    if (config.markAsDiagnostic) payload.entity_category = 'diagnostic';

    const { domain: overrideDomain } = applyOverrides(payload, dpId, config.overrides);
    const domain: HaDomain = overrideDomain ?? auto;

    if (domain === 'switch' || domain === 'light' || domain === 'number' || domain === 'text' || domain === 'button') {
        payload.command_topic = `${config.mqtt.baseTopic}/cmd/${uniqueId}`;
    }

    if (domain === 'switch') {
        payload.payload_on = true;
        payload.payload_off = false;
    }

    if (domain === 'light' && obj.common.max !== undefined) {
        payload.brightness_command_topic = `${config.mqtt.baseTopic}/cmd/${uniqueId}/brightness`;
        payload.brightness_scale = obj.common.max;
    }

    return { domain, payload };
}
