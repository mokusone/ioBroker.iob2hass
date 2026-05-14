/**
 * Sanitize an ioBroker DP-id into an HA-safe entity-id slug.
 * - lowercase
 * - non [a-z0-9_] → "_"
 * - collapse consecutive underscores
 * - trim edge underscores
 */
export function sanitize(dpId: string): string {
    return dpId
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
}

/** Combine entity prefix and sanitized DP-id into a unique HA entity id slug. */
export function buildUniqueId(dpId: string, entityPrefix: string): string {
    return `${entityPrefix}${sanitize(dpId)}`;
}
