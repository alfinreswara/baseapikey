import { randomBytes } from 'node:crypto';

import { hashSha256 } from '@baseapikey/shared';
import { z } from 'zod';

export type AccountTokenPurpose = 'email_verification' | 'password_reset';

export interface AccountTokenRecord {
  userId: string;
  purpose: AccountTokenPurpose;
  expiresAt: string;
}

export interface IssuedAccountToken {
  token: string;
  expiresAt: Date;
}

export interface IAccountTokenStore {
  issue(
    userId: string,
    purpose: AccountTokenPurpose,
    ttlSeconds: number,
  ): Promise<IssuedAccountToken>;
  consume(token: string, purpose: AccountTokenPurpose): Promise<AccountTokenRecord | null>;
}

export interface RedisAccountTokenClient {
  set(key: string, value: string, options: { EX: number }): Promise<unknown>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

const AccountTokenRecordSchema = z.object({
  userId: z.string().uuid(),
  purpose: z.enum(['email_verification', 'password_reset']),
  expiresAt: z.string().datetime({ offset: true }),
});

const CONSUME_TOKEN_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return false
end
redis.call('DEL', KEYS[1])
return value
`;

export class RedisAccountTokenStore implements IAccountTokenStore {
  constructor(private readonly redis: RedisAccountTokenClient) {}

  async issue(
    userId: string,
    purpose: AccountTokenPurpose,
    ttlSeconds: number,
  ): Promise<IssuedAccountToken> {
    assertValidTtl(ttlSeconds);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const record: AccountTokenRecord = { userId, purpose, expiresAt: expiresAt.toISOString() };

    await this.redis.set(this.getKey(token, purpose), JSON.stringify(record), { EX: ttlSeconds });
    return { token, expiresAt };
  }

  async consume(token: string, purpose: AccountTokenPurpose): Promise<AccountTokenRecord | null> {
    const value = await this.redis.eval(CONSUME_TOKEN_SCRIPT, {
      keys: [this.getKey(token, purpose)],
      arguments: [],
    });
    return parseTokenRecord(value, purpose);
  }

  private getKey(token: string, purpose: AccountTokenPurpose): string {
    return `account:token:${purpose}:${hashSha256(token)}`;
  }
}

export class InMemoryAccountTokenStore implements IAccountTokenStore {
  private readonly records = new Map<string, AccountTokenRecord>();

  async issue(
    userId: string,
    purpose: AccountTokenPurpose,
    ttlSeconds: number,
  ): Promise<IssuedAccountToken> {
    assertValidTtl(ttlSeconds);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    this.records.set(this.getKey(token, purpose), {
      userId,
      purpose,
      expiresAt: expiresAt.toISOString(),
    });
    return { token, expiresAt };
  }

  async consume(token: string, purpose: AccountTokenPurpose): Promise<AccountTokenRecord | null> {
    const key = this.getKey(token, purpose);
    const record = this.records.get(key) ?? null;
    this.records.delete(key);
    if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return record;
  }

  private getKey(token: string, purpose: AccountTokenPurpose): string {
    return `${purpose}:${hashSha256(token)}`;
  }
}

function parseTokenRecord(
  value: unknown,
  expectedPurpose: AccountTokenPurpose,
): AccountTokenRecord | null {
  if (typeof value !== 'string') return null;

  try {
    const result = AccountTokenRecordSchema.safeParse(JSON.parse(value));
    if (!result.success || result.data.purpose !== expectedPurpose) return null;
    if (new Date(result.data.expiresAt).getTime() <= Date.now()) return null;
    return result.data;
  } catch {
    return null;
  }
}

function assertValidTtl(ttlSeconds: number): void {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('Account token TTL must be a positive integer');
  }
}
