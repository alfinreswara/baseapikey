import { UserRole, UserStatus } from '@baseapikey/database';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { buildApp } from '../../app';

import { loadAuthConfig } from './auth.config';
import { authenticate, getRequestUser, requireAuth } from './middleware/auth.middleware';
import type {
  CreateSessionData,
  ISessionRepository,
  UpdateSessionData,
} from './repositories/session.repository';
import type { CreateUserData, IUserRepository } from './repositories/user.repository';
import { JwtService } from './services/jwt.service';
import type { UserSession } from './types/session.types';

process.env['DATABASE_URL'] =
  process.env['DATABASE_URL'] || 'postgresql://postgres:postgres@localhost:5432/baseapikey';
process.env['REDIS_URL'] = process.env['REDIS_URL'] || 'redis://localhost:6379';
process.env['NINE_ROUTER_API_KEY'] = process.env['NINE_ROUTER_API_KEY'] || 'test-nine-router-key';
process.env['JWT_ACCESS_SECRET'] =
  process.env['JWT_ACCESS_SECRET'] || 'test-jwt-access-secret-minimum-32-chars-long';
process.env['JWT_REFRESH_SECRET'] =
  process.env['JWT_REFRESH_SECRET'] || 'test-jwt-refresh-secret-minimum-32-chars-long';
process.env['JWT_ACCESS_EXPIRES_IN'] = process.env['JWT_ACCESS_EXPIRES_IN'] || '15m';
process.env['JWT_REFRESH_EXPIRES_IN'] = process.env['JWT_REFRESH_EXPIRES_IN'] || '7d';

class MockUserRepository implements IUserRepository {
  public users: Array<{
    id: string;
    email: string;
    username: string;
    fullName: string;
    passwordHash: string;
    role: UserRole;
    status: UserStatus;
    emailVerified: boolean;
    avatarUrl: string | null;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = [];

  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async findByEmail(email: string) {
    return this.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findByUsername(username: string) {
    return this.users.find((u) => u.username.toLowerCase() === username.toLowerCase()) ?? null;
  }

  async create(data: CreateUserData) {
    const user = {
      id: `usr_${Math.random().toString(36).slice(2, 9)}`,
      email: data.email,
      username: data.username,
      fullName: data.fullName,
      passwordHash: data.passwordHash,
      role: data.role ?? UserRole.USER,
      status: data.status ?? UserStatus.ACTIVE,
      emailVerified: data.emailVerified ?? false,
      avatarUrl: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    this.users.push(user);
    return user;
  }

  async updateLastLogin(userId: string, lastLoginAt: Date) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) throw new Error('User not found');
    user.lastLoginAt = lastLoginAt;
    user.updatedAt = new Date();
    return user;
  }

  async recordAuditLog() {}
}

class MockSessionRepository implements ISessionRepository {
  public sessions: Map<string, UserSession> = new Map();

  async createSession(data: CreateSessionData): Promise<UserSession> {
    const session: UserSession = {
      id: data.id ?? `sess_${Math.random().toString(36).slice(2, 11)}`,
      userId: data.userId,
      refreshTokenHash: data.refreshTokenHash,
      deviceId: data.deviceId ?? null,
      deviceName: data.deviceName ?? null,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
      expiresAt: data.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      isRevoked: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async findSessionById(id: string) {
    return this.sessions.get(id) ?? null;
  }

  async findSessionByTokenHash(tokenHash: string) {
    for (const s of this.sessions.values()) {
      if (s.refreshTokenHash === tokenHash) return s;
    }
    return null;
  }

  async findActiveSessionsByUserId(userId: string): Promise<UserSession[]> {
    const now = new Date();
    const results: UserSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.isRevoked && session.expiresAt > now) {
        results.push(session);
      }
    }
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results;
  }

  async updateSession(id: string, data: UpdateSessionData): Promise<UserSession> {
    const s = this.sessions.get(id);
    if (!s) throw new Error('Session not found');
    if (data.refreshTokenHash !== undefined) s.refreshTokenHash = data.refreshTokenHash;
    if (data.lastUsedAt !== undefined) s.lastUsedAt = data.lastUsedAt;
    s.updatedAt = new Date();
    return s;
  }

  async revokeSession(id: string) {
    const s = this.sessions.get(id);
    if (s) {
      s.isRevoked = true;
      s.revokedAt = new Date();
      s.updatedAt = new Date();
    }
  }

  async revokeAllUserSessions(userId: string) {
    for (const s of this.sessions.values()) {
      if (s.userId === userId) {
        s.isRevoked = true;
        s.revokedAt = new Date();
        s.updatedAt = new Date();
      }
    }
  }
}

async function runMiddlewareTests() {
  console.log('🧪 Starting Authentication Middleware & Route Protection Tests...');

  const authConfig = loadAuthConfig();
  const jwtService = new JwtService(authConfig);
  const userRepo = new MockUserRepository();
  const sessionRepo = new MockSessionRepository();

  const testUser = await userRepo.create({
    email: 'auth.middleware@example.com',
    username: 'authmiduser',
    fullName: 'Auth Middleware User',
    passwordHash: 'dummyhash',
  });

  const sessionId = 'sess_mid_1';
  const tokenPair = jwtService.generateTokenPair({
    userId: testUser.id,
    email: testUser.email,
    role: testUser.role,
    sessionId,
  });

  await sessionRepo.createSession({
    id: sessionId,
    userId: testUser.id,
    refreshTokenHash: 'hash',
    expiresAt: new Date(Date.now() + 100000),
  });

  const app = buildApp({
    userRepository: userRepo,
    sessionRepository: sessionRepo,
  });

  // Test 1: Public route accessible without token
  const healthRes = await app.inject({
    method: 'GET',
    url: '/health',
  });
  if (healthRes.statusCode !== 200) {
    throw new Error(`Expected HTTP 200 for public route /health, got ${healthRes.statusCode}`);
  }
  console.log('  ✅ Public route accessible without token passed');

  // Test 2: Valid token allows request to protected GET /v1/auth/me
  const meRes = await app.inject({
    method: 'GET',
    url: '/v1/auth/me',
    headers: {
      authorization: `Bearer ${tokenPair.accessToken}`,
    },
  });

  if (meRes.statusCode !== 200) {
    throw new Error(`Expected HTTP 200 for valid token, got ${meRes.statusCode}`);
  }
  const meData = JSON.parse(meRes.payload);
  if (meData.data.id !== testUser.id || meData.data.email !== testUser.email) {
    throw new Error('Authenticated user context mismatch in GET /v1/auth/me');
  }
  console.log('  ✅ Valid token allowed request & attached request context passed');

  // Test 3: Missing Authorization header returns 401
  const missingRes = await app.inject({
    method: 'GET',
    url: '/v1/auth/me',
  });
  if (missingRes.statusCode !== 401) {
    throw new Error(`Expected HTTP 401 for missing token, got ${missingRes.statusCode}`);
  }
  console.log('  ✅ Missing Authorization header rejected with 401 passed');

  // Test 4: Malformed Authorization header format
  const malformedRes = await app.inject({
    method: 'GET',
    url: '/v1/auth/me',
    headers: {
      authorization: 'Basic dXNlcjpwYXNz',
    },
  });
  if (malformedRes.statusCode !== 401) {
    throw new Error(
      `Expected HTTP 401 for malformed Authorization format, got ${malformedRes.statusCode}`,
    );
  }
  console.log('  ✅ Malformed Authorization header format rejected with 401 passed');

  // Test 5: Tampered JWT token signature
  const tamperedToken = `${tokenPair.accessToken.slice(0, -5)}abcde`;
  const tamperedRes = await app.inject({
    method: 'GET',
    url: '/v1/auth/me',
    headers: {
      authorization: `Bearer ${tamperedToken}`,
    },
  });
  if (tamperedRes.statusCode !== 401) {
    throw new Error(`Expected HTTP 401 for tampered JWT, got ${tamperedRes.statusCode}`);
  }
  console.log('  ✅ Tampered JWT signature rejected with 401 passed');

  // Test 6: Expired JWT token
  const expiredSecretConfig = {
    ...authConfig,
    jwtAccessExpiresIn: '-1s', // already expired
  };
  const expiredJwtService = new JwtService(expiredSecretConfig);
  const expiredToken = expiredJwtService.generateAccessToken({
    userId: testUser.id,
    email: testUser.email,
    role: testUser.role,
  });

  const expiredRes = await app.inject({
    method: 'GET',
    url: '/v1/auth/me',
    headers: {
      authorization: `Bearer ${expiredToken}`,
    },
  });
  if (expiredRes.statusCode !== 401) {
    throw new Error(`Expected HTTP 401 for expired token, got ${expiredRes.statusCode}`);
  }
  console.log('  ✅ Expired JWT token rejected with 401 passed');

  // Test 7: Revoked Session Check
  await sessionRepo.revokeSession(sessionId);
  const revokedRes = await app.inject({
    method: 'GET',
    url: '/v1/auth/me',
    headers: {
      authorization: `Bearer ${tokenPair.accessToken}`,
    },
  });
  if (revokedRes.statusCode !== 401) {
    throw new Error(
      `Expected HTTP 401 for token with revoked session, got ${revokedRes.statusCode}`,
    );
  }
  console.log('  ✅ Revoked session token rejected with 401 passed');

  // Test 8: Unit test authenticate, requireAuth, and getRequestUser
  const mockReq = { headers: {} } as unknown as FastifyRequest;
  const mockReply = {} as unknown as FastifyReply;

  const authHookFn = authenticate(jwtService) as unknown as (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>;

  try {
    await authHookFn(mockReq, mockReply);
    throw new Error('Expected authenticate to throw if header missing');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.includes('Authorization header is required')) {
      throw err;
    }
  }

  try {
    getRequestUser(mockReq);
    throw new Error('Expected getRequestUser to throw if user unauthenticated');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.includes('No authenticated user')) {
      throw err;
    }
  }

  const guardFn = requireAuth() as unknown as (
    req: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>;

  try {
    await guardFn(mockReq, mockReply);
    throw new Error('Expected requireAuth guard to throw if user missing');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.includes('Unauthorized access')) {
      throw err;
    }
  }
  console.log('  ✅ authenticate, requireAuth, and getRequestUser helper unit tests passed');

  await app.close();
  console.log('🎉 All Authentication Middleware & Route Protection Tests passed successfully!');
}

runMiddlewareTests().catch((err) => {
  console.error('❌ Middleware Tests failed:', err);
  process.exit(1);
});
