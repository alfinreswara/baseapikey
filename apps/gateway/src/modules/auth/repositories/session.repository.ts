import { prisma, PrismaClient, Session } from '@baseapikey/database';

import type { UserSession } from '../types/session.types';

export interface CreateSessionData {
  id?: string | undefined;
  userId: string;
  refreshTokenHash: string;
  deviceId?: string | null | undefined;
  deviceName?: string | null | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  expiresAt: Date;
}

export interface UpdateSessionData {
  refreshTokenHash?: string | undefined;
  lastUsedAt?: Date | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
}

export interface ISessionRepository {
  createSession(data: CreateSessionData): Promise<UserSession>;
  findSessionById(id: string): Promise<UserSession | null>;
  findSessionByTokenHash(tokenHash: string): Promise<UserSession | null>;
  findActiveSessionsByUserId(userId: string): Promise<UserSession[]>;
  updateSession(id: string, data: UpdateSessionData): Promise<UserSession>;
  revokeSession(id: string): Promise<void>;
  revokeAllUserSessions(userId: string): Promise<void>;
}

export class InMemorySessionRepository implements ISessionRepository {
  private sessions: Map<string, UserSession> = new Map();

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
}

export class PrismaSessionRepository implements ISessionRepository {
  constructor(private readonly db: PrismaClient = prisma) {}

  async createSession(data: CreateSessionData): Promise<UserSession> {
    const record = await this.db.session.create({
      data: {
        ...(data.id ? { id: data.id } : {}),
        userId: data.userId,
        refreshTokenHash: data.refreshTokenHash,
        deviceId: data.deviceId ?? null,
        deviceName: data.deviceName ?? null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        expiresAt: data.expiresAt,
      },
    });
    return this.mapToUserSession(record);
  }

  async findSessionById(id: string): Promise<UserSession | null> {
    const record = await this.db.session.findUnique({
      where: { id },
    });
    return record ? this.mapToUserSession(record) : null;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<UserSession | null> {
    const record = await this.db.session.findFirst({
      where: { refreshTokenHash: tokenHash },
    });
    return record ? this.mapToUserSession(record) : null;
  }

  async findActiveSessionsByUserId(userId: string): Promise<UserSession[]> {
    const records = await this.db.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((r) => this.mapToUserSession(r));
  }

  async updateSession(id: string, data: UpdateSessionData): Promise<UserSession> {
    const record = await this.db.session.update({
      where: { id },
      data: {
        ...(data.refreshTokenHash !== undefined && { refreshTokenHash: data.refreshTokenHash }),
        ...(data.lastUsedAt !== undefined && { lastUsedAt: data.lastUsedAt }),
        ...(data.ipAddress !== undefined && { ipAddress: data.ipAddress }),
        ...(data.userAgent !== undefined && { userAgent: data.userAgent }),
      },
    });
    return this.mapToUserSession(record);
  }

  async revokeSession(id: string): Promise<void> {
    await this.db.session.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private mapToUserSession(record: Session): UserSession {
    return {
      id: record.id,
      userId: record.userId,
      refreshTokenHash: record.refreshTokenHash,
      deviceId: record.deviceId,
      deviceName: record.deviceName,
      ipAddress: record.ipAddress,
      userAgent: record.userAgent,
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
      revokedAt: record.revokedAt,
      isRevoked: record.revokedAt !== null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
