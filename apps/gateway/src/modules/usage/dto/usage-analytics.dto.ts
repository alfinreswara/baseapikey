import { ValidationError } from '@baseapikey/shared';
import { z } from 'zod';

export type UsageStatusFilter = 'SUCCESS' | 'FAILED';
export type UsageGroupBy = 'day' | 'model' | 'api_key' | 'provider';

export interface UsageAnalyticsFilters {
  from: Date;
  to: Date;
  model?: string | undefined;
  apiKeyId?: string | undefined;
  provider?: string | undefined;
  status?: UsageStatusFilter | undefined;
}

export interface UsageTimeseriesQuery extends UsageAnalyticsFilters {
  groupBy: UsageGroupBy;
}

export interface UsageHistoryQuery extends UsageAnalyticsFilters {
  cursor?: string | undefined;
  limit: number;
}

export interface UsageTimeseriesPointDto {
  date: string;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  tokens: number;
  cost: number;
  averageLatencyMs: number;
  group?: {
    type: Exclude<UsageGroupBy, 'day'>;
    value: string;
  };
}

export interface UsageSummaryDto {
  period: {
    from: string;
    to: string;
  };
  totals: {
    requests: number;
    successfulRequests: number;
    failedRequests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    averageLatencyMs: number;
  };
  byModel: UsageBreakdownDto[];
  byProvider: UsageBreakdownDto[];
}

export interface UsageBreakdownDto {
  value: string;
  requests: number;
  tokens: number;
  cost: number;
}

export interface UsageHistoryItemDto {
  id: string;
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
  status: 'SUCCESS' | 'FAILED';
  createdAt: string;
}

export interface UsageHistoryResponseDto {
  data: UsageHistoryItemDto[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

const IsoTimestampSchema = z.string().datetime({ offset: true });

const DateInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine(isValidDateInput, 'Must be an ISO 8601 date or timestamp');

const BaseUsageQueryShape = {
  from: DateInputSchema.optional(),
  to: DateInputSchema.optional(),
  model_id: z.string().trim().min(1).max(100).optional(),
  api_key_id: z.string().uuid().optional(),
  provider: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['SUCCESS', 'FAILED']).optional(),
};

const UsageTimeseriesQuerySchema = z
  .object({
    ...BaseUsageQueryShape,
    group_by: z.enum(['day', 'model', 'api_key', 'provider']).default('day'),
  })
  .strict();

const UsageSummaryQuerySchema = z.object(BaseUsageQueryShape).strict();

const UsageHistoryQuerySchema = z
  .object({
    ...BaseUsageQueryShape,
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

interface ParsedBaseQuery {
  from?: string | undefined;
  to?: string | undefined;
  model_id?: string | undefined;
  api_key_id?: string | undefined;
  provider?: string | undefined;
  status?: UsageStatusFilter | undefined;
}

export function parseUsageTimeseriesQuery(input: unknown, now = new Date()): UsageTimeseriesQuery {
  const parsed = parseQuery(UsageTimeseriesQuerySchema, input);
  return {
    ...normalizeFilters(parsed, now),
    groupBy: parsed.group_by ?? 'day',
  };
}

export function parseUsageSummaryQuery(input: unknown, now = new Date()): UsageAnalyticsFilters {
  return normalizeFilters(parseQuery(UsageSummaryQuerySchema, input), now);
}

export function parseUsageHistoryQuery(input: unknown, now = new Date()): UsageHistoryQuery {
  const parsed = parseQuery(UsageHistoryQuerySchema, input);
  return {
    ...normalizeFilters(parsed, now),
    cursor: parsed.cursor,
    limit: parsed.limit ?? 20,
  };
}

function parseQuery<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid usage analytics query', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

function normalizeFilters(parsed: ParsedBaseQuery, now: Date): UsageAnalyticsFilters {
  const defaultFrom = new Date(now);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 29);
  defaultFrom.setUTCHours(0, 0, 0, 0);

  const from = parsed.from ? parseDateBoundary(parsed.from, false) : defaultFrom;
  const to = parsed.to ? parseDateBoundary(parsed.to, true) : new Date(now);

  if (from.getTime() > to.getTime()) {
    throw new ValidationError('Usage analytics "from" must not be later than "to"');
  }

  const rangeMs = to.getTime() - from.getTime();
  if (rangeMs > 366 * 24 * 60 * 60 * 1000) {
    throw new ValidationError('Usage analytics date range cannot exceed 366 days');
  }

  return {
    from,
    to,
    model: parsed.model_id,
    apiKeyId: parsed.api_key_id,
    provider: parsed.provider,
    status: parsed.status,
  };
}

function isValidDateInput(value: string): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  return IsoTimestampSchema.safeParse(value).success;
}

function parseDateBoundary(value: string, endOfDay: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  }
  return new Date(value);
}
