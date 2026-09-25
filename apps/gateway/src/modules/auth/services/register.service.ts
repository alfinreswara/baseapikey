import { AuditSeverity } from '@baseapikey/database';
import { ConflictError } from '@baseapikey/shared';

import type { RegisterRequestDto, RegisterResponseDto } from '../dto/register.dto';
import type { IUserRepository } from '../repositories/user.repository';

import { PasswordService, passwordService } from './password.service';

export class RegisterService {
  constructor(
    private readonly userRepository: IUserRepository,
    private readonly passService: PasswordService = passwordService,
  ) {}

  async register(dto: RegisterRequestDto): Promise<RegisterResponseDto> {
    const existingEmail = await this.userRepository.findByEmail(dto.email);
    if (existingEmail) {
      throw new ConflictError('Email already exists');
    }

    const existingUsername = await this.userRepository.findByUsername(dto.username);
    if (existingUsername) {
      throw new ConflictError('Username already exists');
    }

    const passwordHash = await this.passService.hash(dto.password);

    const user = await this.userRepository.create({
      email: dto.email,
      username: dto.username,
      fullName: dto.fullName,
      passwordHash,
    });

    await this.userRepository.recordAuditLog({
      userId: user.id,
      action: 'AUTH_REGISTER',
      resource: 'user',
      resourceId: user.id,
      severity: AuditSeverity.INFO,
    });

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      createdAt: user.createdAt,
    };
  }
}
