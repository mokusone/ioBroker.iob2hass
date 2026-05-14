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
 * Delete obsolete Discovery topics. Two cleanup classes:
 *
 * (1) **Domain conflict** — unique_id is in `currentTopicByUniqueId`, but
 *     the existing topic path is different (e.g. binary_sensor/<uid>/config
 *     vs. the current switch/<uid>/config after the user set write=true on
 *     the source). Always deleted; HA would otherwise show the stale
 *     entity beside the new one. Independent of `deleteUnknownUniqueIds`.
 *
 * (2) **Orphan** — unique_id has no entry in `currentTopicByUniqueId`
 *     (mirror was removed from the whitelist or DP was deleted). Only
 *     deleted when `deleteUnknownUniqueIds` is true (the autoDelete flag).
 */
export async function publishOrphanDeletions(
    client: MqttClient,
    existingTopics: string[],
    currentTopicByUniqueId: Map<string, string>,
    deleteUnknownUniqueIds: boolean,
): Promise<string[]> {
    const deleted: string[] = [];
    for (const topic of existingTopics) {
        const match = topic.match(/\/([^/]+)\/config$/);
        const uniqueId = match?.[1];
        if (!uniqueId) {
            continue;
        }
        const currentTopic = currentTopicByUniqueId.get(uniqueId);
        if (currentTopic === topic) {
            // Exact match with our active Discovery — keep.
            continue;
        }
        if (currentTopic !== undefined) {
            // Same unique_id, different topic — domain conflict. Always delete.
            await client.publishRetained(topic, '');
            deleted.push(topic);
        } else if (deleteUnknownUniqueIds) {
            // Unknown unique_id (orphan). Delete only with the flag.
            await client.publishRetained(topic, '');
            deleted.push(topic);
        }
    }
    return deleted;
}
