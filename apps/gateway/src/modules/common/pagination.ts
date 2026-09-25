import { ValidationError } from '@baseapikey/shared';
import { z } from 'zod';

export const CursorPaginationSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .passthrough();

export interface CursorPaginationQuery {
  cursor?: string | undefined;
  limit: number;
}

export interface CursorPage<T> {
  data: T[];
  pagination: {
    cursor: string | null;
    limit: number;
    hasMore: boolean;
  };
}

export function parseCursorPagination(input: unknown): CursorPaginationQuery {
  const result = CursorPaginationSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid pagination parameters', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return { cursor: result.data.cursor, limit: result.data.limit };
}

export function toCursorPage<T extends { id: string }>(records: T[], limit: number): CursorPage<T> {
  const hasMore = records.length > limit;
  const data = hasMore ? records.slice(0, limit) : records;
  return {
    data,
    pagination: {
      cursor: hasMore ? (data.at(-1)?.id ?? null) : null,
      limit,
      hasMore,
    },
  };
}
