import assert from 'node:assert/strict';

import { AuditSeverity, UserRole, UserStatus, type User } from '@baseapikey/database';

import { buildApp } from '../../app';
import { loadAuthConfig } from '../auth/auth.config';
import { JwtService } from '../auth/services/jwt.service';
import { PasswordService } from '../auth/services/password.service';
import { MockSessionRepository } from '../auth/testing/auth-test-utils';
import type { ILoginRateLimiter } from '../auth/utils/rate-limiter.interface';

import type {
  AccountAuditData,
  IAccountRepository,
  UpdateAccountProfileData,
} from './repositories/account.repository';
import type {
  AccountNotification,
  IAccountNotificationService,
} from './services/account-notification.service';
import {
  InMemoryAccountTokenStore,
  RedisAccountTokenStore,
  type RedisAccountTokenClient,
} from './services/account-token.store';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const RESET_SESSION_ID = '33333333-3333-4333-8333-333333333333';
const INITIAL_PASSWORD = 'Initial!Pass123';
const CHANGED_PASSWORD = 'Changed!Pass456';
const RESET_PASSWORD = 'ResetDone!Pass789';

class MockAccountRepository implements IAccountRepository {
  readonly audits: AccountAuditData[] = [];

  constructor(public user: User) {}

  async findById(userId: string): Promise<User | null> {
    return this.user.id === userId ? this.user : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.user.email.toLowerCase() === email.toLowerCase() ? this.user : null;
  }

  async updateProfile(userId: string, data: UpdateAccountProfileData): Promise<User> {
    assert.equal(userId, this.user.id);
    this.user = {
      ...this.user,
      ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
      ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
      updatedAt: new Date(),
    };
    return this.user;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<User> {
    assert.equal(userId, this.user.id);
    this.user = { ...this.user, passwordHash, updatedAt: new Date() };
    return this.user;
  }

  async markEmailVerified(userId: string): Promise<User> {
    assert.equal(userId, this.user.id);
    this.user = { ...this.user, emailVerified: true, updatedAt: new Date() };
    return this.user;
  }

  async recordAudit(data: AccountAuditData): Promise<void> {
    this.audits.push(data);
  }
}

class MockNotificationService implements IAccountNotificationService {
  readonly notifications: AccountNotification[] = [];
  shouldFail = false;

  async send(notification: AccountNotification): Promise<void> {
    if (this.shouldFail) throw new Error('mailer unavailable');
    this.notifications.push(notification);
  }
}

class MockRateLimiter implements ILoginRateLimiter {
  readonly keys: string[] = [];

  async checkRateLimit(key: string): Promise<void> {
    this.keys.push(key);
  }
}

class MockRedisTokenClient implements RedisAccountTokenClient {
  readonly values = new Map<string, string>();
  lastKey = '';
  lastValue = '';
  lastTtl = 0;

  async set(key: string, value: string, options: { EX: number }): Promise<unknown> {
    this.lastKey = key;
    this.lastValue = value;
    this.lastTtl = options.EX;
    this.values.set(key, value);
    return 'OK';
  }

  async eval(_script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    const key = options.keys[0]!;
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }
}

async function createUser(passwordService: PasswordService): Promise<User> {
  const now = new Date('2026-09-19T00:00:00.000Z');
  return {
    id: USER_ID,
    email: 'person@example.com',
    username: 'person',
    fullName: 'Original Person',
    passwordHash: await passwordService.hash(INITIAL_PASSWORD),
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    emailVerified: false,
    avatarUrl: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

async function runAccountTests(): Promise<void> {
  console.log('🧪 Starting Account API Tests...');

  const passwordService = new PasswordService();
  const accountRepository = new MockAccountRepository(await createUser(passwordService));
  const sessionRepository = new MockSessionRepository();
  const notificationService = new MockNotificationService();
  const tokenStore = new InMemoryAccountTokenStore();
  const rateLimiter = new MockRateLimiter();
  const jwtService = new JwtService(loadAuthConfig());
  const app = buildApp({
    accountRepository,
    accountTokenStore: tokenStore,
    accountNotificationService: notificationService,
    sessionRepository,
    passwordService,
    jwtService,
    rateLimiter,
  });
  await app.ready();

  const accessToken = jwtService.generateAccessToken({
    userId: USER_ID,
    email: accountRepository.user.email,
    role: UserRole.USER,
  });
  const authHeaders = { authorization: `Bearer ${accessToken}` };

  try {
    const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/me' });
    assert.equal(unauthorized.statusCode, 401);

    const profile = await app.inject({ method: 'GET', url: '/api/v1/me', headers: authHeaders });
    assert.equal(profile.statusCode, 200);
    assert.equal(profile.headers['cache-control'], 'private, no-store');
    const profileBody = profile.json<{ data: Record<string, unknown> }>();
    assert.equal(profileBody.data['id'], USER_ID);
    assert.equal(profileBody.data['email'], 'person@example.com');
    assert.equal('password' in profileBody.data, false);
    assert.equal('passwordHash' in profileBody.data, false);

    const overrideAttempt = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: authHeaders,
      payload: { fullName: 'Wrong Target', userId: '99999999-9999-4999-8999-999999999999' },
    });
    assert.equal(overrideAttempt.statusCode, 400);

    const unsafeAvatar = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: authHeaders,
      payload: { avatarUrl: 'javascript:alert(1)' },
    });
    assert.equal(unsafeAvatar.statusCode, 400);

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me',
      headers: authHeaders,
      payload: { fullName: 'Updated Person', avatarUrl: 'https://cdn.example.com/avatar.png' },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(accountRepository.user.fullName, 'Updated Person');
    assert.equal(accountRepository.user.avatarUrl, 'https://cdn.example.com/avatar.png');
    assert.equal(accountRepository.audits.at(-1)?.action, 'ACCOUNT_PROFILE_UPDATE');
    console.log('  ✅ Profile read/update is JWT-scoped, validated, audited, and password-safe');

    const wrongPassword = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/password',
      headers: authHeaders,
      payload: { currentPassword: 'DefinitelyWrong!123', newPassword: CHANGED_PASSWORD },
    });
    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(accountRepository.audits.at(-1)?.severity, AuditSeverity.WARNING);

    await sessionRepository.createSession({
      id: SESSION_ID,
      userId: USER_ID,
      refreshTokenHash: 'change-session-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const sessionToken = jwtService.generateAccessToken({
      userId: USER_ID,
      email: accountRepository.user.email,
      role: UserRole.USER,
      sessionId: SESSION_ID,
    });
    const changed = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/password',
      headers: { authorization: `Bearer ${sessionToken}` },
      payload: { currentPassword: INITIAL_PASSWORD, newPassword: CHANGED_PASSWORD },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(
      await passwordService.verify(CHANGED_PASSWORD, accountRepository.user.passwordHash),
      true,
    );
    assert.equal((await sessionRepository.findSessionById(SESSION_ID))?.isRevoked, true);
    console.log('  ✅ Password change verifies the old secret and revokes every active session');

    const verificationRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/me/email-verification/request',
      headers: authHeaders,
    });
    assert.equal(verificationRequest.statusCode, 202);
    const verificationToken = notificationService.notifications.at(-1)?.token;
    assert.ok(verificationToken);

    const verified = await app.inject({
      method: 'POST',
      url: '/api/v1/account/email-verification/confirm',
      payload: { token: verificationToken },
    });
    assert.equal(verified.statusCode, 200);
    assert.equal(accountRepository.user.emailVerified, true);

    const verificationReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/account/email-verification/confirm',
      payload: { token: verificationToken },
    });
    assert.equal(verificationReplay.statusCode, 400);
    console.log('  ✅ Email-verification tokens are delivered, consumed once, and audited');

    const unknownReset = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password-reset/request',
      payload: { email: 'missing@example.com' },
    });
    const knownReset = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password-reset/request',
      payload: { email: 'PERSON@example.com' },
    });
    assert.equal(unknownReset.statusCode, 202);
    assert.equal(knownReset.statusCode, 202);
    assert.deepEqual(unknownReset.json(), knownReset.json());
    assert.deepEqual(rateLimiter.keys, [
      'password-reset:missing@example.com',
      'password-reset:person@example.com',
    ]);

    const resetNotification = notificationService.notifications.find(
      (notification) => notification.purpose === 'password_reset',
    );
    assert.ok(resetNotification);

    notificationService.shouldFail = true;
    const deliveryFailure = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password-reset/request',
      payload: { email: accountRepository.user.email },
    });
    assert.equal(deliveryFailure.statusCode, 202);
    assert.deepEqual(deliveryFailure.json(), knownReset.json());
    notificationService.shouldFail = false;

    await sessionRepository.createSession({
      id: RESET_SESSION_ID,
      userId: USER_ID,
      refreshTokenHash: 'reset-session-hash',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password-reset/confirm',
      payload: { token: resetNotification.token, newPassword: RESET_PASSWORD },
    });
    assert.equal(reset.statusCode, 200);
    assert.equal(
      await passwordService.verify(RESET_PASSWORD, accountRepository.user.passwordHash),
      true,
    );
    assert.equal((await sessionRepository.findSessionById(RESET_SESSION_ID))?.isRevoked, true);

    const resetReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password-reset/confirm',
      payload: { token: resetNotification.token, newPassword: 'Another!Pass012' },
    });
    assert.equal(resetReplay.statusCode, 400);

    const weakPassword = await app.inject({
      method: 'POST',
      url: '/api/v1/account/password-reset/confirm',
      payload: { token: 'x'.repeat(43), newPassword: 'weak' },
    });
    assert.equal(weakPassword.statusCode, 400);
    console.log(
      '  ✅ Password reset is enumeration-safe, rate-limited, one-time, and revokes sessions',
    );

    const guestToken = jwtService.generateAccessToken({
      userId: USER_ID,
      email: accountRepository.user.email,
      role: 'GUEST',
    });
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: { authorization: `Bearer ${guestToken}` },
    });
    assert.equal(forbidden.statusCode, 403);
    console.log('  ✅ Account profile routes enforce profile RBAC permissions');
  } finally {
    await app.close();
  }

  const redis = new MockRedisTokenClient();
  const redisTokenStore = new RedisAccountTokenStore(redis);
  const issued = await redisTokenStore.issue(USER_ID, 'password_reset', 900);
  assert.equal(redis.lastTtl, 900);
  assert.equal(redis.lastKey.includes(issued.token), false);
  assert.equal(redis.lastValue.includes(issued.token), false);
  assert.match(redis.lastKey, /^account:token:password_reset:[a-f0-9]{64}$/);
  assert.equal((await redisTokenStore.consume(issued.token, 'password_reset'))?.userId, USER_ID);
  assert.equal(await redisTokenStore.consume(issued.token, 'password_reset'), null);
  console.log('  ✅ Redis stores only token digests and consumes records atomically once');

  console.log('🎉 All Account API Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('account.test.ts')) {
  void runAccountTests();
}
