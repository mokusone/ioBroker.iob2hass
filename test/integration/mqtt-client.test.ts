import assert from 'node:assert/strict';
import net from 'node:net';
import Aedes from 'aedes';
import { MqttClient } from '../../src/lib/mqtt-client';

describe('MqttClient (against aedes)', function () {
    this.timeout(10_000);

    let broker: any;
    let server: net.Server;
    const PORT = 18831;

    beforeEach(done => {
        broker = new (Aedes as any)();
        server = net.createServer(broker.handle);
        server.listen(PORT, () => done());
    });

    afterEach(done => {
        server.close(() => broker.close(() => done()));
    });

    it('connects, publishes LWT online, and reports connected', async () => {
        const c = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test' });
        await c.connect();
        assert.equal(c.isConnected(), true);
        await c.close();
    });

    it('publishes retained messages that survive', async () => {
        const c = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test' });
        await c.connect();
        await c.publishRetained('iob2hass-test/state/x', 'hello');

        const received: Array<{ topic: string; payload: string }> = [];
        const c2 = new MqttClient({ host: '127.0.0.1', port: PORT, baseTopic: 'iob2hass-test2' });
        await c2.connect();
        c2.onMessage((topic, payload) => received.push({ topic, payload }));
        await c2.subscribe('iob2hass-test/state/+');
        await new Promise(r => setTimeout(r, 200));

        assert.equal(received.length, 1);
        assert.equal(received[0].topic, 'iob2hass-test/state/x');
        assert.equal(received[0].payload, 'hello');

        await c.close();
        await c2.close();
    });
});
