import { z } from 'zod';

export const RegisterRequestSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be between 3 and 30 characters')
    .max(30, 'Username must be between 3 and 30 characters')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Username can only contain alphanumeric characters, underscores, and hyphens',
    ),
  fullName: z.string().trim().min(1, 'Full name is required'),
  password: z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
});

export type RegisterRequestDto = z.infer<typeof RegisterRequestSchema>;

export interface RegisterResponseDto {
  id: string;
  email: string;
  username: string;
  fullName: string;
  createdAt: Date;
}
