import type { QuotaResponseDto } from '../dto/quota.dto';
import {
  DailyLimitExceededError,
  MonthlyBudgetExceededError,
  QuotaExceededError,
  TokenQuotaExceededError,
} from '../errors/quota.errors';
import { DEFAULT_QUOTA_LIMITS, QUOTA_RESET_INTERVALS } from '../quota.constants';
import type { ApiKeyQuotaRecord, IQuotaRepository } from '../repositories/quota.repository';

export class QuotaService {
  constructor(private readonly quotaRepository: IQuotaRepository) {}

  async getOrCreateQuota(apiKeyId: string): Promise<ApiKeyQuotaRecord> {
    let quota = await this.quotaRepository.findByApiKeyId(apiKeyId);
    if (!quota) {
      quota = await this.quotaRepository.createQuota({
        apiKeyId,
        requestsPerMinute: DEFAULT_QUOTA_LIMITS.REQUESTS_PER_MINUTE,
        requestsPerDay: DEFAULT_QUOTA_LIMITS.REQUESTS_PER_DAY,
        tokensPerDay: DEFAULT_QUOTA_LIMITS.TOKENS_PER_DAY,
        monthlyBudgetUsd: DEFAULT_QUOTA_LIMITS.MONTHLY_BUDGET_USD,
      });
    }
    return quota;
  }

  async checkAndEnforceQuota(
    apiKeyId: string,
    estimatedTokens = 0,
    estimatedCost = 0,
  ): Promise<ApiKeyQuotaRecord> {
    let quota = await this.getOrCreateQuota(apiKeyId);
    const now = new Date();

    // 1. Reset Minute Counter if 1 minute has elapsed
    if (now.getTime() - quota.resetMinuteAt.getTime() >= QUOTA_RESET_INTERVALS.MINUTE_MS) {
      quota = await this.quotaRepository.resetMinuteCounter(apiKeyId, now);
    }

    // 2. Reset Day Counter if 24 hours (1 day) has elapsed
    if (now.getTime() - quota.resetDayAt.getTime() >= QUOTA_RESET_INTERVALS.DAY_MS) {
      quota = await this.quotaRepository.resetDayCounter(apiKeyId, now);
    }

    // 3. Reset Month Counter if 30 days (1 month) has elapsed
    if (now.getTime() - quota.resetMonthAt.getTime() >= QUOTA_RESET_INTERVALS.MONTH_MS) {
      quota = await this.quotaRepository.resetMonthCounter(apiKeyId, now);
    }

    // 4. Validate Requests per minute limit
    if (quota.currentRequestsMinute >= quota.requestsPerMinute) {
      throw new QuotaExceededError(
        `Requests per minute limit exceeded (${quota.requestsPerMinute}/min).`,
        {
          limit: quota.requestsPerMinute,
          current: quota.currentRequestsMinute,
        },
      );
    }

    // 5. Validate Requests per day limit
    if (quota.currentRequestsDay >= quota.requestsPerDay) {
      throw new DailyLimitExceededError(
        `Daily request limit exceeded (${quota.requestsPerDay}/day).`,
        {
          limit: quota.requestsPerDay,
          current: quota.currentRequestsDay,
        },
      );
    }

    // 6. Validate Tokens per day limit
    if (quota.currentTokensDay + Math.max(0, estimatedTokens) > quota.tokensPerDay) {
      throw new TokenQuotaExceededError(
        `Daily token quota exceeded (${quota.tokensPerDay} tokens/day).`,
        {
          limit: quota.tokensPerDay,
          current: quota.currentTokensDay,
          requested: estimatedTokens,
        },
      );
    }

    // 7. Validate Monthly budget limit
    if (quota.currentSpendUsd + Math.max(0, estimatedCost) > quota.monthlyBudgetUsd) {
      throw new MonthlyBudgetExceededError(
        `Monthly budget limit exceeded ($${quota.monthlyBudgetUsd}).`,
        {
          limit: quota.monthlyBudgetUsd,
          current: quota.currentSpendUsd,
          requested: estimatedCost,
        },
      );
    }

    return quota;
  }

  async recordUsageQuota(
    apiKeyId: string,
    requests = 1,
    tokens = 0,
    spendUsd = 0,
  ): Promise<ApiKeyQuotaRecord> {
    return this.quotaRepository.updateCounters(apiKeyId, {
      requestsMinute: Math.max(0, requests),
      requestsDay: Math.max(0, requests),
      tokensDay: Math.max(0, tokens),
      spendUsd: Math.max(0, spendUsd),
    });
  }

  async getQuotaDto(apiKeyId: string): Promise<QuotaResponseDto> {
    const quota = await this.getOrCreateQuota(apiKeyId);
    return {
      id: quota.id,
      apiKeyId: quota.apiKeyId,
      requestsPerMinute: quota.requestsPerMinute,
      requestsPerDay: quota.requestsPerDay,
      tokensPerDay: quota.tokensPerDay,
      monthlyBudgetUsd: quota.monthlyBudgetUsd,
      currentRequestsMinute: quota.currentRequestsMinute,
      currentRequestsDay: quota.currentRequestsDay,
      currentTokensDay: quota.currentTokensDay,
      currentSpendUsd: quota.currentSpendUsd,
      resetMinuteAt: quota.resetMinuteAt.toISOString(),
      resetDayAt: quota.resetDayAt.toISOString(),
      resetMonthAt: quota.resetMonthAt.toISOString(),
      createdAt: quota.createdAt.toISOString(),
      updatedAt: quota.updatedAt.toISOString(),
    };
  }
}
