import { OrganizationRole } from '@baseapikey/database';
import { ValidationError } from '@baseapikey/shared';
import { z } from 'zod';

const HttpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));

export const CreateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    billingEmail: z.string().trim().email().max(255).optional(),
  })
  .strict();

export const UpdateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    billingEmail: z.string().trim().email().max(255).nullable().optional(),
    spendingLimitCents: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
    logoUrl: HttpUrlSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const InviteOrganizationMemberSchema = z
  .object({
    email: z.string().trim().email().max(255),
    role: z.enum([OrganizationRole.ADMIN, OrganizationRole.MEMBER]).optional(),
  })
  .strict();

export const UpdateOrganizationMemberSchema = z
  .object({ role: z.nativeEnum(OrganizationRole) })
  .strict();

export const OrganizationIdParamsSchema = z.object({ id: z.string().uuid() }).strict();
export const OrganizationMemberParamsSchema = z
  .object({ id: z.string().uuid(), userId: z.string().uuid() })
  .strict();
export const OrganizationInvitationTokenParamsSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,200}$/) })
  .strict();

export type CreateOrganizationDto = z.infer<typeof CreateOrganizationSchema>;
export type UpdateOrganizationDto = z.infer<typeof UpdateOrganizationSchema>;
export type InviteOrganizationMemberDto = z.infer<typeof InviteOrganizationMemberSchema>;
export type UpdateOrganizationMemberDto = z.infer<typeof UpdateOrganizationMemberSchema>;

export function parseOrganizationDto<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid organization request', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
