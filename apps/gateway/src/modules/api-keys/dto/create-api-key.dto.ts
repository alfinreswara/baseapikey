import { z } from 'zod';

import { PermissionValidator } from '../permissions/permission.validator';

export const CreateApiKeySchema = z.object({
  name: z.string().min(1, 'API key name is required').max(100, 'API key name too long').trim(),
  expiresAt: z
    .string()
    .datetime({ message: 'expiresAt must be a valid ISO 8601 date string' })
    .nullable()
    .optional(),
  permissions: z
    .array(z.string())
    .refine((perms) => perms.every((p) => PermissionValidator.isValidPermission(p)), {
      message: 'Invalid or unsupported API key permission provided',
    })
    .optional(),
});

export type CreateApiKeyDto = z.infer<typeof CreateApiKeySchema>;

export interface CreateApiKeyResponseDto {
  id: string;
  name: string;
  apiKey: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface RotateApiKeyResponseDto {
  id: string;
  name: string;
  apiKey: string;
  rotatedAt: string;
  expiresAt: string | null;
}

export interface ApiKeyResponseDto {
  id: string;
  name: string;
  keyPrefix: string;
  status: string;
  permissions: unknown;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export const ApiKeyParamSchema = z.object({
  id: z.string().min(1, 'API Key ID is required').trim(),
});

export type ApiKeyParamDto = z.infer<typeof ApiKeyParamSchema>;

export const UpdateApiKeySchema = z
  .object({
    name: z
      .string()
      .min(1, 'API key name is required')
      .max(100, 'API key name too long')
      .trim()
      .optional(),
    expiresAt: z
      .string()
      .datetime({ message: 'expiresAt must be a valid ISO 8601 date string' })
      .nullable()
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.expiresAt !== undefined, {
    message: 'At least one field (name or expiresAt) must be provided for update',
  });

export type UpdateApiKeyDto = z.infer<typeof UpdateApiKeySchema>;

export const UpdateApiKeyPermissionsSchema = z.object({
  permissions: z
    .array(z.string({ invalid_type_error: 'Permissions must be an array of strings' }))
    .refine((perms) => perms.every((p) => PermissionValidator.isValidPermission(p)), {
      message: 'Invalid or unsupported API key permission provided',
    }),
});

export type UpdateApiKeyPermissionsDto = z.infer<typeof UpdateApiKeyPermissionsSchema>;
