import { z } from 'zod';

import { DEFAULT_QUOTA_LIMITS } from '../quota.constants';

export const CreateQuotaSchema = z.object({
  apiKeyId: z.string().uuid(),
  requestsPerMinute: z.number().int().positive().default(DEFAULT_QUOTA_LIMITS.REQUESTS_PER_MINUTE),
  requestsPerDay: z.number().int().positive().default(DEFAULT_QUOTA_LIMITS.REQUESTS_PER_DAY),
  tokensPerDay: z.number().int().positive().default(DEFAULT_QUOTA_LIMITS.TOKENS_PER_DAY),
  monthlyBudgetUsd: z.number().positive().default(DEFAULT_QUOTA_LIMITS.MONTHLY_BUDGET_USD),
});

export type CreateQuotaDto = z.infer<typeof CreateQuotaSchema>;

export const UpdateQuotaSchema = z.object({
  requestsPerMinute: z.number().int().positive().optional(),
  requestsPerDay: z.number().int().positive().optional(),
  tokensPerDay: z.number().int().positive().optional(),
  monthlyBudgetUsd: z.number().positive().optional(),
});

export type UpdateQuotaDto = z.infer<typeof UpdateQuotaSchema>;

export interface QuotaResponseDto {
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
  resetMinuteAt: string;
  resetDayAt: string;
  resetMonthAt: string;
  createdAt: string;
  updatedAt: string;
}
