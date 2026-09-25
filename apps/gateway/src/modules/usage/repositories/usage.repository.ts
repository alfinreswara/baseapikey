import { prisma } from '@baseapikey/database';

import type { CreateUsageRecordDto } from '../dto/usage.dto';

export interface UsageRecordEntity {
  id: string;
  userId: string;
  apiKeyId: string;
  provider: string;
  model: string;
  endpoint: string;
  requestId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  latencyMs: number;
  statusCode: number;
  clientIp: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface IUsageRepository {
  createUsageRecord(data: CreateUsageRecordDto): Promise<UsageRecordEntity>;
  findByUserId(userId: string): Promise<UsageRecordEntity[]>;
  findByApiKeyId(apiKeyId: string): Promise<UsageRecordEntity[]>;
}

export class PrismaUsageRepository implements IUsageRepository {
  async createUsageRecord(data: CreateUsageRecordDto): Promise<UsageRecordEntity> {
    const created = await prisma.$transaction(async (tx) => {
      const record = await tx.usage.create({
        data: {
          userId: data.userId,
          apiKeyId: data.apiKeyId,
          organizationId: data.organizationId ?? null,
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
        },
      });
      if (data.organizationId) {
        const date = new Date(record.createdAt);
        date.setUTCHours(0, 0, 0, 0);
        await tx.usageDailyAggregate.upsert({
          where: {
            organizationId_date_provider_model: {
              organizationId: data.organizationId,
              date,
              provider: data.provider,
              model: data.model,
            },
          },
          create: {
            organizationId: data.organizationId,
            date,
            provider: data.provider,
            model: data.model,
            requestCount: 1,
            successfulCount: data.statusCode < 400 ? 1 : 0,
            failedCount: data.statusCode >= 400 ? 1 : 0,
            promptTokens: data.promptTokens,
            completionTokens: data.completionTokens,
            totalTokens: data.totalTokens,
            estimatedCost: data.estimatedCost,
            latencyTotalMs: data.latencyMs,
          },
          update: {
            requestCount: { increment: 1 },
            successfulCount: { increment: data.statusCode < 400 ? 1 : 0 },
            failedCount: { increment: data.statusCode >= 400 ? 1 : 0 },
            promptTokens: { increment: data.promptTokens },
            completionTokens: { increment: data.completionTokens },
            totalTokens: { increment: data.totalTokens },
            estimatedCost: { increment: data.estimatedCost },
            latencyTotalMs: { increment: data.latencyMs },
          },
        });
      }
      return record;
    });

    return {
      ...created,
      estimatedCost: Number(created.estimatedCost),
    };
  }

  async findByUserId(userId: string): Promise<UsageRecordEntity[]> {
    const list = await prisma.usage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((u) => ({ ...u, estimatedCost: Number(u.estimatedCost) }));
  }

  async findByApiKeyId(apiKeyId: string): Promise<UsageRecordEntity[]> {
    const list = await prisma.usage.findMany({
      where: { apiKeyId },
      orderBy: { createdAt: 'desc' },
    });
    return list.map((u) => ({ ...u, estimatedCost: Number(u.estimatedCost) }));
  }
}
