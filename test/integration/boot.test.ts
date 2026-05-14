import assert from 'node:assert/strict';
import { tests } from '@iobroker/testing';

tests.integration(process.cwd(), {
    defineAdditionalTests({ suite }) {
        suite('iob2hass smoke test', getHarness => {
            it('starts without crash and writes info.connection', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.changeAdapterConfig('iob2hass', {
                    native: {
                        mqtt: {
                            host: '127.0.0.1',
                            // unreachable port — connect will fail but adapter MUST not crash
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
                await harness.startAdapterAndWait();
                // Adapter ran onReady to the point of writing info.connection (false because no broker reachable)
                const state = await harness.states.getStateAsync('iob2hass.0.info.connection');
                assert.ok(state, 'info.connection should exist');
                await harness.stopAdapter();
            });
        });
    },
});
