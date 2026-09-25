import type { CreateUsageRecordDto } from '../dto/usage.dto';

import type { IUsageRecorder } from './usage-recorder';
import type { UsageTrackingService } from './usage-tracking.service';

export interface RedisUsageQueueClient {
  lPush(key: string, element: string): Promise<number>;
  rPop(key: string, count: number): Promise<string | string[] | null>;
}

interface UsageEnvelope {
  attempt: number;
  payload: CreateUsageRecordDto;
}

export class RedisUsageRecorder implements IUsageRecorder {
  constructor(
    private readonly client: Pick<RedisUsageQueueClient, 'lPush'>,
    private readonly queueKey = 'baseapikey:usage:queue',
  ) {}

  record(dto: CreateUsageRecordDto): void {
    const envelope: UsageEnvelope = { attempt: 0, payload: dto };
    void this.client.lPush(this.queueKey, JSON.stringify(envelope)).catch(() => {
      // The response path must remain independent from telemetry availability.
    });
  }
}

export class RedisUsageWorker {
  private timer: NodeJS.Timeout | undefined;
  private processing = false;

  constructor(
    private readonly client: RedisUsageQueueClient,
    private readonly trackingService: UsageTrackingService,
    private readonly batchSize = 50,
    private readonly intervalMs = 250,
    private readonly queueKey = 'baseapikey:usage:queue',
    private readonly deadLetterKey = 'baseapikey:usage:dead-letter',
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.processBatch(), this.intervalMs);
    this.timer.unref();
    void this.processBatch();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    while (this.processing) await new Promise((resolve) => setTimeout(resolve, 10));
    while ((await this.processBatch()) > 0) {
      // Drain every queued item before Redis is closed.
    }
  }

  async processBatch(): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;
    let processed = 0;
    try {
      const raw = await this.client.rPop(this.queueKey, this.batchSize);
      const items = raw === null ? [] : Array.isArray(raw) ? raw : [raw];
      for (const item of items) {
        processed += 1;
        let envelope: UsageEnvelope;
        try {
          envelope = JSON.parse(item) as UsageEnvelope;
          await this.trackingService.recordUsage(envelope.payload);
        } catch {
          const fallback = this.parseEnvelope(item);
          fallback.attempt += 1;
          await this.client.lPush(
            fallback.attempt >= 3 ? this.deadLetterKey : this.queueKey,
            JSON.stringify(fallback),
          );
        }
      }
    } finally {
      this.processing = false;
    }
    return processed;
  }

  private parseEnvelope(value: string): UsageEnvelope {
    try {
      return JSON.parse(value) as UsageEnvelope;
    } catch {
      return { attempt: 3, payload: {} as CreateUsageRecordDto };
    }
  }
}
