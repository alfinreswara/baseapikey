import { AuditSeverity } from '@baseapikey/database';
import { AuthenticationError } from '@baseapikey/shared';

import type { LogoutAllRequestDto, LogoutRequestDto } from '../dto/logout.dto';
import type { ISessionRepository } from '../repositories/session.repository';
import type { IUserRepository } from '../repositories/user.repository';

import type { JwtService } from './jwt.service';

export interface LogoutMetadata {
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  requestId?: string | null | undefined;
}

export class LogoutService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly sessionRepository: ISessionRepository,
    private readonly jwtService: JwtService,
  ) {}

  async logout(
    dto: LogoutRequestDto,
    authHeader?: string,
    metadata: LogoutMetadata = {},
  ): Promise<void> {
    const { userId, sessionId } = this.extractAuthContext(dto.refreshToken, authHeader);

    if (sessionId) {
      const session = await this.sessionRepository.findSessionById(sessionId);
      if (session && !session.isRevoked) {
        await this.sessionRepository.revokeSession(session.id);
      }
    }

    await this.userRepository.recordAuditLog({
      userId,
      action: 'AUTH_LOGOUT_SUCCESS',
      resource: 'auth_session',
      resourceId: sessionId ?? userId,
      ipAddress: metadata.ipAddress ?? undefined,
      userAgent: metadata.userAgent ?? undefined,
      requestId: metadata.requestId ?? undefined,
      severity: AuditSeverity.INFO,
    });
  }

  async logoutAll(
    dto: LogoutAllRequestDto,
    authHeader?: string,
    metadata: LogoutMetadata = {},
  ): Promise<void> {
    const { userId } = this.extractAuthContext(dto.refreshToken, authHeader);

    await this.sessionRepository.revokeAllUserSessions(userId);

    await this.userRepository.recordAuditLog({
      userId,
      action: 'AUTH_LOGOUT_ALL_SUCCESS',
      resource: 'auth_session',
      resourceId: userId,
      ipAddress: metadata.ipAddress ?? undefined,
      userAgent: metadata.userAgent ?? undefined,
      requestId: metadata.requestId ?? undefined,
      severity: AuditSeverity.INFO,
    });
  }

  private extractAuthContext(
    refreshTokenInBody?: string,
    authHeader?: string,
  ): { userId: string; sessionId?: string | undefined } {
    if (refreshTokenInBody && refreshTokenInBody.trim() !== '') {
      try {
        const payload = this.jwtService.verifyToken(refreshTokenInBody, 'refresh');
        if (payload.sub) {
          return { userId: payload.sub, sessionId: payload.sessionId };
        }
      } catch {
        throw new AuthenticationError('Invalid refresh token');
      }
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      if (token !== '') {
        try {
          const payload = this.jwtService.verifyToken(token, 'access');
          if (payload.sub) {
            return { userId: payload.sub, sessionId: payload.sessionId };
          }
        } catch {
          try {
            const payload = this.jwtService.verifyToken(token, 'refresh');
            if (payload.sub) {
              return { userId: payload.sub, sessionId: payload.sessionId };
            }
          } catch {
            throw new AuthenticationError('Invalid authentication token');
          }
        }
      }
    }

    throw new AuthenticationError('Missing or invalid authentication credentials');
  }
}
