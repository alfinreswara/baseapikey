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
import type { UserSession } from './types/session.types';
import type { ILoginRateLimiter } from './utils/rate-limiter.interface';

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
    if (s) s.isRevoked = true;
  }

  async revokeAllUserSessions(userId: string) {
    for (const s of this.sessions.values()) {
      if (s.userId === userId) s.isRevoked = true;
    }
  }
}

class MockRateLimiter implements ILoginRateLimiter {
  public checkedKeys: string[] = [];
  async checkRateLimit(key: string): Promise<void> {
    this.checkedKeys.push(key);
  }
}

async function runLoginTests() {
  console.log('🧪 Starting User Login Unit & Integration Tests...');

  const authConfig = loadAuthConfig();
  const passwordService = new PasswordService();
  const jwtService = new JwtService(authConfig);
  const userRepo = new MockUserRepository();
  const sessionRepo = new MockSessionRepository();
  const rateLimiter = new MockRateLimiter();

  const loginService = new LoginService(
    userRepo,
    sessionRepo,
    jwtService,
    passwordService,
    rateLimiter,
  );

  // Seed active user
  const plainPassword = 'Password123!@#';
  const hashedPassword = await passwordService.hash(plainPassword);

  const activeUser = await userRepo.create({
    email: 'login.user@example.com',
    username: 'loginuser',
    fullName: 'Login User',
    passwordHash: hashedPassword,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
  });

  // Seed suspended user
  const suspendedUser = await userRepo.create({
    email: 'suspended.user@example.com',
    username: 'suspendeduser',
    fullName: 'Suspended User',
    passwordHash: hashedPassword,
    role: UserRole.USER,
    status: UserStatus.SUSPENDED,
  });

  // Seed deleted user
  const deletedUser = await userRepo.create({
    email: 'deleted.user@example.com',
    username: 'deleteduser',
    fullName: 'Deleted User',
    passwordHash: hashedPassword,
    role: UserRole.USER,
    status: UserStatus.DELETED,
  });

  // Test 1: Successful Service Login
  const loginResult = await loginService.login(
    {
      email: 'login.user@example.com',
      password: plainPassword,
    },
    {
      ipAddress: '127.0.0.1',
      userAgent: 'TestBrowser/1.0',
      requestId: 'req-login-1',
    },
  );

  if (!loginResult.accessToken || !loginResult.refreshToken) {
    throw new Error('Login response missing tokens');
  }
  if (loginResult.tokenType !== 'Bearer') {
    throw new Error(`Expected Bearer tokenType, got ${loginResult.tokenType}`);
  }
  if (loginResult.user.id !== activeUser.id) {
    throw new Error('Login user ID mismatch');
  }
  console.log('  ✅ Service successful login passed');

  // Test 2: Verify Rate Limiter Invocation
  if (!rateLimiter.checkedKeys.includes('login.user@example.com')) {
    throw new Error('Rate limiter was not called during login');
  }
  console.log('  ✅ Rate limiter hook execution passed');

  // Test 3: Verify HASH of Refresh Token in Device Session (Never plaintext)
  const session = Array.from(sessionRepo.sessions.values()).find((s) => s.userId === activeUser.id);
  if (!session) {
    throw new Error('Device session record was not created');
  }
  const isHashValid = await passwordService.verify(
    loginResult.refreshToken,
    session.refreshTokenHash,
  );
  if (!isHashValid) {
    throw new Error('Session refreshTokenHash does not match Argon2 hash of refresh token');
  }
  if (session.refreshTokenHash.includes(loginResult.refreshToken)) {
    throw new Error('Plaintext refresh token detected in session!');
  }
  console.log('  ✅ Hashed refresh token & session record verification passed');

  // Test 4: Verify JWT Claims (sub, email, role, apiVersion, tokenVersion, sessionId)
  const decodedAccessPayload = jwtService.verifyToken(loginResult.accessToken, 'access');
  if (
    decodedAccessPayload.sub !== activeUser.id ||
    decodedAccessPayload.email !== activeUser.email ||
    decodedAccessPayload.role !== activeUser.role ||
    decodedAccessPayload.apiVersion !== 'v1' ||
    decodedAccessPayload.tokenVersion !== 1 ||
    decodedAccessPayload.sessionId !== session.id
  ) {
    throw new Error(`Invalid JWT claims in access token: ${JSON.stringify(decodedAccessPayload)}`);
  }
  console.log('  ✅ JWT Claims verification passed');

  // Test 5: Verify Audit Log Recording
  const successLog = userRepo.auditLogs.find(
    (l) => l.action === 'AUTH_LOGIN_SUCCESS' && l.userId === activeUser.id,
  );
  if (!successLog || successLog.severity !== AuditSeverity.INFO) {
    throw new Error('Successful login audit log missing or invalid');
  }
  console.log('  ✅ Successful login audit log verification passed');

  // Test 6: Invalid Password Handling (Generic error)
  try {
    await loginService.login({
      email: 'login.user@example.com',
      password: 'WrongPassword123!',
    });
    throw new Error('Expected invalid password AuthenticationError');
  } catch (err: unknown) {
    if (!(err instanceof Error) || err.message !== 'Invalid email or password') {
      throw err;
    }
  }
  console.log('  ✅ Invalid password generic error check passed');

  // Test 7: Unknown Email Handling (Generic error)
  try {
    await loginService.login({
      email: 'nonexistent@example.com',
      password: plainPassword,
    });
    throw new Error('Expected unknown email AuthenticationError');
  } catch (err: unknown) {
    if (!(err instanceof Error) || err.message !== 'Invalid email or password') {
      throw err;
    }
  }
  console.log('  ✅ Unknown email generic error check passed');

  // Test 8: Suspended Account Handling
  try {
    await loginService.login({
      email: suspendedUser.email,
      password: plainPassword,
    });
    throw new Error('Expected suspended account AuthenticationError');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.includes('suspended')) {
      throw err;
    }
  }
  console.log('  ✅ Suspended account rejection passed');

  // Test 9: Deleted Account Handling
  try {
    await loginService.login({
      email: deletedUser.email,
      password: plainPassword,
    });
    throw new Error('Expected deleted account AuthenticationError');
  } catch (err: unknown) {
    if (!(err instanceof Error) || !err.message.includes('deleted')) {
      throw err;
    }
  }
  console.log('  ✅ Deleted account rejection passed');

  // HTTP Integration Tests via Fastify inject
  const app = buildApp({
    userRepository: userRepo,
    sessionRepository: sessionRepo,
    rateLimiter,
  });

  // Test 10: HTTP POST /v1/auth/login 200 OK
  const httpResp = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: {
      email: 'login.user@example.com',
      password: plainPassword,
    },
  });

  if (httpResp.statusCode !== 200) {
    throw new Error(`Expected HTTP status 200, got ${httpResp.statusCode}: ${httpResp.body}`);
  }

  const httpBody = JSON.parse(httpResp.body) as {
    success: boolean;
    data: {
      accessToken: string;
      refreshToken: string;
      expiresIn: string;
      tokenType: string;
      user: { id: string; email: string };
    };
  };

  if (!httpBody.success || !httpBody.data.accessToken || !httpBody.data.refreshToken) {
    throw new Error('Invalid HTTP response payload from /v1/auth/login');
  }
  console.log('  ✅ HTTP POST /v1/auth/login 200 OK test passed');

  // Test 11: HTTP Invalid Body (400 Bad Request)
  const invalidBodyResp = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: {
      email: 'invalid-email',
      password: '',
    },
  });

  if (invalidBodyResp.statusCode !== 400) {
    throw new Error(`Expected 400 Bad Request for invalid body, got ${invalidBodyResp.statusCode}`);
  }
  console.log('  ✅ HTTP Invalid payload validation (400) passed');

  console.log('🎉 All User Login Unit & Integration Tests passed successfully!');
}

runLoginTests().catch((err) => {
  console.error('❌ User Login Tests failed:', err);
  process.exit(1);
});
