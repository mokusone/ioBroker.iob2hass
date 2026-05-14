import assert from 'node:assert/strict';
import { CommandRouter } from '../../src/lib/command-router';

function fakeAdapter() {
    const writes: Array<{ id: string; value: unknown; ack: boolean }> = [];
    return {
        writes,
        setForeignStateAsync: async (id: string, value: unknown, ack: boolean) => {
            writes.push({ id, value, ack });
        },
        log: { warn: () => undefined, error: () => undefined, debug: () => undefined },
    };
}

describe('CommandRouter', () => {
    it('routes command to setForeignStateAsync with ack=false for writable DP', async () => {
        const a = fakeAdapter();
        const r = new CommandRouter(a as any, 'iob2hass');
        r.registerMirror('iob_shelly_0_relay0', 'shelly.0.Relay0', { common: { type: 'boolean', write: true } });

        await r.handleMessage('iob2hass/cmd/iob_shelly_0_relay0', 'true');

        assert.equal(a.writes.length, 1);
        assert.equal(a.writes[0].id, 'shelly.0.Relay0');
        assert.equal(a.writes[0].value, true);
        assert.equal(a.writes[0].ack, false);
    });

    it('parses numeric payload as number', async () => {
        const a = fakeAdapter();
        const r = new CommandRouter(a as any, 'iob2hass');
        r.registerMirror('iob_x_y', 'x.y', { common: { type: 'number', write: true } });

        await r.handleMessage('iob2hass/cmd/iob_x_y', '42.5');
        assert.equal(a.writes[0].value, 42.5);
    });

    it('blocks writes to read-only DPs', async () => {
        const a = fakeAdapter();
        const r = new CommandRouter(a as any, 'iob2hass');
        r.registerMirror('iob_x_y', 'x.y', { common: { type: 'boolean', write: false } });

        const before = a.writes.length;
        await r.handleMessage('iob2hass/cmd/iob_x_y', 'true');
        assert.equal(a.writes.length, before);
    });

    it('ignores unknown unique_id', async () => {
        const a = fakeAdapter();
        const r = new CommandRouter(a as any, 'iob2hass');
        await r.handleMessage('iob2hass/cmd/nonexistent', 'true');
        assert.equal(a.writes.length, 0);
    });
});
