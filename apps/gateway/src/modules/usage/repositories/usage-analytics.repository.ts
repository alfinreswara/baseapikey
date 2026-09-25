import { Prisma, prisma } from '@baseapikey/database';

import type {
  UsageAnalyticsFilters,
  UsageBreakdownDto,
  UsageGroupBy,
  UsageHistoryItemDto,
  UsageTimeseriesPointDto,
} from '../dto/usage-analytics.dto';

export interface UsageAggregateResult {
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  averageLatencyMs: number;
  byModel: UsageBreakdownDto[];
  byProvider: UsageBreakdownDto[];
}

export interface UsageHistoryPageResult {
  items: UsageHistoryItemDto[];
  hasMore: boolean;
  nextCursor: string | null;
}

export interface IUsageAnalyticsRepository {
  getTimeseries(
    userId: string,
    filters: UsageAnalyticsFilters,
    groupBy: UsageGroupBy,
    organizationId?: string,
  ): Promise<UsageTimeseriesPointDto[]>;
  getSummary(
    userId: string,
    filters: UsageAnalyticsFilters,
    organizationId?: string,
  ): Promise<UsageAggregateResult>;
  getHistoryPage(
    userId: string,
    filters: UsageAnalyticsFilters,
    limit: number,
    cursor?: string | undefined,
    organizationId?: string,
  ): Promise<UsageHistoryPageResult>;
}

interface RawTimeseriesRow {
  date: string;
  groupValue: string | null;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  tokens: number;
  cost: number;
  averageLatencyMs: number;
}

export class PrismaUsageAnalyticsRepository implements IUsageAnalyticsRepository {
  async getTimeseries(
    userId: string,
    filters: UsageAnalyticsFilters,
    groupBy: UsageGroupBy,
    organizationId?: string,
  ): Promise<UsageTimeseriesPointDto[]> {
    const conditions = this.buildSqlConditions(userId, filters, organizationId);
    const { selection, grouping } = this.getGroupingSql(groupBy);

    const rows = await prisma.$queryRaw<RawTimeseriesRow[]>(Prisma.sql`
      SELECT
        to_char(date_trunc('day', "created_at" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS "date",
        ${selection},
        COUNT(*)::int AS "requests",
        COUNT(*) FILTER (WHERE "status_code" < 400)::int AS "successfulRequests",
        COUNT(*) FILTER (WHERE "status_code" >= 400)::int AS "failedRequests",
        COALESCE(SUM("total_tokens"), 0)::double precision AS "tokens",
        COALESCE(SUM("estimated_cost"), 0)::double precision AS "cost",
        COALESCE(AVG("latency_ms"), 0)::double precision AS "averageLatencyMs"
      FROM "usages"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY 1 ${grouping}
      ORDER BY 1 ASC, 2 ASC NULLS FIRST
    `);

    return rows.map((row) => ({
      date: row.date,
      requests: Number(row.requests),
      successfulRequests: Number(row.successfulRequests),
      failedRequests: Number(row.failedRequests),
      tokens: Number(row.tokens),
      cost: Number(row.cost),
      averageLatencyMs: Number(row.averageLatencyMs),
      ...(groupBy !== 'day' && row.groupValue !== null
        ? { group: { type: groupBy, value: row.groupValue } }
        : {}),
    }));
  }

  async getSummary(
    userId: string,
    filters: UsageAnalyticsFilters,
    organizationId?: string,
  ): Promise<UsageAggregateResult> {
    const where = this.buildWhere(userId, filters, organizationId);

    const [aggregate, successfulRequests, failedRequests, byModel, byProvider] = await Promise.all([
      prisma.usage.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          promptTokens: true,
          completionTokens: true,
          totalTokens: true,
          estimatedCost: true,
        },
        _avg: { latencyMs: true },
      }),
      prisma.usage.count({ where: { AND: [where, { statusCode: { lt: 400 } }] } }),
      prisma.usage.count({ where: { AND: [where, { statusCode: { gte: 400 } }] } }),
      prisma.usage.groupBy({
        by: ['model'],
        where,
        _count: { _all: true },
        _sum: { totalTokens: true, estimatedCost: true },
      }),
      prisma.usage.groupBy({
        by: ['provider'],
        where,
        _count: { _all: true },
        _sum: { totalTokens: true, estimatedCost: true },
      }),
    ]);

    return {
      requests: aggregate._count._all,
      successfulRequests,
      failedRequests,
      promptTokens: aggregate._sum.promptTokens ?? 0,
      completionTokens: aggregate._sum.completionTokens ?? 0,
      totalTokens: aggregate._sum.totalTokens ?? 0,
      cost: Number(aggregate._sum.estimatedCost ?? 0),
      averageLatencyMs: aggregate._avg.latencyMs ?? 0,
      byModel: byModel
        .map((row) => this.toBreakdown(row.model, row._count._all, row._sum))
        .sort((a, b) => b.cost - a.cost),
      byProvider: byProvider
        .map((row) => this.toBreakdown(row.provider, row._count._all, row._sum))
        .sort((a, b) => b.cost - a.cost),
    };
  }

  async getHistoryPage(
    userId: string,
    filters: UsageAnalyticsFilters,
    limit: number,
    cursor?: string,
    organizationId?: string,
  ): Promise<UsageHistoryPageResult> {
    const records = await prisma.usage.findMany({
      where: this.buildWhere(userId, filters, organizationId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        apiKeyId: true,
        provider: true,
        model: true,
        endpoint: true,
        requestId: true,
        promptTokens: true,
        completionTokens: true,
        totalTokens: true,
        estimatedCost: true,
        latencyMs: true,
        statusCode: true,
        createdAt: true,
      },
    });

    const hasMore = records.length > limit;
    const page = hasMore ? records.slice(0, limit) : records;

    return {
      items: page.map((record) => ({
        id: record.id,
        apiKeyId: record.apiKeyId,
        provider: record.provider,
        model: record.model,
        endpoint: record.endpoint,
        requestId: record.requestId,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        totalTokens: record.totalTokens,
        estimatedCost: Number(record.estimatedCost),
        latencyMs: record.latencyMs,
        statusCode: record.statusCode,
        status: record.statusCode < 400 ? 'SUCCESS' : 'FAILED',
        createdAt: record.createdAt.toISOString(),
      })),
      hasMore,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private buildWhere(
    userId: string,
    filters: UsageAnalyticsFilters,
    organizationId?: string,
  ): Prisma.UsageWhereInput {
    return {
      ...(organizationId ? { organizationId } : { userId }),
      createdAt: { gte: filters.from, lte: filters.to },
      ...(filters.model ? { model: filters.model } : {}),
      ...(filters.apiKeyId ? { apiKeyId: filters.apiKeyId } : {}),
      ...(filters.provider ? { provider: filters.provider } : {}),
      ...(filters.status === 'SUCCESS' ? { statusCode: { lt: 400 } } : {}),
      ...(filters.status === 'FAILED' ? { statusCode: { gte: 400 } } : {}),
    };
  }

  private buildSqlConditions(
    userId: string,
    filters: UsageAnalyticsFilters,
    organizationId?: string,
  ): Prisma.Sql[] {
    const conditions = [
      organizationId
        ? Prisma.sql`"organization_id" = ${organizationId}::uuid`
        : Prisma.sql`"user_id" = ${userId}::uuid`,
      Prisma.sql`"created_at" >= ${filters.from}`,
      Prisma.sql`"created_at" <= ${filters.to}`,
    ];

    if (filters.model) conditions.push(Prisma.sql`"model" = ${filters.model}`);
    if (filters.apiKeyId) conditions.push(Prisma.sql`"api_key_id" = ${filters.apiKeyId}::uuid`);
    if (filters.provider) conditions.push(Prisma.sql`"provider" = ${filters.provider}`);
    if (filters.status === 'SUCCESS') conditions.push(Prisma.sql`"status_code" < 400`);
    if (filters.status === 'FAILED') conditions.push(Prisma.sql`"status_code" >= 400`);

    return conditions;
  }

  private getGroupingSql(groupBy: UsageGroupBy): {
    selection: Prisma.Sql;
    grouping: Prisma.Sql;
  } {
    switch (groupBy) {
      case 'model':
        return { selection: Prisma.sql`"model" AS "groupValue"`, grouping: Prisma.sql`, 2` };
      case 'api_key':
        return {
          selection: Prisma.sql`"api_key_id"::text AS "groupValue"`,
          grouping: Prisma.sql`, 2`,
        };
      case 'provider':
        return { selection: Prisma.sql`"provider" AS "groupValue"`, grouping: Prisma.sql`, 2` };
      case 'day':
        return { selection: Prisma.sql`NULL::text AS "groupValue"`, grouping: Prisma.empty };
    }
  }

  private toBreakdown(
    value: string,
    requests: number,
    totals: { totalTokens: number | null; estimatedCost: Prisma.Decimal | null },
  ): UsageBreakdownDto {
    return {
      value,
      requests,
      tokens: totals.totalTokens ?? 0,
      cost: Number(totals.estimatedCost ?? 0),
    };
  }
}
