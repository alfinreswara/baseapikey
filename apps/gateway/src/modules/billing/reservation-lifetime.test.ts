/**
 * Tests of the lifetime of a credit reservation against a real PostgreSQL.
 *
 * A reservation must not release the credit of a request that is still
 * running, and a request that really ended must not hold its credit forever.
 *
 *   DATABASE_URL=postgresql://... pnpm --filter @baseapikey/gateway test:reservation
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { prisma } from '@baseapikey/database';

import { PrismaUsageRepository } from '../usage/repositories/usage.repository';
import { PrismaUsageBillingService } from '../usage/services/usage-billing.service';

import { PrismaReservationService } from './services/reservation.service';

const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  if (process.env['CI']) {
    console.error('❌ DATABASE_URL is required, the lifetime tests can not be skipped in CI');
    process.exit(1);
  }
  console.log('⚠️  Skipping the reservation lifetime tests, DATABASE_URL is not set');
  process.exit(0);
}

const usageRepository = new PrismaUsageRepository();
const billingService = new PrismaUsageBillingService();
const reservationService = new PrismaReservationService();

interface Fixtures {
  organizationId: string;
  userId: string;
  apiKeyId: string;
}

async function createFixtures(creditBalanceCents: number): Promise<Fixtures> {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `lifetime-${suffix}@example.com`,
      username: `lifetime-${suffix}`,
      fullName: 'Lifetime User',
      passwordHash: 'not-used-here',
    },
  });
  const organization = await prisma.organization.create({
    data: {
      name: `Lifetime ${suffix}`,
      slug: `lifetime-${suffix}`,
      ownerId: user.id,
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
      name: 'Lifetime Key',
      keyHash: `hash-${suffix}`,
      keyPrefix: `sk_live_${suffix}`,
      permissions: ['chat:completions'],
      organizationId: organization.id,
    },
  });
  await prisma.billingAccount.create({
    data: {
      organizationId: organization.id,
      status: 'ACTIVE',
      currency: 'USD',
      creditBalanceCents,
    },
  });
  return { organizationId: organization.id, userId: user.id, apiKeyId: apiKey.id };
}

async function removeFixtures(fixtures: Fixtures): Promise<void> {
  await prisma.creditTransaction.deleteMany({
    where: { billingAccount: { organizationId: fixtures.organizationId } },
  });
  await prisma.billingReservation.deleteMany({
    where: { organizationId: fixtures.organizationId },
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

async function readState(fixtures: Fixtures) {
  const account = await prisma.billingAccount.findFirstOrThrow({
    where: { organizationId: fixtures.organizationId },
  });
  const reservations = await prisma.billingReservation.findMany({
    where: { organizationId: fixtures.organizationId },
    orderBy: { createdAt: 'asc' },
  });
  const transactions = await prisma.creditTransaction.findMany({
    where: { billingAccountId: account.id },
    orderBy: { createdAt: 'asc' },
  });
  const auditLogs = await prisma.auditLog.findMany({
    where: { organizationId: fixtures.organizationId },
    orderBy: { createdAt: 'asc' },
  });
  return { account, reservations, transactions, auditLogs };
}

async function createUsage(fixtures: Fixtures, costUsd: number, statusCode = 200) {
  const usageKey = randomUUID();
  const usage = await usageRepository.createUsageRecord({
    userId: fixtures.userId,
    apiKeyId: fixtures.apiKeyId,
    organizationId: fixtures.organizationId,
    provider: '9router',
    model: 'demo-model',
    endpoint: '/v1/chat/completions',
    method: 'POST',
    requestId: `req-${usageKey}`,
    usageKey,
    reservationId: null,
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    estimatedCost: costUsd,
    latencyMs: 10,
    statusCode,
  });
  return usage;
}

async function run(): Promise<void> {
  console.log('🧪 Starting Credit Reservation Lifetime Tests...');

  // 1. A request that is still running when the initial deadline passes. The
  //    lease of the reservation is renewed, the periodic recovery must not
  //    release the credit of a running request.
  {
    const fixtures = await createFixtures(100);
    try {
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: `req-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 100_000,
        expiresAt: new Date(Date.now() - 1_000),
      });

      // The deadline of the reservation has passed, the request is still
      // running: the lease is renewed before the recovery looks at it.
      const renewed = await reservationService.renew(
        reservation.id,
        new Date(Date.now() + 120_000),
      );
      assert.equal(renewed, true, 'The lease of a running request has to be renewable');

      const recovered = await reservationService.recoverExpiredReservations(
        fixtures.organizationId,
      );
      assert.equal(recovered, 0, 'The recovery must not release a running request');

      const { account, reservations } = await readState(fixtures);
      assert.equal(reservations[0]?.status, 'RESERVED');
      assert.equal(Number(account.reservedMicros), 100_000, 'The credit stays held');
      assert.equal(account.creditBalanceCents, 100, 'The balance is not touched');
      console.log('  ✅ A running request keeps its credit when the deadline passes');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 2. The renewal of a reservation that is no longer reserved fails, the
  //    request has lost its credit guarantee.
  {
    const fixtures = await createFixtures(100);
    try {
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: `req-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 100_000,
        expiresAt: new Date(Date.now() + 120_000),
      });
      await reservationService.release(reservation.id, 'the request never reached the provider');
      const renewed = await reservationService.renew(
        reservation.id,
        new Date(Date.now() + 120_000),
      );
      assert.equal(renewed, false, 'A released reservation can not be renewed');
      console.log('  ✅ A released reservation can not be renewed');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 3. The request finishes right before the deadline. The settlement charges
  //    the real cost exactly once and the held credit is returned.
  {
    const fixtures = await createFixtures(100);
    try {
      const usage = await createUsage(fixtures, 0.05);
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: usage.requestId,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 100_000,
        // The request ends right before the deadline.
        expiresAt: new Date(Date.now() + 60_000),
      });

      await billingService.charge({
        usageId: usage.id,
        organizationId: fixtures.organizationId,
        estimatedCostUsd: 0.05,
        model: 'demo-model',
        requestId: usage.requestId,
        reservationId: reservation.id,
        usageKnown: true,
      });

      const { account, reservations, transactions } = await readState(fixtures);
      assert.equal(reservations[0]?.status, 'SETTLED');
      assert.equal(transactions.length, 1, 'The cost is charged exactly once');
      assert.equal(account.creditBalanceCents, 95, 'The balance is charged once');
      assert.equal(Number(account.reservedMicros), 0, 'The held credit is returned');
      console.log('  ✅ A request that ends before the deadline is charged once');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 4. The provider succeeds after the timeout. The reservation was recovered
  //    in the meantime, the late settlement still charges the real cost
  //    exactly once and the credit is not returned twice.
  {
    const fixtures = await createFixtures(100);
    try {
      const usage = await createUsage(fixtures, 0.05);
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: usage.requestId,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 100_000,
        // The deadline of the request has passed while the provider worked.
        expiresAt: new Date(Date.now() - 1_000),
      });

      const recovered = await reservationService.recoverExpiredReservations(
        fixtures.organizationId,
      );
      assert.equal(recovered, 1, 'The reservation of the ended request is recovered');

      // The provider answers after the deadline, the usage is recorded and
      // the cost is charged.
      await billingService.charge({
        usageId: usage.id,
        organizationId: fixtures.organizationId,
        estimatedCostUsd: 0.05,
        model: 'demo-model',
        requestId: usage.requestId,
        reservationId: reservation.id,
        usageKnown: true,
      });

      const { account, reservations, transactions } = await readState(fixtures);
      assert.equal(reservations[0]?.status, 'SETTLED');
      assert.equal(transactions.length, 1, 'The late settlement charges exactly once');
      assert.equal(account.creditBalanceCents, 95, 'The real cost is not lost');
      assert.equal(Number(account.reservedMicros), 0, 'The credit is returned exactly once');
      console.log('  ✅ A provider that answers after the timeout is charged once');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 5. The recovery and the settlement of the same reservation run at the
  //     same time. The credit is returned once and the cost is charged once.
  {
    const fixtures = await createFixtures(100);
    try {
      const usage = await createUsage(fixtures, 0.05);
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: usage.requestId,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 100_000,
        expiresAt: new Date(Date.now() - 1_000),
      });

      await Promise.all([
        reservationService.recoverExpiredReservations(fixtures.organizationId),
        billingService.charge({
          usageId: usage.id,
          organizationId: fixtures.organizationId,
          estimatedCostUsd: 0.05,
          model: 'demo-model',
          requestId: usage.requestId,
          reservationId: reservation.id,
          usageKnown: true,
        }),
      ]);

      const { account, reservations, transactions } = await readState(fixtures);
      assert.equal(reservations[0]?.status, 'SETTLED');
      assert.equal(transactions.length, 1, 'The cost is charged exactly once');
      assert.equal(account.creditBalanceCents, 95, 'The balance is charged once');
      assert.equal(Number(account.reservedMicros), 0, 'The credit must not be returned twice');
      console.log('  ✅ A recovery at the same time as a settlement charges once');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 6. The settlement is retried, the cost is not debited twice.
  {
    const fixtures = await createFixtures(100);
    try {
      const usage = await createUsage(fixtures, 0.05);
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: usage.requestId,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 100_000,
        expiresAt: new Date(Date.now() + 60_000),
      });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await billingService.charge({
          usageId: usage.id,
          organizationId: fixtures.organizationId,
          estimatedCostUsd: 0.05,
          model: 'demo-model',
          requestId: usage.requestId,
          reservationId: reservation.id,
          usageKnown: true,
        });
      }

      const { account, reservations, transactions } = await readState(fixtures);
      assert.equal(reservations[0]?.status, 'SETTLED');
      assert.equal(transactions.length, 1, 'A retried settlement must not debit twice');
      assert.equal(account.creditBalanceCents, 95, 'The balance is charged once');
      assert.equal(Number(account.reservedMicros), 0);
      console.log('  ✅ A retried settlement does not debit twice');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 7. A request that really ended is recovered, the credit is returned and
  //    the audit trail records it.
  {
    const fixtures = await createFixtures(100);
    try {
      await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: `req-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 100_000,
        expiresAt: new Date(Date.now() - 1_000),
      });

      const recovered = await reservationService.recoverExpiredReservations(
        fixtures.organizationId,
      );
      assert.equal(recovered, 1, 'A request that ended is recovered');
      const { account, reservations, transactions, auditLogs } = await readState(fixtures);
      assert.equal(reservations[0]?.status, 'EXPIRED');
      assert.equal(Number(account.reservedMicros), 0, 'The credit is returned');
      assert.equal(account.creditBalanceCents, 100, 'The balance is not changed');
      assert.equal(transactions.length, 0, 'A recovered request is not charged');
      assert.equal(
        auditLogs.filter((entry) => entry.action === 'BILLING_RESERVATION_EXPIRED').length,
        1,
        'The recovery is visible in the audit trail',
      );
      console.log('  ✅ A request that really ended is recovered');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 8. A running request never loses its reservation, even when the recovery
  //     runs repeatedly while the lease keeps the reservation alive.
  {
    const fixtures = await createFixtures(100);
    try {
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: `req-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 100_000,
        expiresAt: new Date(Date.now() - 1_000),
      });

      // Five recovery rounds, the lease is renewed in every round like a
      // running request does.
      for (let round = 0; round < 5; round += 1) {
        const renewed = await reservationService.renew(
          reservation.id,
          new Date(Date.now() + 120_000),
        );
        assert.equal(renewed, true, 'The lease of a running request stays renewable');
        const recovered = await reservationService.recoverExpiredReservations(
          fixtures.organizationId,
        );
        assert.equal(recovered, 0, 'A running request is never recovered');
      }

      const { account, reservations } = await readState(fixtures);
      assert.equal(reservations[0]?.status, 'RESERVED');
      assert.equal(Number(account.reservedMicros), 100_000, 'The credit stays held');
      console.log('  ✅ A running request never loses its reservation');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  console.log('🎉 All Credit Reservation Lifetime Tests passed successfully!\n');
  await prisma.$disconnect();
}

void run();
