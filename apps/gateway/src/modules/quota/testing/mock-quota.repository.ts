import { generateUuidV7 } from '@baseapikey/shared';

import type { CreateQuotaDto, UpdateQuotaDto } from '../dto/quota.dto';
import { DEFAULT_QUOTA_LIMITS } from '../quota.constants';
import type {
  ApiKeyQuotaRecord,
  IQuotaRepository,
  QuotaCounterDelta,
} from '../repositories/quota.repository';

export class MockQuotaRepository implements IQuotaRepository {
  public quotas: ApiKeyQuotaRecord[] = [];

  async findByApiKeyId(apiKeyId: string): Promise<ApiKeyQuotaRecord | null> {
    return this.quotas.find((q) => q.apiKeyId === apiKeyId) ?? null;
  }

  async createQuota(
    data: Partial<CreateQuotaDto> & { apiKeyId: string },
  ): Promise<ApiKeyQuotaRecord> {
    const record: ApiKeyQuotaRecord = {
      id: generateUuidV7(),
      apiKeyId: data.apiKeyId,
      requestsPerMinute: data.requestsPerMinute ?? DEFAULT_QUOTA_LIMITS.REQUESTS_PER_MINUTE,
      requestsPerDay: data.requestsPerDay ?? DEFAULT_QUOTA_LIMITS.REQUESTS_PER_DAY,
      tokensPerDay: data.tokensPerDay ?? DEFAULT_QUOTA_LIMITS.TOKENS_PER_DAY,
      monthlyBudgetUsd: data.monthlyBudgetUsd ?? DEFAULT_QUOTA_LIMITS.MONTHLY_BUDGET_USD,
      currentRequestsMinute: 0,
      currentRequestsDay: 0,
      currentTokensDay: 0,
      currentSpendUsd: 0,
      resetMinuteAt: new Date(),
      resetDayAt: new Date(),
      resetMonthAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.quotas.push(record);
    return record;
  }

  async updateQuota(apiKeyId: string, data: UpdateQuotaDto): Promise<ApiKeyQuotaRecord> {
    let q = this.quotas.find((item) => item.apiKeyId === apiKeyId);
    if (!q) {
      q = await this.createQuota({ apiKeyId });
    }
    if (data.requestsPerMinute !== undefined) q.requestsPerMinute = data.requestsPerMinute;
    if (data.requestsPerDay !== undefined) q.requestsPerDay = data.requestsPerDay;
    if (data.tokensPerDay !== undefined) q.tokensPerDay = data.tokensPerDay;
    if (data.monthlyBudgetUsd !== undefined) q.monthlyBudgetUsd = data.monthlyBudgetUsd;
    q.updatedAt = new Date();
    return q;
  }

  async updateCounters(apiKeyId: string, delta: QuotaCounterDelta): Promise<ApiKeyQuotaRecord> {
    let q = this.quotas.find((item) => item.apiKeyId === apiKeyId);
    if (!q) {
      q = await this.createQuota({ apiKeyId });
    }
    q.currentRequestsMinute += Math.max(0, delta.requestsMinute ?? 0);
    q.currentRequestsDay += Math.max(0, delta.requestsDay ?? 0);
    q.currentTokensDay += Math.max(0, delta.tokensDay ?? 0);
    q.currentSpendUsd += Math.max(0, delta.spendUsd ?? 0);
    q.updatedAt = new Date();
    return q;
  }

  async resetMinuteCounter(apiKeyId: string, resetTime: Date): Promise<ApiKeyQuotaRecord> {
    let q = this.quotas.find((item) => item.apiKeyId === apiKeyId);
    if (!q) {
      q = await this.createQuota({ apiKeyId });
    }
    q.currentRequestsMinute = 0;
    q.resetMinuteAt = resetTime;
    q.updatedAt = new Date();
    return q;
  }

  async resetDayCounter(apiKeyId: string, resetTime: Date): Promise<ApiKeyQuotaRecord> {
    let q = this.quotas.find((item) => item.apiKeyId === apiKeyId);
    if (!q) {
      q = await this.createQuota({ apiKeyId });
    }
    q.currentRequestsDay = 0;
    q.currentTokensDay = 0;
    q.resetDayAt = resetTime;
    q.updatedAt = new Date();
    return q;
  }

  async resetMonthCounter(apiKeyId: string, resetTime: Date): Promise<ApiKeyQuotaRecord> {
    let q = this.quotas.find((item) => item.apiKeyId === apiKeyId);
    if (!q) {
      q = await this.createQuota({ apiKeyId });
    }
    q.currentSpendUsd = 0;
    q.resetMonthAt = resetTime;
    q.updatedAt = new Date();
    return q;
  }

  clear(): void {
    this.quotas = [];
  }
}
