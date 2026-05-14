import type { IobStateObjectMinimal } from '../types';

interface AdapterLike {
    setForeignStateAsync(id: string, value: any, ack: boolean): Promise<unknown>;
    log: { warn(msg: string): void; error(msg: string): void; debug(msg: string): void };
}

interface MirrorRef {
    dpId: string;
    obj: IobStateObjectMinimal;
}

export class CommandRouter {
    private readonly mirrors = new Map<string, MirrorRef>();

    constructor(
        private readonly adapter: AdapterLike,
        private readonly baseTopic: string,
    ) {}

    registerMirror(uniqueId: string, dpId: string, obj: IobStateObjectMinimal): void {
        this.mirrors.set(uniqueId, { dpId, obj });
    }

    clear(): void {
        this.mirrors.clear();
    }

    async handleMessage(topic: string, payload: string): Promise<void> {
        const prefix = `${this.baseTopic}/cmd/`;
        if (!topic.startsWith(prefix)) return;
        const uniqueId = topic.slice(prefix.length).split('/')[0];
        const ref = this.mirrors.get(uniqueId);
        if (!ref) {
            this.adapter.log.debug(`Unknown command topic: ${topic}`);
            return;
        }
        if (ref.obj.common.write !== true) {
            this.adapter.log.warn(`Refusing write to read-only DP ${ref.dpId}`);
            return;
        }
        const value = parsePayload(payload, ref.obj.common.type);
        try {
            await this.adapter.setForeignStateAsync(ref.dpId, value, false);
        } catch (e) {
            this.adapter.log.error(`setForeignStateAsync(${ref.dpId}) failed: ${(e as Error).message}`);
        }
    }
}

function parsePayload(raw: string, type: string | undefined): unknown {
    if (type === 'boolean') {
        if (raw === 'true' || raw === '1' || raw === 'ON') return true;
        if (raw === 'false' || raw === '0' || raw === 'OFF') return false;
        return raw;
    }
    if (type === 'number') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : raw;
    }
    return raw;
}
