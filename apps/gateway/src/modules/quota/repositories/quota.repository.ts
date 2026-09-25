import { prisma } from '@baseapikey/database';

import type { CreateQuotaDto, UpdateQuotaDto } from '../dto/quota.dto';

export interface ApiKeyQuotaRecord {
  id: string;
  apiKeyId: string;
  requestsPerMinute: number;
  requestsPerDay: number;
  tokensPerDay: number;
  monthlyBudgetUsd: number;
  currentRequestsMinute: number;
  currentRequestsDay: number;
  currentTokensDay: number;
  currentSpendUsd: number;
  resetMinuteAt: Date;
  resetDayAt: Date;
  resetMonthAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuotaCounterDelta {
  requestsMinute?: number;
  requestsDay?: number;
  tokensDay?: number;
  spendUsd?: number;
}

export interface IQuotaRepository {
  findByApiKeyId(apiKeyId: string): Promise<ApiKeyQuotaRecord | null>;
  createQuota(data: CreateQuotaDto): Promise<ApiKeyQuotaRecord>;
  updateQuota(apiKeyId: string, data: UpdateQuotaDto): Promise<ApiKeyQuotaRecord>;
  updateCounters(apiKeyId: string, delta: QuotaCounterDelta): Promise<ApiKeyQuotaRecord>;
  resetMinuteCounter(apiKeyId: string, resetTime: Date): Promise<ApiKeyQuotaRecord>;
  resetDayCounter(apiKeyId: string, resetTime: Date): Promise<ApiKeyQuotaRecord>;
  resetMonthCounter(apiKeyId: string, resetTime: Date): Promise<ApiKeyQuotaRecord>;
}

export class PrismaQuotaRepository implements IQuotaRepository {
  async findByApiKeyId(apiKeyId: string): Promise<ApiKeyQuotaRecord | null> {
    const record = await prisma.apiKeyQuota.findUnique({
      where: { apiKeyId },
    });
    if (!record) return null;
    return {
      ...record,
      monthlyBudgetUsd: Number(record.monthlyBudgetUsd),
      currentSpendUsd: Number(record.currentSpendUsd),
    };
  }

  async createQuota(data: CreateQuotaDto): Promise<ApiKeyQuotaRecord> {
    const created = await prisma.apiKeyQuota.create({
      data: {
        apiKeyId: data.apiKeyId,
        requestsPerMinute: data.requestsPerMinute,
        requestsPerDay: data.requestsPerDay,
        tokensPerDay: data.tokensPerDay,
        monthlyBudgetUsd: data.monthlyBudgetUsd,
      },
    });

    return {
      ...created,
      monthlyBudgetUsd: Number(created.monthlyBudgetUsd),
      currentSpendUsd: Number(created.currentSpendUsd),
    };
  }

  async updateQuota(apiKeyId: string, data: UpdateQuotaDto): Promise<ApiKeyQuotaRecord> {
    const updated = await prisma.apiKeyQuota.update({
      where: { apiKeyId },
      data: {
        ...(data.requestsPerMinute ? { requestsPerMinute: data.requestsPerMinute } : {}),
        ...(data.requestsPerDay ? { requestsPerDay: data.requestsPerDay } : {}),
        ...(data.tokensPerDay ? { tokensPerDay: data.tokensPerDay } : {}),
        ...(data.monthlyBudgetUsd ? { monthlyBudgetUsd: data.monthlyBudgetUsd } : {}),
      },
    });

    return {
      ...updated,
      monthlyBudgetUsd: Number(updated.monthlyBudgetUsd),
      currentSpendUsd: Number(updated.currentSpendUsd),
    };
  }

  async updateCounters(apiKeyId: string, delta: QuotaCounterDelta): Promise<ApiKeyQuotaRecord> {
    const updated = await prisma.apiKeyQuota.update({
      where: { apiKeyId },
      data: {
        currentRequestsMinute: { increment: Math.max(0, delta.requestsMinute ?? 0) },
        currentRequestsDay: { increment: Math.max(0, delta.requestsDay ?? 0) },
        currentTokensDay: { increment: Math.max(0, delta.tokensDay ?? 0) },
        currentSpendUsd: { increment: Math.max(0, delta.spendUsd ?? 0) },
      },
    });

    return {
      ...updated,
      monthlyBudgetUsd: Number(updated.monthlyBudgetUsd),
      currentSpendUsd: Number(updated.currentSpendUsd),
    };
  }

  async resetMinuteCounter(apiKeyId: string, resetTime: Date): Promise<ApiKeyQuotaRecord> {
    const updated = await prisma.apiKeyQuota.update({
      where: { apiKeyId },
      data: {
        currentRequestsMinute: 0,
        resetMinuteAt: resetTime,
      },
    });

    return {
      ...updated,
      monthlyBudgetUsd: Number(updated.monthlyBudgetUsd),
      currentSpendUsd: Number(updated.currentSpendUsd),
    };
  }

  async resetDayCounter(apiKeyId: string, resetTime: Date): Promise<ApiKeyQuotaRecord> {
    const updated = await prisma.apiKeyQuota.update({
      where: { apiKeyId },
      data: {
        currentRequestsDay: 0,
        currentTokensDay: 0,
        resetDayAt: resetTime,
      },
    });

    return {
      ...updated,
      monthlyBudgetUsd: Number(updated.monthlyBudgetUsd),
      currentSpendUsd: Number(updated.currentSpendUsd),
    };
  }

  async resetMonthCounter(apiKeyId: string, resetTime: Date): Promise<ApiKeyQuotaRecord> {
    const updated = await prisma.apiKeyQuota.update({
      where: { apiKeyId },
      data: {
        currentSpendUsd: 0,
        resetMonthAt: resetTime,
      },
    });

    return {
      ...updated,
      monthlyBudgetUsd: Number(updated.monthlyBudgetUsd),
      currentSpendUsd: Number(updated.currentSpendUsd),
    };
  }
}
