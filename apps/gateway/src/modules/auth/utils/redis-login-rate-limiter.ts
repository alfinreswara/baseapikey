import { createHash, randomUUID } from 'node:crypto';

import { RateLimitError } from '@baseapikey/shared';

import type { ILoginRateLimiter, LoginRateLimitContext } from './rate-limiter.interface';

export interface RedisEvalClient {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

export interface RedisLoginRateLimiterOptions {
  maxAttempts?: number;
  windowMs?: number;
  keyPrefix?: string;
}

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)

if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry_after = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
  return { 0, math.max(retry_after, 1) }
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return { 1, 0 }
`;

export class RedisLoginRateLimiter implements ILoginRateLimiter {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: RedisEvalClient,
    options: RedisLoginRateLimiterOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.keyPrefix = options.keyPrefix ?? 'baseapikey:login-rate-limit';

    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts <= 0) {
      throw new Error('Login rate-limit maxAttempts must be a positive integer');
    }
    if (!Number.isSafeInteger(this.windowMs) || this.windowMs <= 0) {
      throw new Error('Login rate-limit windowMs must be a positive integer');
    }
  }

  async checkRateLimit(identity: string, context: LoginRateLimitContext = {}): Promise<void> {
    const targets = [`email:${identity.trim().toLowerCase()}`];
    if (context.ipAddress?.trim()) {
      targets.push(`ip:${context.ipAddress.trim()}`);
    }

    for (const target of targets) {
      await this.checkTarget(target);
    }
  }

  private async checkTarget(target: string): Promise<void> {
    const now = Date.now();
    const digest = createHash('sha256').update(target).digest('hex');
    const result = await this.redis.eval(SLIDING_WINDOW_SCRIPT, {
      keys: [`${this.keyPrefix}:${digest}`],
      arguments: [
        String(now),
        String(this.windowMs),
        String(this.maxAttempts),
        `${now}:${randomUUID()}`,
      ],
    });

    if (!Array.isArray(result) || result.length < 2) {
      throw new Error('Redis returned an invalid login rate-limit response');
    }

    const allowed = Number(result[0]);
    const retryAfter = Math.max(1, Number(result[1]) || Math.ceil(this.windowMs / 1000));
    if (allowed !== 1) {
      throw new RateLimitError(retryAfter);
    }
  }
}
