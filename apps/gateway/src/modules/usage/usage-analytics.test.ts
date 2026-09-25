import assert from 'node:assert/strict';

import { ValidationError } from '@baseapikey/shared';

import { buildApp } from '../../app';
import { loadAuthConfig } from '../auth/auth.config';
import { JwtService } from '../auth/services/jwt.service';

import {
  parseUsageHistoryQuery,
  parseUsageSummaryQuery,
  parseUsageTimeseriesQuery,
  type UsageAnalyticsFilters,
  type UsageGroupBy,
  type UsageHistoryItemDto,
  type UsageTimeseriesPointDto,
} from './dto/usage-analytics.dto';
import type {
  IUsageAnalyticsRepository,
  UsageAggregateResult,
  UsageHistoryPageResult,
} from './repositories/usage-analytics.repository';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const API_KEY_ID = '22222222-2222-4222-8222-222222222222';
const USAGE_ID = '33333333-3333-4333-8333-333333333333';

class MockUsageAnalyticsRepository implements IUsageAnalyticsRepository {
  lastUserId: string | null = null;
  lastFilters: UsageAnalyticsFilters | null = null;
  lastGroupBy: UsageGroupBy | null = null;
  lastLimit: number | null = null;
  lastCursor: string | undefined;

  async getTimeseries(
    userId: string,
    filters: UsageAnalyticsFilters,
    groupBy: UsageGroupBy,
  ): Promise<UsageTimeseriesPointDto[]> {
    this.capture(userId, filters);
    this.lastGroupBy = groupBy;
    return [
      {
        date: '2026-09-17',
        requests: 3,
        successfulRequests: 2,
        failedRequests: 1,
        tokens: 450,
        cost: 0.012,
        averageLatencyMs: 250,
        ...(groupBy === 'day'
          ? {}
          : { group: { type: groupBy, value: groupBy === 'api_key' ? API_KEY_ID : 'gpt-5' } }),
      },
    ];
  }

  async getSummary(userId: string, filters: UsageAnalyticsFilters): Promise<UsageAggregateResult> {
    this.capture(userId, filters);
    return {
      requests: 3,
      successfulRequests: 2,
      failedRequests: 1,
      promptTokens: 300,
      completionTokens: 150,
      totalTokens: 450,
      cost: 0.012,
      averageLatencyMs: 250,
      byModel: [{ value: 'gpt-5', requests: 3, tokens: 450, cost: 0.012 }],
      byProvider: [{ value: '9router', requests: 3, tokens: 450, cost: 0.012 }],
    };
  }

  async getHistoryPage(
    userId: string,
    filters: UsageAnalyticsFilters,
    limit: number,
    cursor?: string,
  ): Promise<UsageHistoryPageResult> {
    this.capture(userId, filters);
    this.lastLimit = limit;
    this.lastCursor = cursor;
    const item: UsageHistoryItemDto = {
      id: USAGE_ID,
      apiKeyId: API_KEY_ID,
      provider: '9router',
      model: 'gpt-5',
      endpoint: '/v1/chat/completions',
      requestId: 'req_usage_1',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCost: 0.004,
      latencyMs: 220,
      statusCode: 200,
      status: 'SUCCESS',
      createdAt: '2026-09-17T10:00:00.000Z',
    };
    return { items: [item], hasMore: true, nextCursor: USAGE_ID };
  }

  private capture(userId: string, filters: UsageAnalyticsFilters): void {
    this.lastUserId = userId;
    this.lastFilters = filters;
  }
}

async function runUsageAnalyticsTests(): Promise<void> {
  console.log('🧪 Starting Usage Analytics Tests...');

  const now = new Date('2026-09-18T12:00:00.000Z');
  const defaultQuery = parseUsageTimeseriesQuery({}, now);
  assert.equal(defaultQuery.from.toISOString(), '2026-08-20T00:00:00.000Z');
  assert.equal(defaultQuery.to.toISOString(), now.toISOString());
  assert.equal(defaultQuery.groupBy, 'day');

  const filteredQuery = parseUsageTimeseriesQuery(
    {
      from: '2026-09-01',
      to: '2026-09-17',
      model_id: 'gpt-5',
      api_key_id: API_KEY_ID,
      provider: '9router',
      status: 'FAILED',
      group_by: 'model',
    },
    now,
  );
  assert.equal(filteredQuery.from.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(filteredQuery.to.toISOString(), '2026-09-17T23:59:59.999Z');
  assert.equal(filteredQuery.groupBy, 'model');
  assert.equal(filteredQuery.status, 'FAILED');
  assert.throws(
    () => parseUsageSummaryQuery({ from: '2026-09-18', to: '2026-09-01' }, now),
    ValidationError,
  );
  assert.throws(
    () => parseUsageSummaryQuery({ from: '2025-01-01', to: '2026-09-18' }, now),
    /cannot exceed 366 days/,
  );
  assert.throws(
    () => parseUsageSummaryQuery({ from: '2026-09-01T00:00:00' }, now),
    ValidationError,
  );
  assert.throws(() => parseUsageHistoryQuery({ limit: '101' }, now), ValidationError);
  console.log('  ✅ Date defaults, filters, range limits, and pagination bounds are validated');

  const repository = new MockUsageAnalyticsRepository();
  const jwtService = new JwtService(loadAuthConfig());
  const app = buildApp({ usageAnalyticsRepository: repository, jwtService });
  await app.ready();

  const accessToken = jwtService.generateAccessToken({
    userId: USER_ID,
    email: 'analytics@example.com',
    role: 'USER',
  });
  const authHeaders = { authorization: `Bearer ${accessToken}` };

  try {
    const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/usage' });
    assert.equal(unauthorized.statusCode, 401);

    const timeseries = await app.inject({
      method: 'GET',
      url: `/api/v1/usage?from=2026-09-01&to=2026-09-17&model_id=gpt-5&api_key_id=${API_KEY_ID}&group_by=model`,
      headers: authHeaders,
    });
    assert.equal(timeseries.statusCode, 200);
    assert.equal(timeseries.headers['cache-control'], 'private, no-store');
    assert.equal(repository.lastUserId, USER_ID);
    assert.equal(repository.lastFilters?.model, 'gpt-5');
    assert.equal(repository.lastFilters?.apiKeyId, API_KEY_ID);
    assert.equal(repository.lastGroupBy, 'model');
    const timeseriesBody = timeseries.json<UsageTimeseriesPointDto[]>();
    assert.equal(timeseriesBody[0]?.requests, 3);
    assert.deepEqual(timeseriesBody[0]?.group, { type: 'model', value: 'gpt-5' });

    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/usage/summary?from=2026-09-01&to=2026-09-17',
      headers: authHeaders,
    });
    assert.equal(summary.statusCode, 200);
    const summaryBody = summary.json<{ totals: { totalTokens: number; failedRequests: number } }>();
    assert.equal(summaryBody.totals.totalTokens, 450);
    assert.equal(summaryBody.totals.failedRequests, 1);

    const history = await app.inject({
      method: 'GET',
      url: `/api/v1/usage/history?limit=1&cursor=${USAGE_ID}`,
      headers: authHeaders,
    });
    assert.equal(history.statusCode, 200);
    assert.equal(repository.lastLimit, 1);
    assert.equal(repository.lastCursor, USAGE_ID);
    const historyBody = history.json<{
      data: UsageHistoryItemDto[];
      pagination: { hasMore: boolean; nextCursor: string | null };
    }>();
    assert.equal(historyBody.data[0]?.id, USAGE_ID);
    assert.equal(historyBody.pagination.hasMore, true);
    assert.equal(historyBody.pagination.nextCursor, USAGE_ID);
    assert.equal('clientIp' in (historyBody.data[0] ?? {}), false);
    assert.equal('userAgent' in (historyBody.data[0] ?? {}), false);
    console.log('  ✅ JWT-protected chart, summary, and cursor-paginated history endpoints work');

    const attemptedUserOverride = await app.inject({
      method: 'GET',
      url: '/api/v1/usage?user_id=99999999-9999-4999-8999-999999999999',
      headers: authHeaders,
    });
    assert.equal(attemptedUserOverride.statusCode, 400);
    assert.equal(repository.lastUserId, USER_ID);

    const forbiddenToken = jwtService.generateAccessToken({
      userId: USER_ID,
      email: 'guest@example.com',
      role: 'GUEST',
    });
    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v1/usage',
      headers: { authorization: `Bearer ${forbiddenToken}` },
    });
    assert.equal(forbidden.statusCode, 403);
    console.log('  ✅ Query-level user overrides are rejected and usage:read RBAC is enforced');
  } finally {
    await app.close();
  }

  console.log('🎉 All Usage Analytics Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('usage-analytics.test.ts')) {
  void runUsageAnalyticsTests();
}
