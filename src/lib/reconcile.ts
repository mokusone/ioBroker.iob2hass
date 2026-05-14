import type { MqttClient } from './mqtt-client';

/**
 * Subscribes to `<discoveryPrefix>/+/+/config` for a short collection window
 * and returns topic-paths whose retained payload contains our identifier.
 */
export async function collectExistingDiscoveryTopics(
    client: MqttClient,
    discoveryPrefix: string,
    selfIdentifier: string,
    windowMs: number,
): Promise<string[]> {
    const found: string[] = [];
    client.onMessage((topic, payload) => {
        if (!topic.startsWith(`${discoveryPrefix}/`)) return;
        if (!topic.endsWith('/config')) return;
        if (payload === '') return;
        try {
            const parsed = JSON.parse(payload);
            const ids = parsed?.device?.identifiers as string[] | undefined;
            if (Array.isArray(ids) && ids.includes(selfIdentifier)) {
                found.push(topic);
            }
        } catch {
            // ignore malformed configs
        }
    });
    await client.subscribe(`${discoveryPrefix}/+/+/config`);
    await new Promise(r => setTimeout(r, windowMs));
    return found;
}

/**
 * For each existing topic whose unique_id is NOT in `keepUniqueIds`,
 * publishes an empty retained payload to delete it on the HA side.
 * Returns the list of topics that were deleted.
 */
export async function publishOrphanDeletions(
    client: MqttClient,
    existingTopics: string[],
    keepUniqueIds: Set<string>,
): Promise<string[]> {
    const deleted: string[] = [];
    for (const topic of existingTopics) {
        const match = topic.match(/\/([^/]+)\/config$/);
        const uniqueId = match?.[1];
        if (uniqueId && !keepUniqueIds.has(uniqueId)) {
            await client.publishRetained(topic, '');
            deleted.push(topic);
        }
    }
    return deleted;
}
