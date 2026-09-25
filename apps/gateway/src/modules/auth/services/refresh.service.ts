import { AuditSeverity, UserStatus } from '@baseapikey/database';
import { AuthenticationError, generateUuidV7 } from '@baseapikey/shared';

import type { RefreshTokenRequestDto, RefreshTokenResponseDto } from '../dto/refresh.dto';
import type { ISessionRepository } from '../repositories/session.repository';
import type { IUserRepository } from '../repositories/user.repository';
import type { LoginMetadata } from '../types/auth.types';

import type { JwtService } from './jwt.service';
import type { PasswordService } from './password.service';

export class RefreshTokenService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly sessionRepository: ISessionRepository,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
  ) {}

  async refreshToken(
    dto: RefreshTokenRequestDto,
    meta: LoginMetadata = {},
  ): Promise<RefreshTokenResponseDto> {
    // 1. Verify JWT signature & token type ('refresh')
    let decoded;
    try {
      decoded = this.jwtService.verifyToken(dto.refreshToken, 'refresh');
    } catch {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    const userId = decoded.sub;
    const sessionId = decoded.sessionId;

    if (!sessionId) {
      throw new AuthenticationError('Invalid refresh token payload: missing session ID');
    }

    // 2. Fetch Session by ID
    const session = await this.sessionRepository.findSessionById(sessionId);
    if (!session) {
      await this.userRepository.recordAuditLog({
        userId,
        action: 'AUTH_REFRESH_FAILED',
        resource: 'Session',
        resourceId: sessionId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: AuditSeverity.WARNING,
        metadata: { reason: 'Session not found' },
      });
      throw new AuthenticationError('Session not found');
    }

    // 3. Reject Revoked Sessions & Trigger Replay Protection
    if (session.isRevoked || session.revokedAt !== null) {
      // Replay attack / theft detected: revoke all user sessions!
      await this.sessionRepository.revokeAllUserSessions(userId);
      await this.userRepository.recordAuditLog({
        userId,
        action: 'AUTH_REFRESH_TOKEN_REUSE_DETECTED',
        resource: 'Session',
        resourceId: sessionId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: AuditSeverity.CRITICAL,
        metadata: { reason: 'Revoked session reuse attempt' },
      });
      throw new AuthenticationError('Revoked session');
    }

    // 4. Reject Expired Sessions
    if (session.expiresAt <= new Date()) {
      await this.userRepository.recordAuditLog({
        userId,
        action: 'AUTH_REFRESH_FAILED',
        resource: 'Session',
        resourceId: sessionId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: AuditSeverity.WARNING,
        metadata: { reason: 'Expired session' },
      });
      throw new AuthenticationError('Expired refresh token');
    }

    // 5. Verify Argon2 Hash of Refresh Token
    const isHashValid = await this.passwordService.verify(
      dto.refreshToken,
      session.refreshTokenHash,
    );
    if (!isHashValid) {
      // Refresh token mismatch (possible theft/replay)
      await this.sessionRepository.revokeAllUserSessions(userId);
      await this.userRepository.recordAuditLog({
        userId,
        action: 'AUTH_REFRESH_TOKEN_REUSE_DETECTED',
        resource: 'Session',
        resourceId: sessionId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: AuditSeverity.CRITICAL,
        metadata: { reason: 'Refresh token hash mismatch' },
      });
      throw new AuthenticationError('Invalid refresh token');
    }

    // 6. User Status Verification
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new AuthenticationError('User account not found');
    }

    if (user.status === UserStatus.DELETED || user.deletedAt !== null) {
      await this.sessionRepository.revokeAllUserSessions(userId);
      throw new AuthenticationError('Account has been deleted');
    }

    if (user.status === UserStatus.SUSPENDED) {
      await this.sessionRepository.revokeAllUserSessions(userId);
      throw new AuthenticationError('Account has been suspended');
    }

    // 7. Refresh Token Rotation (RTR)
    // Revoke old session
    await this.sessionRepository.revokeSession(sessionId);

    // Create new session ID and issue new JWT token pair
    const newSessionId = generateUuidV7();
    const organizationContext = await this.userRepository.getActiveOrganizationContext?.(user.id);
    const tokenPair = this.jwtService.generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: newSessionId,
      apiVersion: 'v1',
      tokenVersion: 1,
      ...(organizationContext ?? {}),
    });

    // Store Argon2 hash of new refresh token in new session record
    const newRefreshTokenHash = await this.passwordService.hash(tokenPair.refreshToken);
    const newSessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.sessionRepository.createSession({
      id: newSessionId,
      userId: user.id,
      refreshTokenHash: newRefreshTokenHash,
      deviceId: dto.deviceId ?? session.deviceId,
      deviceName: dto.deviceName ?? session.deviceName,
      ipAddress: meta.ipAddress ?? session.ipAddress,
      userAgent: meta.userAgent ?? session.userAgent,
      expiresAt: newSessionExpiresAt,
    });

    // 8. Record Audit Log for successful refresh
    await this.userRepository.recordAuditLog({
      userId: user.id,
      action: 'AUTH_REFRESH_SUCCESS',
      resource: 'Session',
      resourceId: newSessionId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      severity: AuditSeverity.INFO,
      metadata: { rotatedFromSessionId: sessionId, newSessionId },
    });

    // 9. Return Response DTO (No plaintext secrets logged or exposed)
    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      tokenType: tokenPair.tokenType,
    };
  }
}
