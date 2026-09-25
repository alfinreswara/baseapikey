import { z } from 'zod';

export const CreateUsageRecordSchema = z.object({
  userId: z.string().uuid(),
  apiKeyId: z.string().uuid(),
  organizationId: z.string().uuid().nullable().optional(),
  provider: z.string().max(100).default('default'),
  model: z.string().max(100).default('default'),
  endpoint: z.string().max(255),
  method: z.string().max(10).default('GET'),
  requestId: z.string().max(255),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  estimatedCost: z.number().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative(),
  statusCode: z.number().int(),
  clientIp: z.string().max(45).nullable().optional(),
  userAgent: z.string().nullable().optional(),
});

export type CreateUsageRecordDto = z.infer<typeof CreateUsageRecordSchema>;

export interface UsageRecordResponseDto {
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
  status: 'SUCCESS' | 'FAILED';
  clientIp: string | null;
  userAgent: string | null;
  createdAt: string;
}
