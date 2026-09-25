import { z } from 'zod';

export const LoginRequestSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginRequestDto = z.infer<typeof LoginRequestSchema>;

export interface LoginUserDto {
  id: string;
  email: string;
  username: string;
  fullName: string;
  role: string;
}

export interface LoginResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tokenType: string;
  user: LoginUserDto;
}
