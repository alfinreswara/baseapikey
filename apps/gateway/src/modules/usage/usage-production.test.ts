import assert from 'node:assert/strict';

import type { CreateUsageRecordDto } from './dto/usage.dto';
import {
  RedisUsageRecorder,
  RedisUsageWorker,
  type RedisUsageQueueClient,
} from './services/redis-usage-queue';
import { calculateTokenCost } from './services/usage-cost.service';

class FakeRedisQueue implements RedisUsageQueueClient {
  readonly lists = new Map<string, string[]>();

  async lPush(key: string, element: string): Promise<number> {
    const list = this.lists.get(key) ?? [];
    list.unshift(element);
    this.lists.set(key, list);
    return list.length;
  }

  async rPop(key: string, count: number): Promise<string[] | null> {
    const list = this.lists.get(key) ?? [];
    if (list.length === 0) return null;
    const result: string[] = [];
    while (result.length < count && list.length > 0) result.push(list.pop()!);
    return result;
  }
}

function usage(requestId: string): CreateUsageRecordDto {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    apiKeyId: '22222222-2222-4222-8222-222222222222',
    organizationId: '33333333-3333-4333-8333-333333333333',
    provider: 'provider',
    model: 'model',
    endpoint: '/v1/chat/completions',
    method: 'POST',
    requestId,
    promptTokens: 1_000,
    completionTokens: 500,
    totalTokens: 1_500,
    estimatedCost: 0.002,
    latencyMs: 100,
    statusCode: 200,
  };
}

async function run(): Promise<void> {
  assert.equal(calculateTokenCost(1_000_000, 500_000, 2, 8), 6);

  const queue = new FakeRedisQueue();
  const processed: string[] = [];
  const tracker = {
    recordUsage: async (payload: CreateUsageRecordDto) => {
      processed.push(payload.requestId);
      return {} as never;
    },
  };
  const recorder = new RedisUsageRecorder(queue);
  recorder.record(usage('first'));
  recorder.record(usage('second'));
  await new Promise((resolve) => setImmediate(resolve));

  const worker = new RedisUsageWorker(queue, tracker as never, 10, 60_000);
  await worker.processBatch();
  assert.deepEqual(processed, ['first', 'second']);
  assert.equal(queue.lists.get('baseapikey:usage:queue')?.length, 0);
  console.log('✅ Production usage cost and durable queue tests passed');
}

void run();
