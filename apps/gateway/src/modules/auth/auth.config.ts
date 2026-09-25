import { parseGatewayEnv } from '@baseapikey/shared/env';

import { AuthConfigError } from './errors/auth.errors';
import type { AuthConfig } from './types/auth.types';

export function loadAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig {
  try {
    const isProduction = env['NODE_ENV'] === 'production';
    const mergedEnv = {
      ...(!isProduction
        ? {
            DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/baseapikey',
            REDIS_URL: 'redis://localhost:6379',
            NINE_ROUTER_API_KEY: 'test-nine-router-key',
            JWT_ACCESS_SECRET: 'test-jwt-access-secret-minimum-32-chars-long',
            JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-minimum-32-chars-long',
            JWT_ACCESS_EXPIRES_IN: '15m',
            JWT_REFRESH_EXPIRES_IN: '7d',
          }
        : {}),
      ...env,
    };
    const parsed = parseGatewayEnv(mergedEnv);
    return {
      jwtAccessSecret: parsed.JWT_ACCESS_SECRET,
      jwtRefreshSecret: parsed.JWT_REFRESH_SECRET,
      jwtAccessExpiresIn: parsed.JWT_ACCESS_EXPIRES_IN,
      jwtRefreshExpiresIn: parsed.JWT_REFRESH_EXPIRES_IN,
    };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new AuthConfigError(error.message);
    }
    throw new AuthConfigError('Failed to load authentication configuration');
  }
}
