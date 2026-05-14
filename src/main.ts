import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
import { normalizeConfig } from './lib/config';
import { MqttClient } from './lib/mqtt-client';
import { CommandRouter } from './lib/command-router';
import { Stats } from './lib/stats';
import { buildConfig } from './lib/discovery';
import { buildUniqueId } from './lib/sanitizer';
import { isOwnWrite, buildSelfId } from './lib/loop-guard';
import { collectExistingDiscoveryTopics, publishOrphanDeletions } from './lib/reconcile';
import type { RuntimeConfig, IobStateObjectMinimal, MirrorEntry } from './types';

class Iob2HassAdapter extends Adapter {
    private runtime!: RuntimeConfig;
    private mqtt!: MqttClient;
    private cmd!: CommandRouter;
    private statsTracker!: Stats;
    private mirrors = new Map<string, MirrorEntry>();
    private selfId!: string;
    private heartbeatTimer: NodeJS.Timeout | undefined;

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({ ...options, name: 'iob2hass' });
        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
    }

    private get instanceNum(): number {
        return this.instance ?? 0;
    }

    private async onReady(): Promise<void> {
        this.selfId = buildSelfId(this.instanceNum);
        try {
            this.runtime = normalizeConfig(this.config);
        } catch (e) {
            this.log.error(`Config error: ${(e as Error).message}`);
            return;
        }
        this.statsTracker = new Stats(this);
        await this.statsTracker.reset();

        this.mqtt = new MqttClient({
            host: this.runtime.mqtt.host,
            port: this.runtime.mqtt.port,
            user: this.runtime.mqtt.user || undefined,
            password: this.runtime.mqtt.password || undefined,
            tls: this.runtime.mqtt.tls,
            baseTopic: this.runtime.mqtt.baseTopic,
        });

        // Periodic heartbeat — runs regardless of MQTT state, so the user can
        // see in the admin that the adapter process is alive.
        this.heartbeatTimer = setInterval(() => {
            void this.statsTracker.heartbeat();
        }, 30_000);
        await this.statsTracker.heartbeat();

        try {
            await this.mqtt.connect();
            await this.statsTracker.setConnection(true);
        } catch (e) {
            this.log.error(`MQTT connect failed: ${(e as Error).message}`);
            await this.statsTracker.setConnection(false);
            // Terminate so js-controller restarts us with backoff. Without this
            // the adapter would hang silently after the first failure.
            this.terminate
                ? this.terminate('MQTT connect failed', 11 /* START_IMMEDIATELY_AFTER_STOP */)
                : process.exit(11);
            return;
        }

        this.cmd = new CommandRouter(this, this.runtime.mqtt.baseTopic);
        this.mqtt.onMessage((topic, payload) => {
            void this.onMqttMessage(topic, payload);
        });

        await this.buildAndPublishMirrors();

        if (this.runtime.autoDeleteOrphans && this.runtime.whitelist.length > 0) {
            const keep = new Set(Array.from(this.mirrors.values()).map(m => m.uniqueId));
            const selfIdentifier = `iob2hass-${this.instanceNum}`;
            const existing = await collectExistingDiscoveryTopics(
                this.mqtt,
                this.runtime.mqtt.discoveryPrefix,
                selfIdentifier,
                2000,
            );
            const deleted = await publishOrphanDeletions(this.mqtt, existing, keep);
            if (deleted.length > 0) {
                this.log.info(`Deleted ${deleted.length} orphan Discovery topics`);
            }
        }

        for (const w of this.runtime.whitelist) {
            if (!w.active) {
                continue;
            }
            await this.subscribeForeignStatesAsync(w.pattern);
            await this.statsTracker.incr('subscribed');
        }

        await this.mqtt.subscribe(`${this.runtime.mqtt.baseTopic}/cmd/#`);
        await this.mqtt.subscribe(`${this.runtime.mqtt.discoveryPrefix}/status`);
        await this.subscribeStatesAsync('cmd.cleanup');

        await this.statsTracker.heartbeat();
        this.log.info(`Adapter ready, mode=${this.runtime.mode}, mirrors=${this.mirrors.size}`);
    }

    private async buildAndPublishMirrors(): Promise<void> {
        this.mirrors.clear();
        this.cmd.clear();
        const allKeep = new Set<string>();
        for (const w of this.runtime.whitelist) {
            if (!w.active) {
                continue;
            }
            const objects = await this.getForeignObjectsAsync(w.pattern, 'state');
            for (const [dpId, obj] of Object.entries(objects ?? {})) {
                if (!obj) {
                    continue;
                }
                const minimal: IobStateObjectMinimal = { common: (obj as any).common ?? {} };
                const uniqueId = buildUniqueId(dpId, this.runtime.entityPrefix);
                if (allKeep.has(uniqueId)) {
                    continue;
                }
                const dc = buildConfig(dpId, minimal, this.runtime, this.instanceNum);
                const entry: MirrorEntry = { dpId, uniqueId, domain: dc.domain, obj: minimal };
                this.mirrors.set(uniqueId, entry);
                allKeep.add(uniqueId);
                this.cmd.registerMirror(uniqueId, dpId, minimal);

                if (this.runtime.mode === 'live') {
                    const topic = `${this.runtime.mqtt.discoveryPrefix}/${dc.domain}/${uniqueId}/config`;
                    await this.mqtt.publishRetained(topic, JSON.stringify(dc.payload));
                } else if (this.runtime.mode === 'dry-run') {
                    this.log.info(`[dry-run] would publish ${dc.domain}/${uniqueId}: ${JSON.stringify(dc.payload)}`);
                }
            }
        }

        if (this.runtime.mode === 'live' && this.runtime.republishOnBoot) {
            await this.republishAllStates();
        }
    }

    private async republishAllStates(): Promise<void> {
        for (const m of this.mirrors.values()) {
            const st = await this.getForeignStateAsync(m.dpId);
            if (st?.val !== undefined && st?.val !== null) {
                await this.publishMirrorState(m, st.val);
            }
        }
    }

    private async publishMirrorState(m: MirrorEntry, val: unknown): Promise<void> {
        const topic = `${this.runtime.mqtt.baseTopic}/state/${m.uniqueId}`;
        const payload = typeof val === 'string' ? val : JSON.stringify(val);
        await this.mqtt.publish(topic, payload);
        await this.statsTracker.incr('published');
    }

    private async onMqttMessage(topic: string, payload: string): Promise<void> {
        if (topic === `${this.runtime.mqtt.discoveryPrefix}/status`) {
            if (payload === 'online') {
                this.log.info('HA birth message received → republishing all states');
                await this.republishAllStates();
            }
            return;
        }
        if (topic.startsWith(`${this.runtime.mqtt.baseTopic}/cmd/`)) {
            await this.cmd.handleMessage(topic, payload);
            return;
        }
    }

    private async onStateChange(id: string, state: ioBroker.State | null | undefined): Promise<void> {
        if (!state) {
            return;
        }

        if (id === `${this.namespace}.cmd.cleanup` && state.val === true && state.ack === false) {
            await this.cleanupAllDiscoveryTopics();
            await this.setStateAsync('cmd.cleanup', false, true);
            return;
        }

        if (isOwnWrite(state, this.selfId)) {
            return;
        }
        const uniqueId = buildUniqueId(id, this.runtime.entityPrefix);
        const m = this.mirrors.get(uniqueId);
        if (!m) {
            if (this.runtime.mode === 'discover') {
                await this.statsTracker.incr('unmapped');
                if (this.runtime.verboseDiscoverLog) {
                    this.log.info(`[discover] unmapped: ${id}`);
                }
            }
            return;
        }
        if (this.runtime.mode !== 'live') {
            return;
        }
        await this.publishMirrorState(m, state.val);
    }

    private async cleanupAllDiscoveryTopics(): Promise<void> {
        const selfIdentifier = `iob2hass-${this.instanceNum}`;
        const existing = await collectExistingDiscoveryTopics(
            this.mqtt,
            this.runtime.mqtt.discoveryPrefix,
            selfIdentifier,
            2000,
        );
        for (const topic of existing) {
            await this.mqtt.publishRetained(topic, '');
        }
        this.log.info(`Cleaned up ${existing.length} Discovery topics`);
    }

    private async onUnload(callback: () => void): Promise<void> {
        try {
            if (this.heartbeatTimer) {
                clearInterval(this.heartbeatTimer);
                this.heartbeatTimer = undefined;
            }
            await this.mqtt?.close();
            await this.statsTracker?.setConnection(false);
        } catch {
            // ignore
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = (options: Partial<AdapterOptions> | undefined) => new Iob2HassAdapter(options);
} else {
    new Iob2HassAdapter();
}
