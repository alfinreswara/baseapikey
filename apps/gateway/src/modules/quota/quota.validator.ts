import type { CreateQuotaDto, UpdateQuotaDto } from './dto/quota.dto';
import { InvalidQuotaConfigError } from './errors/quota.errors';

export class QuotaValidator {
  static validateCreate(dto: CreateQuotaDto): void {
    if (dto.requestsPerMinute <= 0) {
      throw new InvalidQuotaConfigError('requestsPerMinute must be greater than 0');
    }
    if (dto.requestsPerDay <= 0) {
      throw new InvalidQuotaConfigError('requestsPerDay must be greater than 0');
    }
    if (dto.tokensPerDay <= 0) {
      throw new InvalidQuotaConfigError('tokensPerDay must be greater than 0');
    }
    if (dto.monthlyBudgetUsd <= 0) {
      throw new InvalidQuotaConfigError('monthlyBudgetUsd must be greater than 0');
    }
  }

  static validateUpdate(dto: UpdateQuotaDto): void {
    if (dto.requestsPerMinute !== undefined && dto.requestsPerMinute <= 0) {
      throw new InvalidQuotaConfigError('requestsPerMinute must be greater than 0');
    }
    if (dto.requestsPerDay !== undefined && dto.requestsPerDay <= 0) {
      throw new InvalidQuotaConfigError('requestsPerDay must be greater than 0');
    }
    if (dto.tokensPerDay !== undefined && dto.tokensPerDay <= 0) {
      throw new InvalidQuotaConfigError('tokensPerDay must be greater than 0');
    }
    if (dto.monthlyBudgetUsd !== undefined && dto.monthlyBudgetUsd <= 0) {
      throw new InvalidQuotaConfigError('monthlyBudgetUsd must be greater than 0');
    }
  }
}
