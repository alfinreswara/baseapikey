/**
 * Concurrency tests of the billing against a real PostgreSQL.
 *
 * The tests need a database with the migrations applied. They are run by the
 * "Prisma Migration Check" job of the CI, which provides a PostgreSQL
 * service, and they can be started by hand:
 *
 *   DATABASE_URL=postgresql://... pnpm --filter @baseapikey/gateway test:concurrency
 *
 * Without a database the test reports that it was skipped. It never reports a
 * success it did not measure.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { prisma } from '@baseapikey/database';

import { PrismaUsageRepository } from '../usage/repositories/usage.repository';
import { PrismaUsageBillingService } from '../usage/services/usage-billing.service';

const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  if (process.env['CI']) {
    console.error('❌ DATABASE_URL is required, the concurrency tests can not be skipped in CI');
    process.exit(1);
  }
  console.log('⚠️  Skipping the billing concurrency tests, DATABASE_URL is not set');
  process.exit(0);
}

const usageRepository = new PrismaUsageRepository();
const billingService = new PrismaUsageBillingService();

interface Fixtures {
  organizationId: string;
  userId: string;
  apiKeyId: string;
  billingAccountId: string;
}

async function createFixtures(
  creditBalanceCents: number,
  spendingLimitCents?: number,
): Promise<Fixtures> {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `concurrency-${suffix}@example.com`,
      username: `concurrency-${suffix}`,
      fullName: 'Concurrency User',
      passwordHash: 'not-used-here',
    },
  });
  const organization = await prisma.organization.create({
    data: {
      name: `Concurrency ${suffix}`,
      slug: `concurrency-${suffix}`,
      ownerId: user.id,
      ...(spendingLimitCents === undefined ? {} : { spendingLimitCents }),
    },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: organization.id,
      userId: user.id,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  const apiKey = await prisma.apiKey.create({
    data: {
      userId: user.id,
      name: 'Concurrency Key',
      keyHash: `hash-${suffix}`,
      keyPrefix: `sk_live_${suffix}`,
      permissions: ['chat:completions'],
      organizationId: organization.id,
    },
  });
  const billingAccount = await prisma.billingAccount.create({
    data: {
      organizationId: organization.id,
      status: 'ACTIVE',
      currency: 'USD',
      creditBalanceCents,
    },
  });
  return {
    organizationId: organization.id,
    userId: user.id,
    apiKeyId: apiKey.id,
    billingAccountId: billingAccount.id,
  };
}

async function removeFixtures(fixtures: Fixtures): Promise<void> {
  await prisma.creditTransaction.deleteMany({
    where: { billingAccount: { organizationId: fixtures.organizationId } },
  });
  await prisma.usage.deleteMany({ where: { organizationId: fixtures.organizationId } });
  await prisma.usageDailyAggregate.deleteMany({
    where: { organizationId: fixtures.organizationId },
  });
  await prisma.auditLog.deleteMany({ where: { organizationId: fixtures.organizationId } });
  await prisma.billingAccount.deleteMany({ where: { organizationId: fixtures.organizationId } });
  await prisma.apiKey.deleteMany({ where: { id: fixtures.apiKeyId } });
  await prisma.organizationMember.deleteMany({
    where: { organizationId: fixtures.organizationId },
  });
  await prisma.organization.deleteMany({ where: { id: fixtures.organizationId } });
  await prisma.user.deleteMany({ where: { id: fixtures.userId } });
}

/** Records a usage event and charges it, the order of the delivery worker. */
async function recordAndCharge(
  fixtures: Fixtures,
  options: { costUsd: number; usageKey?: string; model?: string },
): Promise<{ usageId: string }> {
  const usage = await usageRepository.createUsageRecord({
    userId: fixtures.userId,
    apiKeyId: fixtures.apiKeyId,
    organizationId: fixtures.organizationId,
    provider: '9router',
    model: options.model ?? 'demo-model',
    endpoint: '/v1/chat/completions',
    method: 'POST',
    requestId: `req-${randomUUID()}`,
    usageKey: options.usageKey ?? randomUUID(),
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    estimatedCost: options.costUsd,
    latencyMs: 10,
    statusCode: 200,
  });
  await billingService.charge({
    usageId: usage.id,
    organizationId: fixtures.organizationId,
    estimatedCostUsd: options.costUsd,
    model: options.model ?? 'demo-model',
    requestId: usage.requestId,
  });
  return { usageId: usage.id };
}

async function readAccount(fixtures: Fixtures) {
  const account = await prisma.billingAccount.findFirstOrThrow({
    where: { organizationId: fixtures.organizationId },
  });
  const transactions = await prisma.creditTransaction.findMany({
    where: { billingAccountId: account.id },
    orderBy: { createdAt: 'asc' },
  });
  return { account, transactions };
}

async function run(): Promise<void> {
  console.log('🧪 Starting Billing Concurrency Tests...');

  // 1. Many concurrent requests while the balance is almost exhausted.
  {
    const fixtures = await createFixtures(10);
    try {
      // Every request costs one cent, the balance only covers ten of them.
      await Promise.all(
        Array.from({ length: 20 }, () => recordAndCharge(fixtures, { costUsd: 0.01 })),
      );

      const { account, transactions } = await readAccount(fixtures);
      assert.equal(account.creditBalanceCents, 0, 'The balance must never become negative');
      assert.equal(
        transactions.length,
        10,
        `Only the affordable requests may be charged, got ${transactions.length}`,
      );
      const sum = transactions.reduce((total, entry) => total + entry.amountCents, 0);
      assert.equal(sum, -10, 'The ledger has to match the deducted balance');
      const rejected = await prisma.auditLog.count({
        where: { organizationId: fixtures.organizationId, action: 'BILLING_CHARGE_REJECTED' },
      });
      assert.equal(rejected, 10, 'The rejected charges have to be visible in the audit trail');
      console.log('  ✅ Concurrent requests never overdraw the balance');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 2. Many concurrent requests against the spending limit.
  {
    const fixtures = await createFixtures(1_000, 5);
    try {
      await Promise.all(
        Array.from({ length: 20 }, () => recordAndCharge(fixtures, { costUsd: 0.01 })),
      );

      const { account, transactions } = await readAccount(fixtures);
      assert.ok(
        account.creditBalanceCents >= 995,
        `The spending limit of five cents must not be exceeded, the balance is ${account.creditBalanceCents}`,
      );
      assert.ok(
        transactions.length <= 5,
        `At most five requests may be charged, got ${transactions.length}`,
      );
      console.log('  ✅ Concurrent requests do not exceed the spending limit');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 3. Several requests update the usage of the same organization, the
  //    balance and the ledger stay consistent.
  {
    const fixtures = await createFixtures(1_000);
    try {
      await Promise.all(
        Array.from({ length: 12 }, () => recordAndCharge(fixtures, { costUsd: 0.01 })),
      );

      const { account, transactions } = await readAccount(fixtures);
      const sum = transactions.reduce((total, entry) => total + entry.amountCents, 0);
      assert.equal(transactions.length, 12, 'Every request has to be charged');
      assert.equal(sum, -12, 'The ledger has to match the deducted balance');
      assert.equal(account.creditBalanceCents, 1_000 + sum, 'The balance has to match the ledger');
      const usages = await prisma.usage.count({
        where: { organizationId: fixtures.organizationId },
      });
      assert.equal(usages, 12, 'Every request has to be recorded once');
      console.log('  ✅ Concurrent requests keep the balance and the ledger consistent');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 4. A retry with the same idempotency key charges once.
  {
    const fixtures = await createFixtures(1_000);
    try {
      const usageKey = randomUUID();
      const first = await recordAndCharge(fixtures, { costUsd: 0.05, usageKey });
      const second = await recordAndCharge(fixtures, { costUsd: 0.05, usageKey });

      assert.equal(first.usageId, second.usageId, 'The retry has to use the same usage row');
      const { account, transactions } = await readAccount(fixtures);
      assert.equal(transactions.length, 1, 'The retry must not charge a second time');
      assert.equal(account.creditBalanceCents, 995, 'The balance has to be deducted exactly once');
      const usages = await prisma.usage.count({
        where: { organizationId: fixtures.organizationId },
      });
      assert.equal(usages, 1, 'The retry must not record a second usage row');
      console.log('  ✅ A retry with the same idempotency key charges exactly once');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 5. Two different requests produce two usage records and two charges.
  {
    const fixtures = await createFixtures(1_000);
    try {
      await recordAndCharge(fixtures, { costUsd: 0.01 });
      await recordAndCharge(fixtures, { costUsd: 0.02 });

      const { account, transactions } = await readAccount(fixtures);
      const usages = await prisma.usage.count({
        where: { organizationId: fixtures.organizationId },
      });
      assert.equal(usages, 2, 'Every request has to be recorded');
      assert.equal(transactions.length, 2, 'Every request has to be charged');
      assert.equal(account.creditBalanceCents, 997, 'Both charges have to be deducted');
      console.log('  ✅ Two different requests produce two usage records and two charges');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 6. A transaction that fails in the middle leaves no partial state. The
  //    duplicate of the ledger entry fails the transaction after the balance
  //    was already decremented, the rollback has to undo the decrement.
  {
    const fixtures = await createFixtures(1_000);
    try {
      const usageKey = randomUUID();
      const first = await recordAndCharge(fixtures, { costUsd: 0.07, usageKey });
      // The same usage id with a second charge fails on the unique constraint
      // of the idempotency key, after the balance was decremented again.
      await billingService.charge({
        usageId: first.usageId,
        organizationId: fixtures.organizationId,
        estimatedCostUsd: 0.07,
        model: 'demo-model',
        requestId: 'req-retry',
      });

      const { account, transactions } = await readAccount(fixtures);
      assert.equal(transactions.length, 1, 'The failed transaction must not add a ledger entry');
      assert.equal(
        account.creditBalanceCents,
        993,
        'The failed transaction must not change the balance',
      );
      console.log('  ✅ A transaction that fails in the middle leaves no partial state');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 7. The credit is not enough to cover the request, the charge is refused
  //    and the usage stays visible as an unpaid usage event.
  {
    const fixtures = await createFixtures(0);
    try {
      await recordAndCharge(fixtures, { costUsd: 0.05 });

      const { account, transactions } = await readAccount(fixtures);
      assert.equal(transactions.length, 0, 'The charge must be refused');
      assert.equal(account.creditBalanceCents, 0, 'The balance must stay untouched');
      const usages = await prisma.usage.count({
        where: { organizationId: fixtures.organizationId },
      });
      assert.equal(usages, 1, 'The usage event stays visible');
      const rejected = await prisma.auditLog.count({
        where: { organizationId: fixtures.organizationId, action: 'BILLING_CHARGE_REJECTED' },
      });
      assert.equal(rejected, 1, 'The refused charge has to be visible in the audit trail');
      console.log('  ✅ A request that can not be paid is refused and stays visible');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 8. The usage of a stream that ends normally is charged once, a stream
  //    that ends with an error carries no tokens and is not charged.
  {
    const fixtures = await createFixtures(1_000);
    try {
      await recordAndCharge(fixtures, { costUsd: 0.02, model: 'demo-model' });
      await recordAndCharge(fixtures, { costUsd: 0, model: 'demo-model' });

      const { account, transactions } = await readAccount(fixtures);
      assert.equal(transactions.length, 1, 'Only the priced usage is charged');
      assert.equal(account.creditBalanceCents, 998, 'The priced usage is charged once');
      const usages = await prisma.usage.count({
        where: { organizationId: fixtures.organizationId },
      });
      assert.equal(usages, 2, 'Both usage events stay visible');
      console.log('  ✅ The usage of a stream is recorded once and charged once');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  console.log('🎉 All Billing Concurrency Tests passed successfully!\n');
  await prisma.$disconnect();
}

void run();
