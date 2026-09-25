import { ValidationError } from '@baseapikey/shared';
import { z } from 'zod';

export const StrongPasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(256, 'Password must not exceed 256 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

export const UpdateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100).optional(),
    avatarUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
        message: 'Avatar URL must use HTTP or HTTPS',
      })
      .nullable()
      .optional(),
  })
  .strict()
  .refine((value) => value.fullName !== undefined || value.avatarUrl !== undefined, {
    message: 'At least one profile field must be provided',
  });

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: StrongPasswordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'New password must differ from the current password',
  });

export const PasswordResetRequestSchema = z
  .object({ email: z.string().trim().email().max(255) })
  .strict();

export const AccountTokenConfirmationSchema = z
  .object({ token: z.string().trim().min(32).max(256) })
  .strict();

export const PasswordResetConfirmationSchema = z
  .object({
    token: z.string().trim().min(32).max(256),
    newPassword: StrongPasswordSchema,
  })
  .strict();

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;
export type PasswordResetRequestDto = z.infer<typeof PasswordResetRequestSchema>;
export type AccountTokenConfirmationDto = z.infer<typeof AccountTokenConfirmationSchema>;
export type PasswordResetConfirmationDto = z.infer<typeof PasswordResetConfirmationSchema>;

export interface AccountProfileDto {
  id: string;
  email: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function parseAccountDto<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError('Invalid account request', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
