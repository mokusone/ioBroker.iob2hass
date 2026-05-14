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

    it('publishes empty retained payload for orphans only', async () => {
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

        const deleted = await publishOrphanDeletions(c, all, new Set(['iob_a']));
        assert.deepEqual(deleted, ['homeassistant/sensor/iob_b/config']);

        await c.close();
    });
});
