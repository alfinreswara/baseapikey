import { ValidationError } from '@baseapikey/shared';
import { z } from 'zod';

export const BillingOrganizationParamsSchema = z.object({ id: z.string().uuid() }).strict();

export const CreateCheckoutSchema = z
  .object({
    amountCents: z.number().int().min(500).max(100_000_000),
    successUrl: z.string().url().max(2048),
    cancelUrl: z.string().url().max(2048),
  })
  .strict();

export const BillingWebhookSchema = z
  .object({
    id: z.string().min(1).max(255),
    type: z.enum(['credit.purchased']),
    organizationId: z.string().uuid(),
    amountCents: z.number().int().positive().max(100_000_000),
    currency: z
      .string()
      .length(3)
      .transform((value) => value.toUpperCase()),
    description: z.string().max(500).optional(),
  })
  .strict();

export type CreateCheckoutDto = z.infer<typeof CreateCheckoutSchema>;
export type BillingWebhookDto = z.infer<typeof BillingWebhookSchema>;

export function parseBillingDto<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid billing request', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
