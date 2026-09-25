export const AUTH_CONSTANTS = {
  TOKEN_TYPE: 'Bearer',
  ALGORITHM: 'HS256' as const,
  ISSUER: 'baseapikey-gateway' as const,
  AUDIENCE: 'baseapikey-api' as const,
  DEFAULT_ACCESS_EXPIRES_IN: '15m',
  DEFAULT_REFRESH_EXPIRES_IN: '7d',
  ARGON2_OPTIONS: {
    memoryCost: 65536, // 64 MB
    timeCost: 3, // 3 iterations
    parallelism: 4,
  },
} as const;
