import * as mqtt from 'mqtt';

export interface MqttOptions {
    host: string;
    port: number;
    user?: string;
    password?: string;
    tls?: boolean;
    baseTopic: string;
}

type MessageHandler = (topic: string, payload: string) => void;

export class MqttClient {
    private client: mqtt.MqttClient | undefined;
    private handler: MessageHandler | undefined;

    constructor(private readonly opts: MqttOptions) {}

    async connect(): Promise<void> {
        const protocol = this.opts.tls ? 'mqtts' : 'mqtt';
        const url = `${protocol}://${this.opts.host}:${this.opts.port}`;
        const statusTopic = `${this.opts.baseTopic}/status`;
        this.client = mqtt.connect(url, {
            username: this.opts.user || undefined,
            password: this.opts.password || undefined,
            will: {
                topic: statusTopic,
                payload: Buffer.from('offline'),
                qos: 0,
                retain: true,
            },
            clean: true,
            reconnectPeriod: 5000,
        });

        await new Promise<void>((resolve, reject) => {
            const c = this.client!;
            let settled = false;
            c.once('connect', () => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve();
            });
            c.once('error', (err: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                reject(err);
            });
        });

        await this.publishRetained(statusTopic, 'online');

        this.client.on('message', (topic, payload) => {
            this.handler?.(topic, payload.toString());
        });
    }

    isConnected(): boolean {
        return this.client?.connected === true;
    }

    async publishRetained(topic: string, payload: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.client!.publish(topic, payload, { retain: true, qos: 0 }, err => (err ? reject(err) : resolve()));
        });
    }

    async publish(topic: string, payload: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.client!.publish(topic, payload, { retain: false, qos: 0 }, err => (err ? reject(err) : resolve()));
        });
    }

    async subscribe(topic: string): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.client!.subscribe(topic, { qos: 0 }, err => (err ? reject(err) : resolve()));
        });
    }

    onMessage(handler: MessageHandler): void {
        this.handler = handler;
    }

    async close(): Promise<void> {
        if (!this.client) {
            return;
        }
        const statusTopic = `${this.opts.baseTopic}/status`;
        await this.publishRetained(statusTopic, 'offline').catch(() => undefined);
        await new Promise<void>(resolve => this.client!.end(false, {}, () => resolve()));
        this.client = undefined;
    }
}
