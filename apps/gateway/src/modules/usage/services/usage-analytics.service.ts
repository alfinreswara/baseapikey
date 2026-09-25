import type {
  UsageAnalyticsFilters,
  UsageHistoryQuery,
  UsageHistoryResponseDto,
  UsageSummaryDto,
  UsageTimeseriesPointDto,
  UsageTimeseriesQuery,
} from '../dto/usage-analytics.dto';
import type { IUsageAnalyticsRepository } from '../repositories/usage-analytics.repository';

export class UsageAnalyticsService {
  constructor(private readonly repository: IUsageAnalyticsRepository) {}

  async getTimeseries(
    userId: string,
    query: UsageTimeseriesQuery,
    organizationId?: string,
  ): Promise<UsageTimeseriesPointDto[]> {
    return this.repository.getTimeseries(userId, query, query.groupBy, organizationId);
  }

  async getSummary(
    userId: string,
    filters: UsageAnalyticsFilters,
    organizationId?: string,
  ): Promise<UsageSummaryDto> {
    const summary = await this.repository.getSummary(userId, filters, organizationId);
    return {
      period: {
        from: filters.from.toISOString(),
        to: filters.to.toISOString(),
      },
      totals: {
        requests: summary.requests,
        successfulRequests: summary.successfulRequests,
        failedRequests: summary.failedRequests,
        promptTokens: summary.promptTokens,
        completionTokens: summary.completionTokens,
        totalTokens: summary.totalTokens,
        cost: summary.cost,
        averageLatencyMs: summary.averageLatencyMs,
      },
      byModel: summary.byModel,
      byProvider: summary.byProvider,
    };
  }

  async getHistory(
    userId: string,
    query: UsageHistoryQuery,
    organizationId?: string,
  ): Promise<UsageHistoryResponseDto> {
    const page = await this.repository.getHistoryPage(
      userId,
      query,
      query.limit,
      query.cursor,
      organizationId,
    );
    return {
      data: page.items,
      pagination: {
        limit: query.limit,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      },
    };
  }
}
