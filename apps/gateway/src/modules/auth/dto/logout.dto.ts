import { z } from 'zod';

export const LogoutRequestSchema = z.object({
  refreshToken: z.string().optional(),
});

export type LogoutRequestDto = z.infer<typeof LogoutRequestSchema>;

export const LogoutAllRequestSchema = z.object({
  refreshToken: z.string().optional(),
});

export type LogoutAllRequestDto = z.infer<typeof LogoutAllRequestSchema>;
