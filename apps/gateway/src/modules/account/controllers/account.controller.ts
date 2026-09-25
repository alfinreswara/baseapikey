import type { FastifyReply, FastifyRequest } from 'fastify';

import { getRequestUser } from '../../auth/middleware/auth.middleware';
import {
  AccountTokenConfirmationSchema,
  ChangePasswordSchema,
  parseAccountDto,
  PasswordResetConfirmationSchema,
  PasswordResetRequestSchema,
  UpdateProfileSchema,
} from '../dto/account.dto';
import type { AccountRequestMetadata, AccountService } from '../services/account.service';

export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  async getProfile(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const profile = await this.accountService.getProfile(user.userId);
    this.send(reply, 200, profile);
  }

  async updateProfile(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const dto = parseAccountDto(UpdateProfileSchema, request.body);
    const profile = await this.accountService.updateProfile(
      user.userId,
      dto,
      this.getMetadata(request),
    );
    this.send(reply, 200, profile);
  }

  async changePassword(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const dto = parseAccountDto(ChangePasswordSchema, request.body);
    await this.accountService.changePassword(user.userId, dto, this.getMetadata(request));
    this.send(reply, 200, { message: 'Password changed; all sessions have been revoked' });
  }

  async requestEmailVerification(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    await this.accountService.requestEmailVerification(user.userId, this.getMetadata(request));
    this.send(reply, 202, { message: 'Email verification request accepted' });
  }

  async confirmEmailVerification(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const dto = parseAccountDto(AccountTokenConfirmationSchema, request.body);
    await this.accountService.confirmEmailVerification(dto.token, this.getMetadata(request));
    this.send(reply, 200, { message: 'Email verified' });
  }

  async requestPasswordReset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const dto = parseAccountDto(PasswordResetRequestSchema, request.body);
    await this.accountService.requestPasswordReset(dto.email, this.getMetadata(request));
    this.send(reply, 202, {
      message: 'If the account exists, password reset instructions will be sent',
    });
  }

  async confirmPasswordReset(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const dto = parseAccountDto(PasswordResetConfirmationSchema, request.body);
    await this.accountService.confirmPasswordReset(
      dto.token,
      dto.newPassword,
      this.getMetadata(request),
    );
    this.send(reply, 200, { message: 'Password reset; all sessions have been revoked' });
  }

  private getMetadata(request: FastifyRequest): AccountRequestMetadata {
    return {
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    };
  }

  private send(reply: FastifyReply, statusCode: number, data: unknown): void {
    void reply
      .header('Cache-Control', 'private, no-store')
      .status(statusCode)
      .send({ success: true, data });
  }
}
