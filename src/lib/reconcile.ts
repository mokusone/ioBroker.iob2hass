import type { MqttClient } from './mqtt-client';

/**
 * Subscribes to `<discoveryPrefix>/+/+/config` for a short collection window
 * and returns topic-paths whose retained payload contains our identifier.
 *
 * Critical: the MQTT client has a single message-handler slot. We must
 * save and restore the caller's handler around our collection window —
 * otherwise the caller's handler is silently overwritten and any messages
 * arriving on its subscribed topics (e.g. iob2hass/cmd/#) are dropped
 * for the entire remaining adapter lifetime.
 */
export async function collectExistingDiscoveryTopics(
    client: MqttClient,
    discoveryPrefix: string,
    selfIdentifier: string,
    windowMs: number,
): Promise<string[]> {
    const found: string[] = [];
    const previousHandler = client.getMessageHandler();

    client.onMessage((topic, payload) => {
        // First, give the caller a chance to handle the message normally
        // (e.g. cmd_topic delivery shouldn't be blocked while we collect).
        previousHandler?.(topic, payload);
        // Then collect retained discovery configs that belong to us.
        if (!topic.startsWith(`${discoveryPrefix}/`)) {
            return;
        }
        if (!topic.endsWith('/config')) {
            return;
        }
        if (payload === '') {
            return;
        }
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
    try {
        await client.subscribe(`${discoveryPrefix}/+/+/config`);
        await new Promise(r => setTimeout(r, windowMs));
    } finally {
        // Always restore — even if the subscribe or wait throws.
        client.onMessage(previousHandler ?? (() => undefined));
    }
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
