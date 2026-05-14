type StatKey = 'subscribed' | 'published' | 'unmapped' | 'errors';

interface AdapterLike {
    setStateAsync(id: string, value: any, ack: boolean): Promise<unknown>;
}

export class Stats {
    private counters: Record<StatKey, number> = {
        subscribed: 0,
        published: 0,
        unmapped: 0,
        errors: 0,
    };

    constructor(private readonly adapter: AdapterLike) {}

    async reset(): Promise<void> {
        this.counters = { subscribed: 0, published: 0, unmapped: 0, errors: 0 };
        await Promise.all(
            (Object.keys(this.counters) as StatKey[]).map(k => this.adapter.setStateAsync(`stats.${k}`, 0, true)),
        );
    }

    async incr(key: StatKey, by = 1): Promise<void> {
        this.counters[key] += by;
        await this.adapter.setStateAsync(`stats.${key}`, this.counters[key], true);
    }

    async setConnection(connected: boolean): Promise<void> {
        await this.adapter.setStateAsync('info.connection', connected, true);
    }

    async heartbeat(): Promise<void> {
        await this.adapter.setStateAsync('info.heartbeat', Date.now(), true);
    }
}
