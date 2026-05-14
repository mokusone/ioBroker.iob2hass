import type { RuntimeConfig, WhitelistEntry, OverrideEntry, HaDomain } from '../types';

export class ConfigError extends Error {}

const DEFAULTS: RuntimeConfig = {
    mqtt: {
        host: 'core-mosquitto',
        port: 1883,
        user: '',
        password: '',
        tls: false,
        baseTopic: 'iob2hass',
        discoveryPrefix: 'homeassistant',
    },
    mode: 'discover',
    entityPrefix: 'iob_',
    autoDeleteOrphans: false,
    markAsDiagnostic: false,
    verboseDiscoverLog: false,
    republishOnBoot: true,
    whitelist: [],
    overrides: [],
};

function pickString(v: unknown, dflt: string): string {
    return typeof v === 'string' && v.length > 0 ? v : dflt;
}

function pickNumber(v: unknown, dflt: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function pickBool(v: unknown, dflt: boolean): boolean {
    return typeof v === 'boolean' ? v : dflt;
}

function normWhitelist(raw: unknown): WhitelistEntry[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((e: any) => ({
            pattern: typeof e?.pattern === 'string' ? e.pattern.trim() : '',
            active: typeof e?.active === 'boolean' ? e.active : true,
            note: typeof e?.note === 'string' ? e.note : undefined,
        }))
        .filter(e => e.pattern.length > 0);
}

function normOverrides(raw: unknown): OverrideEntry[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((e: any) => ({
            pattern: typeof e?.pattern === 'string' ? e.pattern.trim() : '',
            domain: typeof e?.domain === 'string' ? (e.domain as HaDomain) : undefined,
            unit: typeof e?.unit === 'string' ? e.unit : undefined,
            role: typeof e?.role === 'string' ? e.role : undefined,
            device_class: typeof e?.device_class === 'string' ? e.device_class : undefined,
            state_class: typeof e?.state_class === 'string' ? e.state_class : undefined,
            min: typeof e?.min === 'number' ? e.min : undefined,
            max: typeof e?.max === 'number' ? e.max : undefined,
        }))
        .filter(e => e.pattern.length > 0);
}

export function normalizeConfig(native: any): RuntimeConfig {
    const mode = native?.mode ?? DEFAULTS.mode;
    if (!['discover', 'dry-run', 'live'].includes(mode)) {
        throw new ConfigError(`Invalid mode: ${mode}`);
    }
    const mqtt = native?.mqtt ?? {};
    return {
        mqtt: {
            host: pickString(mqtt.host, DEFAULTS.mqtt.host),
            port: pickNumber(mqtt.port, DEFAULTS.mqtt.port),
            user: pickString(mqtt.user, DEFAULTS.mqtt.user),
            password: pickString(mqtt.password, DEFAULTS.mqtt.password),
            tls: pickBool(mqtt.tls, DEFAULTS.mqtt.tls),
            baseTopic: pickString(mqtt.baseTopic, DEFAULTS.mqtt.baseTopic),
            discoveryPrefix: pickString(mqtt.discoveryPrefix, DEFAULTS.mqtt.discoveryPrefix),
        },
        mode,
        entityPrefix: pickString(native?.entityPrefix, DEFAULTS.entityPrefix),
        autoDeleteOrphans: pickBool(native?.autoDeleteOrphans, DEFAULTS.autoDeleteOrphans),
        markAsDiagnostic: pickBool(native?.markAsDiagnostic, DEFAULTS.markAsDiagnostic),
        verboseDiscoverLog: pickBool(native?.verboseDiscoverLog, DEFAULTS.verboseDiscoverLog),
        republishOnBoot: pickBool(native?.republishOnBoot, DEFAULTS.republishOnBoot),
        whitelist: normWhitelist(native?.whitelist),
        overrides: normOverrides(native?.overrides),
    };
}
