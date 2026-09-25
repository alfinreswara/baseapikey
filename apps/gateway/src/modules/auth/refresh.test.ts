import { AuditSeverity, UserRole, UserStatus } from '@baseapikey/database';

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
import { LoginService } from './services/login.service';
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

  async findSessionById(id: string): Promise<UserSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<UserSession | null> {
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

  async revokeSession(id: string): Promise<void> {
    const s = this.sessions.get(id);
    if (s) {
      s.revokedAt = new Date();
      s.isRevoked = true;
      s.updatedAt = new Date();
    }
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    const now = new Date();
    for (const s of this.sessions.values()) {
      if (s.userId === userId && !s.isRevoked) {
        s.revokedAt = now;
        s.isRevoked = true;
        s.updatedAt = now;
      }
    }
  }
}

async function runRefreshTests() {
  console.log('🧪 Starting Refresh Token & Session Management Tests...');

  const authConfig = loadAuthConfig();
  const passwordService = new PasswordService();
  const jwtService = new JwtService(authConfig);
  const userRepo = new MockUserRepository();
  const sessionRepo = new MockSessionRepository();

  const loginService = new LoginService(userRepo, sessionRepo, jwtService, passwordService);
  const refreshService = new RefreshTokenService(
    userRepo,
    sessionRepo,
    jwtService,
    passwordService,
  );

  // Seed active user
  const plainPassword = 'Password123!@#';
  const hashedPassword = await passwordService.hash(plainPassword);

  const activeUser = await userRepo.create({
    email: 'refresh.user@example.com',
    username: 'refreshuser',
    fullName: 'Refresh User',
    passwordHash: hashedPassword,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  // Login active user to obtain valid tokens & session
  const loginRes = await loginService.login(
    { email: activeUser.email, password: plainPassword },
    { ipAddress: '127.0.0.1', userAgent: 'TestBrowser/1.0', requestId: 'req-login-1' },
  );

  const initialRefreshToken = loginRes.refreshToken;

  // Test 1: Successful Token Refresh & Token Rotation
  const refreshRes = await refreshService.refreshToken(
    { refreshToken: initialRefreshToken },
    { ipAddress: '127.0.0.1', userAgent: 'TestBrowser/1.0', requestId: 'req-refresh-1' },
  );

  if (!refreshRes.accessToken || !refreshRes.refreshToken) {
    throw new Error('Refresh response missing tokens');
  }
  if (refreshRes.tokenType !== 'Bearer') {
    throw new Error(`Expected Bearer tokenType, got ${refreshRes.tokenType}`);
  }
  if (refreshRes.refreshToken === initialRefreshToken) {
    throw new Error('Refresh token was not rotated!');
  }
  console.log('  ✅ Successful token refresh & rotation passed');

  // Test 2: Verify Old Session Revoked
  const oldDecoded = jwtService.verifyToken(initialRefreshToken, 'refresh');
  const oldSession = await sessionRepo.findSessionById(oldDecoded.sessionId!);
  if (!oldSession || !oldSession.isRevoked || oldSession.revokedAt === null) {
    throw new Error('Old session was not marked as revoked after rotation');
  }
  console.log('  ✅ Old session revocation verification passed');

  // Test 3: Token Reuse Attempt (Submitting rotated/revoked refresh token)
  try {
    await refreshService.refreshToken(
      { refreshToken: initialRefreshToken },
      { ipAddress: '127.0.0.1', userAgent: 'TestBrowser/1.0', requestId: 'req-reuse-1' },
    );
    throw new Error('Expected revoked session error on token reuse');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.toLowerCase().includes('revoked')) {
      throw err;
    }
  }

  // Verify that all user sessions were revoked upon reuse detection
  const newDecoded = jwtService.verifyToken(refreshRes.refreshToken, 'refresh');
  const newSession = await sessionRepo.findSessionById(newDecoded.sessionId!);
  if (!newSession || !newSession.isRevoked) {
    throw new Error('Reuse detection failed to revoke all active user sessions!');
  }

  const reuseAuditLog = userRepo.auditLogs.find(
    (l) => l.action === 'AUTH_REFRESH_TOKEN_REUSE_DETECTED',
  );
  if (!reuseAuditLog || reuseAuditLog.severity !== AuditSeverity.CRITICAL) {
    throw new Error('Security audit log for token reuse missing or invalid');
  }
  console.log('  ✅ Token reuse detection & security session revocation passed');

  // Test 4: Expired Session Handling
  const expiredSessionUser = await userRepo.create({
    email: 'expired.session@example.com',
    username: 'expiredsession',
    fullName: 'Expired Session User',
    passwordHash: hashedPassword,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  const expiredSessionId = 'sess_expired_1';
  const expiredRefreshToken = jwtService.generateRefreshToken({
    userId: expiredSessionUser.id,
    email: expiredSessionUser.email,
    role: expiredSessionUser.role,
    sessionId: expiredSessionId,
  });

  const expiredHash = await passwordService.hash(expiredRefreshToken);
  await sessionRepo.createSession({
    id: expiredSessionId,
    userId: expiredSessionUser.id,
    refreshTokenHash: expiredHash,
    expiresAt: new Date(Date.now() - 10000), // expired 10s ago
  });

  try {
    await refreshService.refreshToken({ refreshToken: expiredRefreshToken });
    throw new Error('Expected expired refresh token error');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.toLowerCase().includes('expired')) {
      throw err;
    }
  }
  console.log('  ✅ Expired session rejection passed');

  // Test 5: Suspended User Rejection
  const suspendedUser = await userRepo.create({
    email: 'suspended.refresh@example.com',
    username: 'suspendedrefresh',
    fullName: 'Suspended Refresh User',
    passwordHash: hashedPassword,
    role: UserRole.USER,
    status: UserStatus.SUSPENDED,
  });

  const suspendedSessionId = 'sess_suspended_1';
  const suspendedToken = jwtService.generateRefreshToken({
    userId: suspendedUser.id,
    email: suspendedUser.email,
    role: suspendedUser.role,
    sessionId: suspendedSessionId,
  });
  const suspendedHash = await passwordService.hash(suspendedToken);
  await sessionRepo.createSession({
    id: suspendedSessionId,
    userId: suspendedUser.id,
    refreshTokenHash: suspendedHash,
    expiresAt: new Date(Date.now() + 1000000),
  });

  try {
    await refreshService.refreshToken({ refreshToken: suspendedToken });
    throw new Error('Expected suspended account error');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.toLowerCase().includes('suspended')) {
      throw err;
    }
  }
  console.log('  ✅ Suspended account rejection passed');

  // Test 6: HTTP POST /v1/auth/refresh Endpoint via Fastify inject
  const app = buildApp({
    userRepository: userRepo,
    sessionRepository: sessionRepo,
  });

  // Re-login active user to get clean refresh token
  const httpLoginRes = await loginService.login({
    email: activeUser.email,
    password: plainPassword,
  });

  const httpResp = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: {
      refreshToken: httpLoginRes.refreshToken,
    },
  });

  if (httpResp.statusCode !== 200) {
    throw new Error(`Expected HTTP status 200, got ${httpResp.statusCode}: ${httpResp.body}`);
  }

  const httpBody = JSON.parse(httpResp.body) as {
    success: boolean;
    data: { accessToken: string; refreshToken: string };
  };

  if (!httpBody.success || !httpBody.data.accessToken || !httpBody.data.refreshToken) {
    throw new Error('Invalid HTTP response payload from /v1/auth/refresh');
  }
  console.log('  ✅ HTTP POST /v1/auth/refresh 200 OK test passed');

  // Test 7: HTTP Invalid Payload (400 Bad Request)
  const invalidResp = await app.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: {
      refreshToken: '',
    },
  });

  if (invalidResp.statusCode !== 400) {
    throw new Error(
      `Expected 400 Bad Request for empty refreshToken, got ${invalidResp.statusCode}`,
    );
  }
  console.log('  ✅ HTTP Invalid payload validation (400) passed');

  console.log('🎉 All Refresh Token & Session Management Tests passed successfully!');
}

runRefreshTests().catch((err) => {
  console.error('❌ Refresh Token Tests failed:', err);
  process.exit(1);
});
