import assert from 'node:assert/strict';

import { RateLimitError } from '@baseapikey/shared';

import { RedisLoginRateLimiter, type RedisEvalClient } from './utils/redis-login-rate-limiter';

class MockRedisClient implements RedisEvalClient {
  readonly calls: Array<{ script: string; keys: string[]; arguments: string[] }> = [];
  readonly results: unknown[] = [];

  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    this.calls.push({ script, ...options });
    return this.results.shift() ?? [1, 0];
  }
}

async function runRedisRateLimiterTests(): Promise<void> {
  console.log('🧪 Starting Redis Login Rate Limiter Tests...');

  const redis = new MockRedisClient();
  const limiter = new RedisLoginRateLimiter(redis, {
    maxAttempts: 5,
    windowMs: 60_000,
  });

  await limiter.checkRateLimit('User@Example.com', { ipAddress: '203.0.113.10' });
  assert.equal(redis.calls.length, 2);
  assert.equal(redis.calls[0]?.arguments[2], '5');
  assert.equal(redis.calls[0]?.arguments[1], '60000');
  assert.equal(redis.calls[0]?.keys[0]?.includes('user@example.com'), false);
  assert.equal(redis.calls[1]?.keys[0]?.includes('203.0.113.10'), false);
  console.log('  ✅ Email and IP limits use privacy-preserving Redis keys');

  const blockedRedis = new MockRedisClient();
  blockedRedis.results.push([0, 42]);
  const blockedLimiter = new RedisLoginRateLimiter(blockedRedis);
  await assert.rejects(
    () => blockedLimiter.checkRateLimit('blocked@example.com'),
    (error: unknown) =>
      error instanceof RateLimitError &&
      error.statusCode === 429 &&
      error.details?.['retryAfter'] === 42,
  );
  console.log('  ✅ Exceeded sliding window returns structured HTTP 429 metadata');

  assert.throws(() => new RedisLoginRateLimiter(redis, { maxAttempts: 0 }), /positive integer/);
  console.log('🎉 All Redis Login Rate Limiter Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('redis-rate-limiter.test.ts')) {
  void runRedisRateLimiterTests();
}
