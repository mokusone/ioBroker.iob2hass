interface StateLike {
    from?: string;
}

/**
 * Returns true if the state event originates from our own adapter instance.
 * Such echoes from our own writes must be dropped to prevent loops.
 */
export function isOwnWrite(state: StateLike | null | undefined, selfId: string): boolean {
    return !!state && state.from === selfId;
}

/** Convenience: build the canonical self-id from instance number. */
export function buildSelfId(instance: number): string {
    return `system.adapter.iob2hass.${instance}`;
}
