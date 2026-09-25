import { z } from 'zod';

export const DashboardEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    DASHBOARD_PORT: z.coerce.number().int().positive().default(3001),
    DASHBOARD_HOST: z.string().min(1).default('0.0.0.0'),
    DASHBOARD_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
    GATEWAY_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV !== 'production') return;
    if (!env.DASHBOARD_PUBLIC_URL.startsWith('https://')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DASHBOARD_PUBLIC_URL'],
        message: 'DASHBOARD_PUBLIC_URL must use HTTPS in production',
      });
    }
    if (!env.GATEWAY_PUBLIC_URL.startsWith('https://')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['GATEWAY_PUBLIC_URL'],
        message: 'GATEWAY_PUBLIC_URL must use HTTPS in production',
      });
    }
  });

export type DashboardEnv = z.infer<typeof DashboardEnvSchema>;

export function parseDashboardEnv(
  inputEnv: Record<string, string | undefined> = process.env,
): DashboardEnv {
  const result = DashboardEnvSchema.safeParse(inputEnv);

  if (!result.success) {
    const formattedErrors = result.error.errors
      .map((error) => `  - ${error.path.join('.')}: ${error.message}`)
      .join('\n');
    throw new Error(`Invalid Dashboard Environment Variables:\n${formattedErrors}`);
  }

  return result.data;
}
