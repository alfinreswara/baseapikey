import { generateUuidV7 } from '@baseapikey/shared';

import type { CreateUsageRecordDto } from '../dto/usage.dto';
import type { IUsageRepository, UsageRecordEntity } from '../repositories/usage.repository';

export class MockUsageRepository implements IUsageRepository {
  public records: UsageRecordEntity[] = [];

  async createUsageRecord(data: CreateUsageRecordDto): Promise<UsageRecordEntity> {
    const record: UsageRecordEntity = {
      id: generateUuidV7(),
      userId: data.userId,
      apiKeyId: data.apiKeyId,
      provider: data.provider,
      model: data.model,
      endpoint: data.endpoint,
      requestId: data.requestId,
      promptTokens: data.promptTokens,
      completionTokens: data.completionTokens,
      totalTokens: data.totalTokens,
      estimatedCost: data.estimatedCost,
      latencyMs: data.latencyMs,
      statusCode: data.statusCode,
      clientIp: data.clientIp ?? null,
      userAgent: data.userAgent ?? null,
      createdAt: new Date(),
    };
    this.records.push(record);
    return record;
  }

  async findByUserId(userId: string): Promise<UsageRecordEntity[]> {
    return this.records
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findByApiKeyId(apiKeyId: string): Promise<UsageRecordEntity[]> {
    return this.records
      .filter((r) => r.apiKeyId === apiKeyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  clear(): void {
    this.records = [];
  }
}
