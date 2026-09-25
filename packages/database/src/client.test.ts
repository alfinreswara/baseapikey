import { createPrismaClient } from './client';

const client = createPrismaClient();
if (!client || typeof client.$disconnect !== 'function') {
  throw new Error('createPrismaClient did not return a valid PrismaClient instance');
}

console.log('Prisma client foundation test passed successfully.');
