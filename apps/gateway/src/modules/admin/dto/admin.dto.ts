import { AuditSeverity, ModelCategory, ProviderStatus } from '@baseapikey/database';
import { ValidationError } from '@baseapikey/shared';
import { z } from 'zod';

const UrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));

export const AdminIdParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const CreateProviderSchema = z
  .object({
    name: z.string().trim().min(2).max(255),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    baseUrl: UrlSchema,
    apiVersion: z.string().trim().max(50).nullable().optional(),
    apiKey: z.string().trim().min(1).max(4096),
    status: z.nativeEnum(ProviderStatus).optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    timeoutMs: z.number().int().min(1000).max(300_000).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    supportsStreaming: z.boolean().optional(),
    supportsImages: z.boolean().optional(),
    supportsEmbeddings: z.boolean().optional(),
    supportsAudio: z.boolean().optional(),
    supportsVision: z.boolean().optional(),
  })
  .strict();

export const UpdateProviderSchema = CreateProviderSchema.partial()
  .omit({ slug: true })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const CreateModelSchema = z
  .object({
    providerId: z.string().uuid(),
    name: z.string().trim().min(1).max(255),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9._:-]+$/)
      .max(100),
    displayName: z.string().trim().min(1).max(255),
    category: z.nativeEnum(ModelCategory).optional(),
    contextWindow: z.number().int().positive().max(100_000_000),
    maxOutputTokens: z.number().int().positive().max(10_000_000),
    inputPricePerMillion: z.number().nonnegative().max(1_000_000),
    outputPricePerMillion: z.number().nonnegative().max(1_000_000),
    supportsStreaming: z.boolean().optional(),
    supportsVision: z.boolean().optional(),
    supportsFunctionCalling: z.boolean().optional(),
    supportsJsonMode: z.boolean().optional(),
    supportsReasoning: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const UpdateModelSchema = CreateModelSchema.omit({ providerId: true, slug: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const AuditQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    action: z.string().trim().max(100).optional(),
    severity: z.nativeEnum(AuditSeverity).optional(),
    userId: z.string().uuid().optional(),
    organizationId: z.string().uuid().optional(),
  })
  .strict();

export type CreateProviderDto = z.infer<typeof CreateProviderSchema>;
export type UpdateProviderDto = z.infer<typeof UpdateProviderSchema>;
export type CreateModelDto = z.infer<typeof CreateModelSchema>;
export type UpdateModelDto = z.infer<typeof UpdateModelSchema>;
export type AuditQueryDto = z.infer<typeof AuditQuerySchema>;

export function parseAdminDto<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid admin request', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
