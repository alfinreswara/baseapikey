import assert from 'node:assert/strict';

import { buildDatasourceUrl, createPrismaClient, DEFAULT_DATABASE_POOL_SIZE } from './client';

const client = createPrismaClient();
if (!client || typeof client.$disconnect !== 'function') {
  throw new Error('createPrismaClient did not return a valid PrismaClient instance');
}

console.log('Prisma client foundation test passed successfully.');

// The configured pool size has to reach the Prisma client, otherwise the
// number of database connections of a deployment is decided by the number of
// CPUs of the node instead of by the configuration.
assert.equal(
  buildDatasourceUrl('postgresql://user:password@127.0.0.1:5432/baseapikey', 7),
  'postgresql://user:password@127.0.0.1:5432/baseapikey?connection_limit=7',
);
assert.equal(
  buildDatasourceUrl('postgresql://user:password@127.0.0.1:5432/baseapikey?schema=public', 3),
  'postgresql://user:password@127.0.0.1:5432/baseapikey?schema=public&connection_limit=3',
);
assert.equal(
  buildDatasourceUrl('postgresql://user:password@127.0.0.1:5432/baseapikey?connection_limit=9', 3),
  'postgresql://user:password@127.0.0.1:5432/baseapikey?connection_limit=9',
);
assert.equal(
  buildDatasourceUrl('postgresql://user:password@127.0.0.1:5432/baseapikey', undefined),
  `postgresql://user:password@127.0.0.1:5432/baseapikey?connection_limit=${DEFAULT_DATABASE_POOL_SIZE}`,
);
assert.equal(buildDatasourceUrl(undefined, 5), undefined);
console.log('Prisma client pool configuration test passed successfully.');
