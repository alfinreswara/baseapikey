import { UserRole, UserStatus } from '@baseapikey/database';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../../app';
import { loadAuthConfig } from '../auth.config';
import type {
  CreateSessionData,
  ISessionRepository,
  UpdateSessionData,
} from '../repositories/session.repository';
import type {
  CreateUserData,
  IUserRepository,
  RecordAuditLogData,
} from '../repositories/user.repository';
import { JwtService } from '../services/jwt.service';
import { PasswordService } from '../services/password.service';
import type { UserSession } from '../types/session.types';

export class MockUserRepository implements IUserRepository {
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
    const user: {
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
    } = {
      id: `usr_${Math.random().toString(36).slice(2, 10)}`,
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

  public clear(): void {
    this.users = [];
    this.auditLogs = [];
  }
}

export class MockSessionRepository implements ISessionRepository {
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
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === tokenHash) {
        return session;
      }
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
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error('Session not found');
    }
    if (data.refreshTokenHash !== undefined) session.refreshTokenHash = data.refreshTokenHash;
    if (data.lastUsedAt !== undefined) session.lastUsedAt = data.lastUsedAt;
    if (data.ipAddress !== undefined) session.ipAddress = data.ipAddress;
    if (data.userAgent !== undefined) session.userAgent = data.userAgent;
    session.updatedAt = new Date();
    return session;
  }

  async revokeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session) {
      session.revokedAt = new Date();
      session.isRevoked = true;
      session.updatedAt = new Date();
    }
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    const now = new Date();
    for (const session of this.sessions.values()) {
      if (session.userId === userId && !session.isRevoked) {
        session.revokedAt = now;
        session.isRevoked = true;
        session.updatedAt = now;
      }
    }
  }

  public clear(): void {
    this.sessions.clear();
  }
}

export interface TestAppSuite {
  app: FastifyInstance;
  userRepository: MockUserRepository;
  sessionRepository: MockSessionRepository;
  jwtService: JwtService;
  passwordService: PasswordService;
  cleanup: () => void;
}

export async function setupAuthTestSuite(): Promise<TestAppSuite> {
  const userRepository = new MockUserRepository();
  const sessionRepository = new MockSessionRepository();
  const authConfig = loadAuthConfig();
  const jwtService = new JwtService(authConfig);
  const passwordService = new PasswordService();

  const app = buildApp({
    userRepository,
    sessionRepository,
  });

  const cleanup = () => {
    userRepository.clear();
    sessionRepository.clear();
  };

  return {
    app,
    userRepository,
    sessionRepository,
    jwtService,
    passwordService,
    cleanup,
  };
}
