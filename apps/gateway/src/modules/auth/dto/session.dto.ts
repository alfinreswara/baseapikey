import { z } from 'zod';

export const SessionParamsSchema = z.object({
  id: z.string().min(1, 'Session ID is required'),
});

export type SessionParamsDto = z.infer<typeof SessionParamsSchema>;

export const DeleteSessionQuerySchema = z.object({
  confirm: z.coerce.boolean().optional(),
});

export type DeleteSessionQueryDto = z.infer<typeof DeleteSessionQuerySchema>;

export interface SessionItemResponseDto {
  id: string;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  currentSession: boolean;
}

export interface SessionDetailResponseDto {
  id: string;
  userId: string;
  deviceId: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  isRevoked: boolean;
  currentSession: boolean;
}
