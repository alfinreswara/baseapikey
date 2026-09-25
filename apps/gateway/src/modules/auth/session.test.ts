import { UserRole, UserStatus } from '@baseapikey/database';

import { buildApp } from '../../app';

import { loadAuthConfig } from './auth.config';
import { InMemorySessionRepository } from './repositories/session.repository';
import type {
  CreateUserData,
  IUserRepository,
  RecordAuditLogData,
} from './repositories/user.repository';
import { JwtService } from './services/jwt.service';
import { PasswordService } from './services/password.service';
import { RefreshTokenService } from './services/refresh.service';
import { SessionService } from './services/session.service';

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

async function runSessionTests(): Promise<void> {
  console.log('🧪 Starting Session Management Unit & Integration Tests...');

  const authConfig = loadAuthConfig();
  const jwtService = new JwtService(authConfig);
  const passwordService = new PasswordService();

  // Test 1: Unit Test - List active sessions
  {
    const userRepository = new MockUserRepository();
    const sessionRepository = new InMemorySessionRepository();
    const sessionService = new SessionService(sessionRepository, userRepository);

    const user = await userRepository.create({
      email: 'session-user1@example.com',
      username: 'sessionuser1',
      fullName: 'Session User 1',
      passwordHash: 'hashed_pw',
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const sess1 = await sessionRepository.createSession({
      userId: user.id,
      refreshTokenHash: 'hash_1',
      deviceName: 'Chrome / macOS',
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0 Chrome',
      expiresAt,
    });

    const sess2 = await sessionRepository.createSession({
      userId: user.id,
      refreshTokenHash: 'hash_2',
      deviceName: 'Firefox / Linux',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0 Firefox',
      expiresAt,
    });

    const activeSessions = await sessionService.listActiveSessions(user.id, sess1.id);
    if (activeSessions.length !== 2) {
      throw new Error(`Expected 2 active sessions, got ${activeSessions.length}`);
    }

    const currentSess = activeSessions.find((s) => s.id === sess1.id);
    const otherSess = activeSessions.find((s) => s.id === sess2.id);

    if (!currentSess || !currentSess.currentSession) {
      throw new Error('Current session was not correctly flagged in listActiveSessions');
    }
    if (!otherSess || otherSess.currentSession) {
      throw new Error('Other session should not be flagged as current session');
    }

    console.log('  ✅ Service listActiveSessions & currentSession flag passed');
  }

  // Test 2: Unit Test - Get session detail & authorization
  {
    const userRepository = new MockUserRepository();
    const sessionRepository = new InMemorySessionRepository();
    const sessionService = new SessionService(sessionRepository, userRepository);

    const user1 = await userRepository.create({
      email: 'user1@example.com',
      username: 'user1',
      fullName: 'User One',
      passwordHash: 'hashed_pw',
    });

    const user2 = await userRepository.create({
      email: 'user2@example.com',
      username: 'user2',
      fullName: 'User Two',
      passwordHash: 'hashed_pw',
    });

    const expiresAt = new Date(Date.now() + 3600000);
    const sess1 = await sessionRepository.createSession({
      userId: user1.id,
      refreshTokenHash: 'hash_user1',
      deviceName: 'Device 1',
      expiresAt,
    });

    const detail = await sessionService.getSessionDetail(user1.id, sess1.id, sess1.id);
    if (detail.id !== sess1.id || detail.userId !== user1.id || !detail.currentSession) {
      throw new Error('Session detail output mismatch');
    }

    // Accessing another user's session should throw ForbiddenError
    let forbiddenCaught = false;
    try {
      await sessionService.getSessionDetail(user2.id, sess1.id);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('not authorized')) {
        forbiddenCaught = true;
      }
    }
    if (!forbiddenCaught) {
      throw new Error('Expected ForbiddenError when accessing another user session');
    }

    console.log('  ✅ Service getSessionDetail authorization check passed');
  }

  // Test 3: Unit Test - Revoke session & current session confirmation
  {
    const userRepository = new MockUserRepository();
    const sessionRepository = new InMemorySessionRepository();
    const sessionService = new SessionService(sessionRepository, userRepository);

    const user = await userRepository.create({
      email: 'revoke-user@example.com',
      username: 'revokeuser',
      fullName: 'Revoke User',
      passwordHash: 'hashed_pw',
    });

    const expiresAt = new Date(Date.now() + 3600000);
    const currSess = await sessionRepository.createSession({
      userId: user.id,
      refreshTokenHash: 'curr_hash',
      expiresAt,
    });
    const otherSess = await sessionRepository.createSession({
      userId: user.id,
      refreshTokenHash: 'other_hash',
      expiresAt,
    });

    // Revoking current session without confirmation should fail
    let confirmRequiredCaught = false;
    try {
      await sessionService.revokeSession(user.id, currSess.id, currSess.id, false);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('requires confirmation')) {
        confirmRequiredCaught = true;
      }
    }
    if (!confirmRequiredCaught) {
      throw new Error(
        'Expected confirmation error when revoking current session without confirm=true',
      );
    }

    // Revoking current session WITH confirmation should succeed
    await sessionService.revokeSession(user.id, currSess.id, currSess.id, true, {
      ipAddress: '127.0.0.1',
      userAgent: 'TestAgent',
    });

    const revokedCurr = await sessionRepository.findSessionById(currSess.id);
    if (!revokedCurr || !revokedCurr.isRevoked) {
      throw new Error('Current session was not revoked after confirmation');
    }

    // Revoking another session should succeed without confirmation flag
    await sessionService.revokeSession(user.id, otherSess.id, currSess.id);
    const revokedOther = await sessionRepository.findSessionById(otherSess.id);
    if (!revokedOther || !revokedOther.isRevoked) {
      throw new Error('Other session was not revoked');
    }

    // Verify audit log entries
    const auditLogs = userRepository.auditLogs.filter((a) => a.action === 'AUTH_SESSION_REVOKE');
    if (auditLogs.length !== 2) {
      throw new Error(`Expected 2 AUTH_SESSION_REVOKE audit log entries, got ${auditLogs.length}`);
    }

    console.log('  ✅ Service revokeSession confirmation & AuditLog recording passed');
  }

  // Test 4: Fastify HTTP Integration - GET /v1/auth/sessions
  {
    const userRepository = new MockUserRepository();
    const sessionRepository = new InMemorySessionRepository();

    const user = await userRepository.create({
      email: 'http-sess@example.com',
      username: 'httpsessuser',
      fullName: 'HTTP Session User',
      passwordHash: 'hashed_pw',
    });

    const expiresAt = new Date(Date.now() + 3600000);
    const session1 = await sessionRepository.createSession({
      userId: user.id,
      refreshTokenHash: 'hash_1',
      deviceName: 'Safari / iPhone',
      expiresAt,
    });

    const accessToken = jwtService.generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session1.id,
      tokenVersion: 1,
    });

    const app = await buildApp({
      userRepository,
      sessionRepository,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/sessions',
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    if (res.statusCode !== 200) {
      throw new Error(`GET /v1/auth/sessions returned ${res.statusCode}: ${res.body}`);
    }

    const payload = JSON.parse(res.body);
    if (!payload.success || !Array.isArray(payload.data) || payload.data.length !== 1) {
      throw new Error('GET /v1/auth/sessions response payload structure invalid');
    }

    if (payload.data[0].id !== session1.id || !payload.data[0].currentSession) {
      throw new Error('GET /v1/auth/sessions session item properties mismatch');
    }

    console.log('  ✅ HTTP GET /v1/auth/sessions 200 OK test passed');
  }

  // Test 5: Fastify HTTP Integration - GET /v1/auth/sessions/:id detail & 403 Forbidden check
  {
    const userRepository = new MockUserRepository();
    const sessionRepository = new InMemorySessionRepository();

    const owner = await userRepository.create({
      email: 'owner@example.com',
      username: 'owneruser',
      fullName: 'Owner User',
      passwordHash: 'hashed_pw',
    });

    const stranger = await userRepository.create({
      email: 'stranger@example.com',
      username: 'strangeruser',
      fullName: 'Stranger User',
      passwordHash: 'hashed_pw',
    });

    const expiresAt = new Date(Date.now() + 3600000);
    const ownerSess = await sessionRepository.createSession({
      userId: owner.id,
      refreshTokenHash: 'owner_hash',
      deviceName: 'Owner Laptop',
      expiresAt,
    });

    const strangerToken = jwtService.generateAccessToken({
      userId: stranger.id,
      email: stranger.email,
      role: stranger.role,
      tokenVersion: 1,
    });

    const app = await buildApp({
      userRepository,
      sessionRepository,
    });

    // Stranger attempting to GET owner's session detail
    const forbiddenRes = await app.inject({
      method: 'GET',
      url: `/v1/auth/sessions/${ownerSess.id}`,
      headers: {
        authorization: `Bearer ${strangerToken}`,
      },
    });

    if (forbiddenRes.statusCode !== 403) {
      throw new Error(
        `Expected 403 Forbidden for cross-user GET session detail, got ${forbiddenRes.statusCode}`,
      );
    }

    console.log('  ✅ HTTP GET /v1/auth/sessions/:id cross-user access 403 Forbidden passed');
  }

  // Test 6: Fastify HTTP Integration - DELETE /v1/auth/sessions/:id & Revoked Session Refresh Prevention
  {
    const userRepository = new MockUserRepository();
    const sessionRepository = new InMemorySessionRepository();

    const user = await userRepository.create({
      email: 'del-user@example.com',
      username: 'deluser',
      fullName: 'Del User',
      passwordHash: 'hashed_pw',
    });

    const expiresAt = new Date(Date.now() + 3600000);
    const currSess = await sessionRepository.createSession({
      userId: user.id,
      refreshTokenHash: 'curr_hash',
      deviceName: 'Desktop',
      expiresAt,
    });

    const otherSess = await sessionRepository.createSession({
      userId: user.id,
      refreshTokenHash: 'other_hash',
      deviceName: 'Mobile Phone',
      expiresAt,
    });

    const accessToken = jwtService.generateAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: currSess.id,
      tokenVersion: 1,
    });

    const refreshService = new RefreshTokenService(
      userRepository,
      sessionRepository,
      jwtService,
      passwordService,
    );

    const app = await buildApp({
      userRepository,
      sessionRepository,
    });

    // Revoke other session via HTTP DELETE
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/sessions/${otherSess.id}`,
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    if (deleteRes.statusCode !== 200) {
      throw new Error(`DELETE /v1/auth/sessions/:id failed with ${deleteRes.statusCode}`);
    }

    const revokedSess = await sessionRepository.findSessionById(otherSess.id);
    if (!revokedSess || !revokedSess.isRevoked) {
      throw new Error('Target session was not revoked');
    }

    // Generate a refresh token linked to the now-revoked session
    const revokedRefreshToken = jwtService.generateRefreshToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: otherSess.id,
    });

    // Verify refresh token service rejects revoked session
    let refreshFailed = false;
    try {
      await refreshService.refreshToken({ refreshToken: revokedRefreshToken });
    } catch (err: unknown) {
      if (err instanceof Error && err.message.toLowerCase().includes('revoked')) {
        refreshFailed = true;
      }
    }
    if (!refreshFailed) {
      throw new Error('Refresh token service failed to reject revoked session token');
    }

    console.log(
      '  ✅ HTTP DELETE /v1/auth/sessions/:id & Revoked session token refresh rejection passed',
    );
  }

  console.log('🎉 All Session Management Unit & Integration Tests passed successfully!');
}

runSessionTests().catch((err) => {
  console.error('❌ Session Management Test Failed:', err);
  process.exit(1);
});
