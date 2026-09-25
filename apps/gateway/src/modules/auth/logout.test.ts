import { UserRole, UserStatus } from '@baseapikey/database';

import { buildApp } from '../../app';

import { loadAuthConfig } from './auth.config';
import type {
  CreateSessionData,
  ISessionRepository,
  UpdateSessionData,
} from './repositories/session.repository';
import type {
  CreateUserData,
  IUserRepository,
  RecordAuditLogData,
} from './repositories/user.repository';
import { JwtService } from './services/jwt.service';
import { LogoutService } from './services/logout.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh.service';
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

  public auditLogs: RecordAuditLogData[] = [];

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

  async recordAuditLog(data: RecordAuditLogData) {
    this.auditLogs.push(data);
  }
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
    if (data.ipAddress !== undefined) s.ipAddress = data.ipAddress;
    if (data.userAgent !== undefined) s.userAgent = data.userAgent;
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
    const now = new Date();
    for (const s of this.sessions.values()) {
      if (s.userId === userId) {
        s.isRevoked = true;
        s.revokedAt = now;
        s.updatedAt = now;
      }
    }
  }
}

async function runLogoutTests() {
  console.log('🧪 Starting Logout & Session Revocation Unit & Integration Tests...');

  const authConfig = loadAuthConfig();
  const jwtService = new JwtService(authConfig);
  const passwordService = new PasswordService();

  const userRepo = new MockUserRepository();
  const sessionRepo = new MockSessionRepository();
  const logoutService = new LogoutService(userRepo, sessionRepo, jwtService);
  const refreshService = new RefreshTokenService(
    userRepo,
    sessionRepo,
    jwtService,
    passwordService,
  );

  const hashedPassword = await passwordService.hash('Password123!');
  const testUser = await userRepo.create({
    email: 'logout.user@example.com',
    username: 'logoutuser',
    fullName: 'Logout User',
    passwordHash: hashedPassword,
  });

  // Setup initial session & tokens
  const sessionId = 'sess_logout_1';
  const tokenPair = jwtService.generateTokenPair({
    userId: testUser.id,
    email: testUser.email,
    role: testUser.role,
    sessionId,
  });
  const refreshTokenHash = await passwordService.hash(tokenPair.refreshToken);
  await sessionRepo.createSession({
    id: sessionId,
    userId: testUser.id,
    refreshTokenHash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  // Test 1: Logout Single Session via Bearer token
  await logoutService.logout({}, `Bearer ${tokenPair.accessToken}`);
  const sessionRecord = await sessionRepo.findSessionById(sessionId);
  if (!sessionRecord || !sessionRecord.isRevoked || sessionRecord.revokedAt === null) {
    throw new Error('Session was not marked as revoked on logout');
  }

  const logoutAuditLog = userRepo.auditLogs.find((l) => l.action === 'AUTH_LOGOUT_SUCCESS');
  if (!logoutAuditLog || logoutAuditLog.userId !== testUser.id) {
    throw new Error('AUTH_LOGOUT_SUCCESS audit log was not recorded correctly');
  }
  console.log('  ✅ Logout single session via Bearer token passed');

  // Test 2: Revoked refresh token cannot be used to refresh
  try {
    await refreshService.refreshToken({ refreshToken: tokenPair.refreshToken });
    throw new Error('Expected revoked session error on refresh attempt');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.toLowerCase().includes('revoked')) {
      throw err;
    }
  }
  console.log('  ✅ Revoked refresh token rejected by refresh service passed');

  // Test 3: Idempotent Logout
  await logoutService.logout({}, `Bearer ${tokenPair.accessToken}`);
  console.log('  ✅ Idempotent logout execution passed');

  // Test 4: Logout All Sessions
  const session2Id = 'sess_logout_2';
  const session3Id = 'sess_logout_3';

  const tokenPair2 = jwtService.generateTokenPair({
    userId: testUser.id,
    email: testUser.email,
    role: testUser.role,
    sessionId: session2Id,
  });
  const tokenPair3 = jwtService.generateTokenPair({
    userId: testUser.id,
    email: testUser.email,
    role: testUser.role,
    sessionId: session3Id,
  });

  await sessionRepo.createSession({
    id: session2Id,
    userId: testUser.id,
    refreshTokenHash: await passwordService.hash(tokenPair2.refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  await sessionRepo.createSession({
    id: session3Id,
    userId: testUser.id,
    refreshTokenHash: await passwordService.hash(tokenPair3.refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  await logoutService.logoutAll({}, `Bearer ${tokenPair2.accessToken}`);

  const s2 = await sessionRepo.findSessionById(session2Id);
  const s3 = await sessionRepo.findSessionById(session3Id);

  if (!s2 || !s2.isRevoked || !s3 || !s3.isRevoked) {
    throw new Error('Logout all failed to revoke all user sessions');
  }

  const logoutAllAuditLog = userRepo.auditLogs.find((l) => l.action === 'AUTH_LOGOUT_ALL_SUCCESS');
  if (!logoutAllAuditLog || logoutAllAuditLog.userId !== testUser.id) {
    throw new Error('AUTH_LOGOUT_ALL_SUCCESS audit log was not recorded correctly');
  }
  console.log('  ✅ Logout all sessions passed');

  // Test 5: Integration Fastify HTTP POST /v1/auth/logout
  const httpApp = buildApp({
    userRepository: userRepo,
    sessionRepository: sessionRepo,
  });

  const session4Id = 'sess_logout_4';
  const tokenPair4 = jwtService.generateTokenPair({
    userId: testUser.id,
    email: testUser.email,
    role: testUser.role,
    sessionId: session4Id,
  });
  await sessionRepo.createSession({
    id: session4Id,
    userId: testUser.id,
    refreshTokenHash: await passwordService.hash(tokenPair4.refreshToken),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const httpLogoutRes = await httpApp.inject({
    method: 'POST',
    url: '/v1/auth/logout',
    headers: {
      authorization: `Bearer ${tokenPair4.accessToken}`,
    },
  });

  if (httpLogoutRes.statusCode !== 204) {
    throw new Error(`Expected HTTP 204 No Content for logout, got ${httpLogoutRes.statusCode}`);
  }
  console.log('  ✅ HTTP POST /v1/auth/logout 204 No Content passed');

  // Test 6: Integration Fastify HTTP POST /v1/auth/logout-all
  const httpLogoutAllRes = await httpApp.inject({
    method: 'POST',
    url: '/v1/auth/logout-all',
    headers: {
      authorization: `Bearer ${tokenPair4.accessToken}`,
    },
  });

  if (httpLogoutAllRes.statusCode !== 204) {
    throw new Error(
      `Expected HTTP 204 No Content for logout-all, got ${httpLogoutAllRes.statusCode}`,
    );
  }
  console.log('  ✅ HTTP POST /v1/auth/logout-all 204 No Content passed');

  // Test 7: Unauthenticated Logout HTTP 401 Unauthorized
  const unauthRes = await httpApp.inject({
    method: 'POST',
    url: '/v1/auth/logout',
  });

  if (unauthRes.statusCode !== 401) {
    throw new Error(`Expected HTTP 401 for unauthenticated logout, got ${unauthRes.statusCode}`);
  }
  console.log('  ✅ HTTP Unauthenticated logout 401 Unauthorized passed');

  await httpApp.close();
  console.log('🎉 All Logout & Session Revocation Tests passed successfully!');
}

runLogoutTests().catch((err) => {
  console.error('❌ Logout Tests failed:', err);
  process.exit(1);
});
