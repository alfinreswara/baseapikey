import type { FastifyReply, FastifyRequest } from 'fastify';

import { getRequestUser } from '../../auth/middleware/auth.middleware';
import {
  parseUsageHistoryQuery,
  parseUsageSummaryQuery,
  parseUsageTimeseriesQuery,
} from '../dto/usage-analytics.dto';
import type { UsageAnalyticsService } from '../services/usage-analytics.service';

export class UsageAnalyticsController {
  constructor(private readonly usageAnalyticsService: UsageAnalyticsService) {}

  async getTimeseries(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const query = parseUsageTimeseriesQuery(request.query);
    const response = await this.usageAnalyticsService.getTimeseries(
      user.userId,
      query,
      user.activeOrganizationId,
    );
    this.sendPrivate(reply, response);
  }

  async getSummary(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const query = parseUsageSummaryQuery(request.query);
    const response = await this.usageAnalyticsService.getSummary(
      user.userId,
      query,
      user.activeOrganizationId,
    );
    this.sendPrivate(reply, response);
  }

  async getHistory(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = getRequestUser(request);
    const query = parseUsageHistoryQuery(request.query);
    const response = await this.usageAnalyticsService.getHistory(
      user.userId,
      query,
      user.activeOrganizationId,
    );
    this.sendPrivate(reply, response);
  }

  private sendPrivate(reply: FastifyReply, payload: unknown): void {
    void reply.header('Cache-Control', 'private, no-store').send(payload);
  }
}
