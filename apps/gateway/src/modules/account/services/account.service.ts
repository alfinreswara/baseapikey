import { AuditSeverity, UserStatus, type User } from '@baseapikey/database';
import {
  AuthenticationError,
  InternalError,
  NotFoundError,
  ValidationError,
} from '@baseapikey/shared';

import type { ISessionRepository } from '../../auth/repositories/session.repository';
import type { PasswordService } from '../../auth/services/password.service';
import type { ILoginRateLimiter } from '../../auth/utils/rate-limiter.interface';
import { NoopLoginRateLimiter } from '../../auth/utils/rate-limiter.interface';
import type { AccountProfileDto, ChangePasswordDto, UpdateProfileDto } from '../dto/account.dto';
import { InvalidAccountTokenError } from '../errors/account.errors';
import type { IAccountRepository } from '../repositories/account.repository';

import type { IAccountNotificationService } from './account-notification.service';
import type { AccountTokenPurpose, IAccountTokenStore } from './account-token.store';

export interface AccountRequestMetadata {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface AccountServiceLogger {
  error(context: Record<string, unknown>, message: string): void;
}

const noopLogger: AccountServiceLogger = { error: () => undefined };

export class AccountService {
  constructor(
    private readonly accountRepository: IAccountRepository,
    private readonly sessionRepository: ISessionRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenStore: IAccountTokenStore,
    private readonly notificationService: IAccountNotificationService,
    private readonly emailVerificationTtlSeconds = 86_400,
    private readonly passwordResetTtlSeconds = 900,
    private readonly logger: AccountServiceLogger = noopLogger,
    private readonly requestRateLimiter: ILoginRateLimiter = new NoopLoginRateLimiter(),
  ) {}

  async getProfile(userId: string): Promise<AccountProfileDto> {
    return this.toProfile(await this.getActiveUser(userId));
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
    metadata: AccountRequestMetadata,
  ): Promise<AccountProfileDto> {
    await this.getActiveUser(userId);
    const user = await this.accountRepository.updateProfile(userId, dto);
    await this.accountRepository.recordAudit({
      userId,
      action: 'ACCOUNT_PROFILE_UPDATE',
      ...metadata,
      metadata: { fields: Object.keys(dto) },
    });
    return this.toProfile(user);
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    metadata: AccountRequestMetadata,
  ): Promise<void> {
    const user = await this.getActiveUser(userId);
    if (!(await this.passwordService.verify(dto.currentPassword, user.passwordHash))) {
      await this.accountRepository.recordAudit({
        userId,
        action: 'ACCOUNT_PASSWORD_CHANGE_FAILED',
        ...metadata,
        severity: AuditSeverity.WARNING,
      });
      throw new AuthenticationError('Current password is incorrect');
    }

    const passwordHash = await this.passwordService.hash(dto.newPassword);
    await this.accountRepository.updatePassword(userId, passwordHash);
    await this.sessionRepository.revokeAllUserSessions(userId);
    await this.accountRepository.recordAudit({
      userId,
      action: 'ACCOUNT_PASSWORD_CHANGE',
      ...metadata,
    });
  }

  async requestEmailVerification(userId: string, metadata: AccountRequestMetadata): Promise<void> {
    const user = await this.getActiveUser(userId);
    if (user.emailVerified) return;

    const delivered = await this.issueAndDeliverToken(
      user,
      'email_verification',
      this.emailVerificationTtlSeconds,
    );
    await this.accountRepository.recordAudit({
      userId,
      action: 'ACCOUNT_EMAIL_VERIFICATION_REQUEST',
      ...metadata,
      severity: delivered ? AuditSeverity.INFO : AuditSeverity.ERROR,
      metadata: { delivered },
    });

    if (!delivered) {
      throw new InternalError('Unable to deliver email verification message');
    }
  }

  async confirmEmailVerification(token: string, metadata: AccountRequestMetadata): Promise<void> {
    const record = await this.tokenStore.consume(token, 'email_verification');
    if (!record) throw new InvalidAccountTokenError();

    const user = await this.getActiveUser(record.userId);
    await this.accountRepository.markEmailVerified(user.id);
    await this.accountRepository.recordAudit({
      userId: user.id,
      action: 'ACCOUNT_EMAIL_VERIFIED',
      ...metadata,
    });
  }

  async requestPasswordReset(email: string, metadata: AccountRequestMetadata): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    await this.requestRateLimiter.checkRateLimit(`password-reset:${normalizedEmail}`, {
      ...(metadata.ipAddress ? { ipAddress: metadata.ipAddress } : {}),
    });

    const user = await this.accountRepository.findByEmail(normalizedEmail);
    if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt !== null) return;

    try {
      const delivered = await this.issueAndDeliverToken(
        user,
        'password_reset',
        this.passwordResetTtlSeconds,
      );
      await this.accountRepository.recordAudit({
        userId: user.id,
        action: 'ACCOUNT_PASSWORD_RESET_REQUEST',
        ...metadata,
        severity: delivered ? AuditSeverity.INFO : AuditSeverity.ERROR,
        metadata: { delivered },
      });
    } catch (error) {
      // Password-reset requests intentionally keep the same public response for existing and
      // unknown accounts, including notification infrastructure failures.
      this.logger.error(
        { err: error, userId: user.id, purpose: 'password_reset' },
        'Password reset request could not be processed',
      );
    }
  }

  async confirmPasswordReset(
    token: string,
    newPassword: string,
    metadata: AccountRequestMetadata,
  ): Promise<void> {
    const record = await this.tokenStore.consume(token, 'password_reset');
    if (!record) throw new InvalidAccountTokenError();

    const user = await this.getActiveUser(record.userId);
    if (await this.passwordService.verify(newPassword, user.passwordHash)) {
      throw new ValidationError('New password must differ from the current password');
    }

    const passwordHash = await this.passwordService.hash(newPassword);
    await this.accountRepository.updatePassword(user.id, passwordHash);
    await this.sessionRepository.revokeAllUserSessions(user.id);
    await this.accountRepository.recordAudit({
      userId: user.id,
      action: 'ACCOUNT_PASSWORD_RESET',
      ...metadata,
    });
  }

  private async issueAndDeliverToken(
    user: User,
    purpose: AccountTokenPurpose,
    ttlSeconds: number,
  ): Promise<boolean> {
    const issued = await this.tokenStore.issue(user.id, purpose, ttlSeconds);
    try {
      await this.notificationService.send({
        purpose,
        email: user.email,
        token: issued.token,
        expiresAt: issued.expiresAt,
      });
      return true;
    } catch (error) {
      this.logger.error(
        { err: error, userId: user.id, purpose },
        'Account notification delivery failed',
      );
      return false;
    }
  }

  private async getActiveUser(userId: string): Promise<User> {
    const user = await this.accountRepository.findById(userId);
    if (!user || user.status !== UserStatus.ACTIVE || user.deletedAt !== null) {
      throw new NotFoundError('Active user', userId);
    }
    return user;
  }

  private toProfile(user: User): AccountProfileDto {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
