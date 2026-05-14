import assert from 'node:assert/strict';
import net from 'node:net';
import Aedes from 'aedes';
import { MqttClient } from '../../src/lib/mqtt-client';
import { collectExistingDiscoveryTopics, publishOrphanDeletions } from '../../src/lib/reconcile';

describe('reconcile', function () {
    this.timeout(10_000);
    let broker: any;
    let server: net.Server;
    const PORT = 18832;

    beforeEach(done => {
        broker = new (Aedes as any)();
        server = net.createServer(broker.handle);
        server.listen(PORT, () => done());
    });

    afterEach(done => {
        server.close(() => broker.close(() => done()));
    });

    it('detects existing retained Discovery topics under prefix', async () => {
        const c = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test' });
        await c.connect();
        await c.publishRetained(
            'homeassistant/switch/iob_a/config',
            JSON.stringify({ unique_id: 'iob_a', device: { identifiers: ['iob2hass-0'] } }),
        );
        await c.publishRetained(
            'homeassistant/sensor/foreign_x/config',
            JSON.stringify({ unique_id: 'foreign_x' }),
        );

        const found = await collectExistingDiscoveryTopics(c, 'homeassistant', 'iob2hass-0', 2000);
        assert.deepEqual(found, ['homeassistant/switch/iob_a/config']);

        await c.close();
    });

    it('orphan deletion: only deletes unknown unique_ids when flag is true', async () => {
        const c = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test' });
        await c.connect();
        await c.publishRetained(
            'homeassistant/switch/iob_a/config',
            JSON.stringify({ unique_id: 'iob_a', device: { identifiers: ['iob2hass-0'] } }),
        );
        await c.publishRetained(
            'homeassistant/sensor/iob_b/config',
            JSON.stringify({ unique_id: 'iob_b', device: { identifiers: ['iob2hass-0'] } }),
        );

        const all = await collectExistingDiscoveryTopics(c, 'homeassistant', 'iob2hass-0', 2000);
        assert.equal(all.length, 2);

        // Keep iob_a in current map. iob_b has no current topic — orphan.
        const currentByUid = new Map([['iob_a', 'homeassistant/switch/iob_a/config']]);
        const deleted = await publishOrphanDeletions(c, all, currentByUid, true);
        assert.deepEqual(deleted, ['homeassistant/sensor/iob_b/config']);

        await c.close();
    });

    it('domain conflict: deletes stale topic for same unique_id under different domain regardless of flag', async () => {
        const c = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test' });
        await c.connect();
        // Stale binary_sensor (from earlier discovery when write=false)
        await c.publishRetained(
            'homeassistant/binary_sensor/iob_a/config',
            JSON.stringify({ unique_id: 'iob_a', device: { identifiers: ['iob2hass-0'] } }),
        );
        // The current published topic is the new switch/...
        await c.publishRetained(
            'homeassistant/switch/iob_a/config',
            JSON.stringify({ unique_id: 'iob_a', device: { identifiers: ['iob2hass-0'] } }),
        );

        const all = await collectExistingDiscoveryTopics(c, 'homeassistant', 'iob2hass-0', 2000);
        assert.equal(all.length, 2);

        // Current map says iob_a is now under switch/. The binary_sensor entry
        // must be deleted even with flag=false (it's a domain conflict, not
        // an orphan).
        const currentByUid = new Map([['iob_a', 'homeassistant/switch/iob_a/config']]);
        const deleted = await publishOrphanDeletions(c, all, currentByUid, false);
        assert.deepEqual(deleted, ['homeassistant/binary_sensor/iob_a/config']);

        await c.close();
    });
});
