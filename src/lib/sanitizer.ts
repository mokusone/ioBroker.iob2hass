/**
 * German-umlaut transliteration so user-meaningful path segments
 * survive the [a-z0-9_] sanitizer instead of being mangled to "_".
 *   Ladegerät → Ladegeraet → ladegeraet
 *   Tür → Tuer → tuer
 *   Straße → Strasse → strasse
 */
function transliterate(s: string): string {
    return s
        .replace(/ä/g, 'ae')
        .replace(/Ä/g, 'Ae')
        .replace(/ö/g, 'oe')
        .replace(/Ö/g, 'Oe')
        .replace(/ü/g, 'ue')
        .replace(/Ü/g, 'Ue')
        .replace(/ß/g, 'ss');
}

/**
 * Sanitize an ioBroker DP-id into an HA-safe entity-id slug.
 * - transliterate German umlauts (preserves meaning)
 * - lowercase
 * - non [a-z0-9_] → "_"
 * - collapse consecutive underscores
 * - trim edge underscores
 */
export function sanitize(dpId: string): string {
    return transliterate(dpId)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

/** Combine entity prefix and sanitized DP-id into a unique HA entity id slug. */
export function buildUniqueId(dpId: string, entityPrefix: string): string {
    return `${entityPrefix}${sanitize(dpId)}`;
}

/**
 * Split a DP-id into (parent-path, last-segment) so we can group entities
 * of the same parent under a single HA device.
 *   alias.0.HN5.ENERGY.NOW.barn_power  →  parent: "alias.0.HN5.ENERGY.NOW", last: "barn_power"
 * If the DP has no parent (no dot), parent === dpId and last === ''.
 */
export function splitDpId(dpId: string): { parent: string; last: string } {
    const i = dpId.lastIndexOf('.');
    if (i <= 0) {
        return { parent: dpId, last: '' };
    }
    return { parent: dpId.slice(0, i), last: dpId.slice(i + 1) };
}
