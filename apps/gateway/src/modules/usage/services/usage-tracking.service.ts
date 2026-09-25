import type { IApiKeyRepository } from '../../api-keys/repositories/api-key.repository';
import type { CreateUsageRecordDto, UsageRecordResponseDto } from '../dto/usage.dto';
import type { IUsageRepository } from '../repositories/usage.repository';

import type { IUsageBillingService } from './usage-billing.service';

export class UsageTrackingService {
  constructor(
    private readonly usageRepository: IUsageRepository,
    private readonly apiKeyRepository: IApiKeyRepository,
    private readonly billingService?: IUsageBillingService,
  ) {}

  async recordUsage(dto: CreateUsageRecordDto): Promise<UsageRecordResponseDto> {
    // 1. Create Usage log entry
    const record = await this.usageRepository.createUsageRecord(dto);

    // 2. Asynchronously update ApiKey.lastUsedAt
    try {
      await this.apiKeyRepository.updateLastUsedAt(dto.apiKeyId, record.createdAt);
    } catch {
      // Non-blocking catch for lastUsedAt update failures
    }

    if (this.billingService && dto.organizationId && record.estimatedCost > 0) {
      await this.billingService.charge({
        usageId: record.id,
        organizationId: dto.organizationId,
        estimatedCostUsd: record.estimatedCost,
        model: record.model,
        requestId: record.requestId,
      });
    }

    const status = record.statusCode < 400 ? 'SUCCESS' : 'FAILED';

    return {
      id: record.id,
      userId: record.userId,
      apiKeyId: record.apiKeyId,
      provider: record.provider,
      model: record.model,
      endpoint: record.endpoint,
      requestId: record.requestId,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      totalTokens: record.totalTokens,
      estimatedCost: record.estimatedCost,
      latencyMs: record.latencyMs,
      statusCode: record.statusCode,
      status,
      clientIp: record.clientIp,
      userAgent: record.userAgent,
      createdAt: record.createdAt.toISOString(),
    };
  }

  async getUsageByUserId(userId: string): Promise<UsageRecordResponseDto[]> {
    const list = await this.usageRepository.findByUserId(userId);
    return list.map((record) => ({
      id: record.id,
      userId: record.userId,
      apiKeyId: record.apiKeyId,
      provider: record.provider,
      model: record.model,
      endpoint: record.endpoint,
      requestId: record.requestId,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      totalTokens: record.totalTokens,
      estimatedCost: record.estimatedCost,
      latencyMs: record.latencyMs,
      statusCode: record.statusCode,
      status: record.statusCode < 400 ? 'SUCCESS' : 'FAILED',
      clientIp: record.clientIp,
      userAgent: record.userAgent,
      createdAt: record.createdAt.toISOString(),
    }));
  }

  async getUsageByApiKeyId(apiKeyId: string): Promise<UsageRecordResponseDto[]> {
    const list = await this.usageRepository.findByApiKeyId(apiKeyId);
    return list.map((record) => ({
      id: record.id,
      userId: record.userId,
      apiKeyId: record.apiKeyId,
      provider: record.provider,
      model: record.model,
      endpoint: record.endpoint,
      requestId: record.requestId,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      totalTokens: record.totalTokens,
      estimatedCost: record.estimatedCost,
      latencyMs: record.latencyMs,
      statusCode: record.statusCode,
      status: record.statusCode < 400 ? 'SUCCESS' : 'FAILED',
      clientIp: record.clientIp,
      userAgent: record.userAgent,
      createdAt: record.createdAt.toISOString(),
    }));
  }
}
