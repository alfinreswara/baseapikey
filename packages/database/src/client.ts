import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const DEFAULT_DATABASE_POOL_SIZE = 5;

/**
 * Adds the configured pool size to the database URL.
 *
 * The pool size is configured with DATABASE_POOL_SIZE. Without it the client
 * would use its own default, which is derived from the number of CPUs of the
 * node and not from the configuration of the deployment.
 */
export function buildDatasourceUrl(
  url: string | undefined,
  poolSize: number | undefined,
): string | undefined {
  if (!url) return url;
  const limit =
    poolSize !== undefined && Number.isSafeInteger(poolSize) && poolSize > 0
      ? poolSize
      : DEFAULT_DATABASE_POOL_SIZE;
  if (/[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${limit}`;
}

export function createPrismaClient(): PrismaClient {
  const poolSize = Number(process.env['DATABASE_POOL_SIZE'] ?? String(DEFAULT_DATABASE_POOL_SIZE));
  const datasourceUrl = buildDatasourceUrl(process.env['DATABASE_URL'], poolSize);
  return new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
    ...(datasourceUrl ? { datasourceUrl } : {}),
  });
}

export const prisma = global.prisma || createPrismaClient();

if (process.env['NODE_ENV'] !== 'production') {
  global.prisma = prisma;
}

export * from '@prisma/client';
