// Runtime configuration shape (after normalization from native)
export interface RuntimeConfig {
    mqtt: {
        host: string;
        port: number;
        user: string;
        password: string;
        tls: boolean;
        baseTopic: string;
        discoveryPrefix: string;
    };
    mode: 'discover' | 'dry-run' | 'live';
    entityPrefix: string;
    autoDeleteOrphans: boolean;
    markAsDiagnostic: boolean;
    verboseDiscoverLog: boolean;
    republishOnBoot: boolean;
    whitelist: WhitelistEntry[];
    overrides: OverrideEntry[];
}

export interface WhitelistEntry {
    pattern: string;
    active: boolean;
    note?: string;
}

export interface OverrideEntry {
    pattern: string;
    domain?: HaDomain;
    unit?: string;
    role?: string;
    device_class?: string;
    state_class?: string;
    min?: number;
    max?: number;
}

export type HaDomain =
    | 'switch'
    | 'binary_sensor'
    | 'sensor'
    | 'light'
    | 'number'
    | 'text'
    | 'button'
    | 'climate'
    | 'cover';

export interface DiscoveryConfig {
    domain: HaDomain;
    payload: Record<string, unknown>;
}

// Subset of ioBroker.StateObject we read from
export interface IobStateObjectMinimal {
    common: {
        name?: string | { [lang: string]: string };
        type?: 'boolean' | 'number' | 'string' | 'mixed' | 'array' | 'object' | 'file';
        role?: string;
        unit?: string;
        min?: number;
        max?: number;
        read?: boolean;
        write?: boolean;
        states?: Record<string, string> | string[] | string;
    };
}

export interface MirrorEntry {
    dpId: string;
    uniqueId: string;
    domain: HaDomain;
    obj: IobStateObjectMinimal;
}
