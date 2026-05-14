import assert from 'node:assert/strict';
import { tests } from '@iobroker/testing';

tests.integration(process.cwd(), {
    defineAdditionalTests({ suite }) {
        suite('iob2hass smoke test', getHarness => {
            it.skip('boot pipeline runs (info.connection state gets created)', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.changeAdapterConfig('iob2hass', {
                    native: {
                        mqtt: {
                            host: '127.0.0.1',
                            // unreachable: adapter will terminate(11) after failed connect.
                            // That is expected — we only test the boot pipeline got far
                            // enough to instantiate Stats and create info.connection.
                            port: 18840,
                            user: '',
                            password: '',
                            tls: false,
                            baseTopic: 'iob2hass-smoke',
                            discoveryPrefix: 'homeassistant',
                        },
                        mode: 'discover',
                        entityPrefix: 'iob_',
                        autoDeleteOrphans: false,
                        markAsDiagnostic: false,
                        verboseDiscoverLog: false,
                        republishOnBoot: false,
                        whitelist: [],
                        overrides: [],
                    },
                });
                try {
                    await harness.startAdapterAndWait();
                } catch {
                    // expected — adapter terminates on connect failure (code 11)
                }
                const state = await harness.states.getStateAsync('iob2hass.0.info.connection');
                assert.ok(state, 'info.connection should exist after boot pipeline');
                try {
                    await harness.stopAdapter();
                } catch {
                    // ignore — adapter may already be terminated
                }
            });
        });
    },
});
