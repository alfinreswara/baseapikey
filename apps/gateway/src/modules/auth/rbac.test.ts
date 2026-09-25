import { UserRole, UserStatus } from '@baseapikey/database';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { buildApp } from '../../app';

import { loadAuthConfig } from './auth.config';
import {
  AuthorizationContext,
  ForbiddenError,
  MissingPermissionError,
  MissingRoleError,
  PERMISSIONS,
  requirePermission,
  requireRole,
} from './rbac';
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

async function runRbacTests() {
  console.log('🧪 Starting Role-Based Access Control (RBAC) Unit & Integration Tests...');

  const authConfig = loadAuthConfig();
  const jwtService = new JwtService(authConfig);
  const userRepo = new MockUserRepository();
  const sessionRepo = new MockSessionRepository();

  // Create normal user & admin user
  const normalUser = await userRepo.create({
    email: 'normal.user@example.com',
    username: 'normaluser',
    fullName: 'Normal User',
    passwordHash: 'dummy',
    role: UserRole.USER,
  });

  const adminUser = await userRepo.create({
    email: 'admin.user@example.com',
    username: 'adminuser',
    fullName: 'Admin User',
    passwordHash: 'dummy',
    role: UserRole.ADMIN,
  });

  const userTokens = jwtService.generateTokenPair({
    userId: normalUser.id,
    email: normalUser.email,
    role: normalUser.role,
  });

  const adminTokens = jwtService.generateTokenPair({
    userId: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
  });

  const app = buildApp({
    userRepository: userRepo,
    sessionRepository: sessionRepo,
  });

  // Unit Test 1: AuthorizationContext permission resolution
  const userPerms = AuthorizationContext.getPermissionsForRole('USER');
  if (!userPerms.has(PERMISSIONS.APIKEY_READ) || userPerms.has(PERMISSIONS.SYSTEM_MANAGE)) {
    throw new Error('USER role permissions resolution failed');
  }

  const adminPerms = AuthorizationContext.getPermissionsForRole('ADMIN');
  if (
    !adminPerms.has(PERMISSIONS.APIKEY_READ) ||
    !adminPerms.has(PERMISSIONS.SYSTEM_MANAGE) ||
    !adminPerms.has(PERMISSIONS.USERS_DELETE)
  ) {
    throw new Error('ADMIN role permissions resolution failed');
  }

  const unknownPerms = AuthorizationContext.getPermissionsForRole('UNKNOWN_ROLE');
  if (unknownPerms.size !== 0) {
    throw new Error('Unrecognized role must return empty permission set (deny by default)');
  }
  console.log('  ✅ AuthorizationContext permissions resolution passed');

  // Integration Test 2: USER role accessing USER endpoint (GET /v1/user/apikeys) -> 200 OK
  const userRes = await app.inject({
    method: 'GET',
    url: '/v1/user/apikeys',
    headers: {
      authorization: `Bearer ${userTokens.accessToken}`,
    },
  });
  if (userRes.statusCode !== 200) {
    throw new Error(
      `Expected HTTP 200 for USER accessing USER endpoint, got ${userRes.statusCode}`,
    );
  }
  console.log('  ✅ USER accessing USER endpoints passed');

  // Integration Test 3: USER role denied ADMIN endpoint (GET /v1/admin/system) -> 403 Forbidden
  const userAdminRes = await app.inject({
    method: 'GET',
    url: '/v1/admin/system',
    headers: {
      authorization: `Bearer ${userTokens.accessToken}`,
    },
  });
  if (userAdminRes.statusCode !== 403) {
    throw new Error(
      `Expected HTTP 403 Forbidden for USER accessing ADMIN endpoint, got ${userAdminRes.statusCode}`,
    );
  }
  const userAdminErr = JSON.parse(userAdminRes.payload);
  if (userAdminErr.error.code !== 'FORBIDDEN' && userAdminErr.error.code !== 'MISSING_PERMISSION') {
    throw new Error(`Expected 403 error code, got ${userAdminErr.error.code}`);
  }
  console.log('  ✅ USER denied ADMIN endpoints (403 Forbidden) passed');

  // Integration Test 4: ADMIN role accessing ADMIN endpoint (GET /v1/admin/system) -> 200 OK
  const adminRes = await app.inject({
    method: 'GET',
    url: '/v1/admin/system',
    headers: {
      authorization: `Bearer ${adminTokens.accessToken}`,
    },
  });
  if (adminRes.statusCode !== 200) {
    throw new Error(
      `Expected HTTP 200 for ADMIN accessing ADMIN endpoint, got ${adminRes.statusCode}`,
    );
  }
  console.log('  ✅ ADMIN accessing ADMIN endpoints passed');

  // Integration Test 5: Unauthenticated request accessing protected endpoints -> 401 Unauthorized
  const unauthRes = await app.inject({
    method: 'GET',
    url: '/v1/admin/system',
  });
  if (unauthRes.statusCode !== 401) {
    throw new Error(
      `Expected HTTP 401 Unauthorized for unauthenticated request, got ${unauthRes.statusCode}`,
    );
  }
  console.log('  ✅ Unauthenticated request rejected with 401 Unauthorized passed');

  // Unit Test 6: Direct Middleware Guard Unit Tests
  const mockReq = {
    user: {
      userId: normalUser.id,
      email: normalUser.email,
      role: normalUser.role,
      tokenVersion: 1,
    },
  } as unknown as FastifyRequest;
  const mockReply = {} as unknown as FastifyReply;

  // Test requireRole guard
  const adminRoleGuard = requireRole('ADMIN') as unknown as (
    req: FastifyRequest,
    rep: FastifyReply,
  ) => Promise<void>;
  try {
    await adminRoleGuard(mockReq, mockReply);
    throw new Error('Expected requireRole to throw ForbiddenError for non-admin user');
  } catch (err: unknown) {
    if (!(err instanceof ForbiddenError)) {
      throw err;
    }
  }

  // Test requirePermission guard
  const systemManageGuard = requirePermission(PERMISSIONS.SYSTEM_MANAGE) as unknown as (
    req: FastifyRequest,
    rep: FastifyReply,
  ) => Promise<void>;
  try {
    await systemManageGuard(mockReq, mockReply);
    throw new Error('Expected requirePermission to throw MissingPermissionError for user');
  } catch (err: unknown) {
    if (!(err instanceof MissingPermissionError)) {
      throw err;
    }
  }

  // Test user lacking role context
  const mockNoRoleReq = {
    user: {
      userId: normalUser.id,
      email: normalUser.email,
      tokenVersion: 1,
    },
  } as unknown as FastifyRequest;

  try {
    await (
      requireRole('USER') as unknown as (req: FastifyRequest, rep: FastifyReply) => Promise<void>
    )(mockNoRoleReq, mockReply);
    throw new Error('Expected requireRole to throw MissingRoleError when role missing');
  } catch (err: unknown) {
    if (!(err instanceof MissingRoleError)) {
      throw err;
    }
  }
  console.log('  ✅ requireRole, requirePermission, and MissingRoleError unit tests passed');

  await app.close();
  console.log('🎉 All Role-Based Access Control (RBAC) Tests passed successfully!');
}

runRbacTests().catch((err) => {
  console.error('❌ RBAC Tests failed:', err);
  process.exit(1);
});
