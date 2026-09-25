import { AuditSeverity } from '@baseapikey/database';
import { NotFoundError, ValidationError } from '@baseapikey/shared';

import type { SessionDetailResponseDto, SessionItemResponseDto } from '../dto/session.dto';
import { ForbiddenError } from '../rbac/rbac.errors';
import type { ISessionRepository } from '../repositories/session.repository';
import type { IUserRepository } from '../repositories/user.repository';

export interface SessionActionMetadata {
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  requestId?: string | null | undefined;
}

export class SessionService {
  constructor(
    private readonly sessionRepository: ISessionRepository,
    private readonly userRepository: IUserRepository,
  ) {}

  async listActiveSessions(
    userId: string,
    currentSessionId?: string,
  ): Promise<SessionItemResponseDto[]> {
    const sessions = await this.sessionRepository.findActiveSessionsByUserId(userId);

    return sessions.map((session) => ({
      id: session.id,
      deviceName: session.deviceName,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt ? session.lastUsedAt.toISOString() : null,
      expiresAt: session.expiresAt.toISOString(),
      currentSession: Boolean(currentSessionId && session.id === currentSessionId),
    }));
  }

  async getSessionDetail(
    userId: string,
    targetSessionId: string,
    currentSessionId?: string,
  ): Promise<SessionDetailResponseDto> {
    const session = await this.sessionRepository.findSessionById(targetSessionId);

    if (!session) {
      throw new NotFoundError('Session', targetSessionId);
    }

    if (session.userId !== userId) {
      throw new ForbiddenError('You are not authorized to access this session');
    }

    return {
      id: session.id,
      userId: session.userId,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      lastUsedAt: session.lastUsedAt ? session.lastUsedAt.toISOString() : null,
      expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
      revokedAt: session.revokedAt ? session.revokedAt.toISOString() : null,
      isRevoked: session.isRevoked,
      currentSession: Boolean(currentSessionId && session.id === currentSessionId),
    };
  }

  async revokeSession(
    userId: string,
    targetSessionId: string,
    currentSessionId?: string,
    confirmCurrentSession?: boolean,
    metadata?: SessionActionMetadata,
  ): Promise<void> {
    const session = await this.sessionRepository.findSessionById(targetSessionId);

    if (!session) {
      throw new NotFoundError('Session', targetSessionId);
    }

    if (session.userId !== userId) {
      throw new ForbiddenError('You are not authorized to revoke this session');
    }

    if (currentSessionId && targetSessionId === currentSessionId && !confirmCurrentSession) {
      throw new ValidationError(
        'Revoking your current session requires confirmation. Pass confirm=true parameter.',
      );
    }

    if (!session.isRevoked) {
      await this.sessionRepository.revokeSession(targetSessionId);
    }

    await this.userRepository.recordAuditLog({
      userId,
      action: 'AUTH_SESSION_REVOKE',
      resource: 'auth_session',
      resourceId: targetSessionId,
      ipAddress: metadata?.ipAddress ?? undefined,
      userAgent: metadata?.userAgent ?? undefined,
      requestId: metadata?.requestId ?? undefined,
      severity: AuditSeverity.INFO,
    });
  }
}
