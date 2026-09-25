import { AuditSeverity, UserStatus } from '@baseapikey/database';
import { AuthenticationError, generateUuidV7 } from '@baseapikey/shared';

import type { LoginRequestDto, LoginResponseDto } from '../dto/login.dto';
import type { ISessionRepository } from '../repositories/session.repository';
import type { IUserRepository } from '../repositories/user.repository';
import type { LoginMetadata } from '../types/auth.types';
import { type ILoginRateLimiter, NoopLoginRateLimiter } from '../utils/rate-limiter.interface';

import type { JwtService } from './jwt.service';
import type { PasswordService } from './password.service';

const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRmb3JkdW1teXVzZXI$dummyhashfordummyuserverification123456789012345';

export class LoginService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly sessionRepository: ISessionRepository,
    private readonly jwtService: JwtService,
    private readonly passwordService: PasswordService,
    private readonly rateLimiter: ILoginRateLimiter = new NoopLoginRateLimiter(),
  ) {}

  async login(dto: LoginRequestDto, meta: LoginMetadata = {}): Promise<LoginResponseDto> {
    // 1. Enforce both identity and source-IP rate limits when available.
    await this.rateLimiter.checkRateLimit(dto.email, {
      ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
    });

    // 2. User Lookup by Email & Constant-Time Dummy Verification if not found
    const user = await this.userRepository.findByEmail(dto.email);
    if (!user) {
      await this.passwordService.verify(dto.password, DUMMY_ARGON2_HASH);
      await this.userRepository.recordAuditLog({
        action: 'AUTH_LOGIN_FAILED',
        resource: 'User',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: AuditSeverity.WARNING,
        metadata: { reason: 'Invalid email or password' },
      });
      throw new AuthenticationError('Invalid email or password');
    }

    // 3. Reject Deleted User
    if (user.status === UserStatus.DELETED || user.deletedAt !== null) {
      await this.userRepository.recordAuditLog({
        userId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        resource: 'User',
        resourceId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: AuditSeverity.WARNING,
        metadata: { reason: 'Account deleted' },
      });
      throw new AuthenticationError('Account has been deleted');
    }

    // 4. Reject Suspended User
    if (user.status === UserStatus.SUSPENDED) {
      await this.userRepository.recordAuditLog({
        userId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        resource: 'User',
        resourceId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: AuditSeverity.WARNING,
        metadata: { reason: 'Account suspended' },
      });
      throw new AuthenticationError('Account has been suspended');
    }

    // 5. Constant-Time Password Verification
    const isPasswordValid = await this.passwordService.verify(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      await this.userRepository.recordAuditLog({
        userId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        resource: 'User',
        resourceId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        severity: AuditSeverity.WARNING,
        metadata: { reason: 'Invalid email or password' },
      });
      throw new AuthenticationError('Invalid email or password');
    }

    // 6. Update Last Login Timestamp
    const loginTime = new Date();
    await this.userRepository.updateLastLogin(user.id, loginTime);

    // 7. Device Session & Token Pair Generation
    const sessionId = generateUuidV7();
    const organizationContext = await this.userRepository.getActiveOrganizationContext?.(user.id);
    const tokenPair = this.jwtService.generateTokenPair({
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId,
      apiVersion: 'v1',
      tokenVersion: 1,
      ...(organizationContext ?? {}),
    });

    // 8. Store Argon2 HASH of Refresh Token in Session (Never store plaintext)
    const refreshTokenHash = await this.passwordService.hash(tokenPair.refreshToken);
    const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days default
    await this.sessionRepository.createSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      expiresAt: sessionExpiresAt,
    });

    // 9. Record Successful Login Audit Log
    await this.userRepository.recordAuditLog({
      userId: user.id,
      action: 'AUTH_LOGIN_SUCCESS',
      resource: 'User',
      resourceId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      severity: AuditSeverity.INFO,
      metadata: { sessionId },
    });

    // 10. Return Response DTO (No password or sensitive leak)
    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      tokenType: tokenPair.tokenType,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }
}
