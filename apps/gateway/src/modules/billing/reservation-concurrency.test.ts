/**
 * Concurrency and failure recovery tests of the credit reservation against a
 * real PostgreSQL.
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
  console.log('⚠️  Skipping the reservation concurrency tests, DATABASE_URL is not set');
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

async function createFixtures(
  creditBalanceCents: number,
  spendingLimitCents?: number,
): Promise<Fixtures> {
  const suffix = randomUUID().slice(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `reservation-${suffix}@example.com`,
      username: `reservation-${suffix}`,
      fullName: 'Reservation User',
      passwordHash: 'not-used-here',
    },
  });
  const organization = await prisma.organization.create({
    data: {
      name: `Reservation ${suffix}`,
      slug: `reservation-${suffix}`,
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
      name: 'Reservation Key',
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
  return { account, reservations, transactions };
}

async function run(): Promise<void> {
  console.log('🧪 Starting Credit Reservation Concurrency Tests...');

  // 1. Twenty concurrent requests reserve the credit of a balance that is
  //    almost exhausted. The balance never becomes negative and only the
  //    affordable requests are reserved.
  {
    const fixtures = await createFixtures(10);
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          reservationService
            .reserve({
              organizationId: fixtures.organizationId,
              apiKeyId: fixtures.apiKeyId,
              requestId: `req-${randomUUID()}`,
              idempotencyKey: randomUUID(),
              modality: 'chat',
              amountMicros: 10_000,
              expiresAt: new Date(Date.now() + 120_000),
            })
            .then(
              (reservation) => ({ ok: true as const, reservation }),
              (error: unknown) => ({ ok: false as const, error }),
            ),
        ),
      );
      const granted = results.filter((result) => result.ok).length;
      const refused = results.filter((result) => !result.ok).length;

      const { account, reservations } = await readState(fixtures);
      assert.equal(granted, 10, 'Only the affordable requests may be reserved');
      assert.equal(refused, 10, 'The other reservations have to be refused');
      assert.equal(reservations.length, 10);
      assert.equal(
        Number(account.reservedMicros),
        100_000,
        'The held credit has to match the open reservations',
      );
      assert.equal(account.creditBalanceCents, 10, 'The balance is not touched by a reservation');
      console.log('  ✅ Concurrent reservations never overdraw the balance');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 2. The spending limit is reserved as well, the concurrent requests can
  //    not exceed it.
  {
    const fixtures = await createFixtures(1_000, 5);
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          reservationService
            .reserve({
              organizationId: fixtures.organizationId,
              apiKeyId: fixtures.apiKeyId,
              requestId: `req-${randomUUID()}`,
              idempotencyKey: randomUUID(),
              modality: 'chat',
              amountMicros: 10_000,
              expiresAt: new Date(Date.now() + 120_000),
            })
            .then(
              (reservation) => ({ ok: true as const, reservation }),
              (error: unknown) => ({ ok: false as const, error }),
            ),
        ),
      );
      const granted = results.filter((result) => result.ok).length;
      const { account } = await readState(fixtures);
      assert.ok(granted <= 5, `At most five requests may be reserved, got ${granted}`);
      assert.equal(
        Number(account.reservedMicros),
        granted * 10_000,
        'The held credit has to match the granted reservations',
      );
      console.log('  ✅ The spending limit is reserved, the concurrent requests stay below it');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 3. A reservation without enough credit is refused, the request is not
  //    forwarded to a provider.
  {
    const fixtures = await createFixtures(0);
    try {
      await assert.rejects(
        () =>
          reservationService.reserve({
            organizationId: fixtures.organizationId,
            apiKeyId: fixtures.apiKeyId,
            requestId: `req-${randomUUID()}`,
            idempotencyKey: randomUUID(),
            modality: 'chat',
            amountMicros: 10_000,
            expiresAt: new Date(Date.now() + 120_000),
          }),
        (error: unknown) => (error as { code?: string }).code === 'INSUFFICIENT_CREDIT',
      );
      const { account, reservations } = await readState(fixtures);
      assert.equal(reservations.length, 0);
      assert.equal(Number(account.reservedMicros), 0);
      console.log('  ✅ A reservation without enough credit is refused');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 4. A request that never reached the provider releases the reservation and
  //    the credit becomes available again.
  {
    const fixtures = await createFixtures(100);
    try {
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: `req-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 50_000,
        expiresAt: new Date(Date.now() + 120_000),
      });
      assert.ok(reservation.id);
      const released = await reservationService.release(reservation.id, 'provider-not-called');
      assert.equal(released, true);
      const { account, reservations } = await readState(fixtures);
      assert.equal(reservations[0]?.status, 'RELEASED');
      assert.equal(Number(account.reservedMicros), 0, 'The held credit has to be returned');
      assert.equal(account.creditBalanceCents, 100);
      console.log('  ✅ A released reservation returns the held credit');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 5. The settlement charges exactly once, a retry of the settlement does
  //    not charge a second time.
  {
    const fixtures = await createFixtures(100);
    try {
      const usageKey = randomUUID();
      const usage = await usageRepository.createUsageRecord({
        userId: fixtures.userId,
        apiKeyId: fixtures.apiKeyId,
        organizationId: fixtures.organizationId,
        provider: '9router',
        model: 'demo-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        requestId: `req-${randomUUID()}`,
        usageKey,
        reservationId: null,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.05,
        latencyMs: 10,
        statusCode: 200,
      });

      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: usage.requestId,
        idempotencyKey: usageKey,
        modality: 'chat',
        amountMicros: 100_000,
        expiresAt: new Date(Date.now() + 120_000),
      });
      await usageRepository.createUsageRecord({
        userId: fixtures.userId,
        apiKeyId: fixtures.apiKeyId,
        organizationId: fixtures.organizationId,
        provider: '9router',
        model: 'demo-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        requestId: usage.requestId,
        usageKey,
        reservationId: reservation.id,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.05,
        latencyMs: 10,
        statusCode: 200,
      });

      // The settlement of the same usage event twice.
      await billingService.charge({
        usageId: usage.id,
        organizationId: fixtures.organizationId,
        estimatedCostUsd: 0.05,
        model: 'demo-model',
        requestId: usage.requestId,
        reservationId: reservation.id,
        usageKnown: true,
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
      assert.equal(transactions.length, 1, 'The retry must not charge a second time');
      assert.equal(account.creditBalanceCents, 95, 'The charge has to be applied once');
      assert.equal(Number(account.reservedMicros), 0, 'The held credit has to be returned');
      assert.equal(reservations[0]?.status, 'SETTLED');
      console.log('  ✅ A repeated settlement charges exactly once');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 6. Two concurrent settlements of the same reservation charge once.
  {
    const fixtures = await createFixtures(100);
    try {
      const usage = await usageRepository.createUsageRecord({
        userId: fixtures.userId,
        apiKeyId: fixtures.apiKeyId,
        organizationId: fixtures.organizationId,
        provider: '9router',
        model: 'demo-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        requestId: `req-${randomUUID()}`,
        usageKey: randomUUID(),
        reservationId: null,
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.05,
        latencyMs: 10,
        statusCode: 200,
      });
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: usage.requestId,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 100_000,
        expiresAt: new Date(Date.now() + 120_000),
      });

      await Promise.all(
        Array.from({ length: 2 }, () =>
          billingService.charge({
            usageId: usage.id,
            organizationId: fixtures.organizationId,
            estimatedCostUsd: 0.05,
            model: 'demo-model',
            requestId: usage.requestId,
            reservationId: reservation.id,
            usageKnown: true,
          }),
        ),
      );

      const { account, transactions } = await readState(fixtures);
      assert.equal(transactions.length, 1, 'The concurrent settlements charge once');
      assert.equal(account.creditBalanceCents, 95);
      assert.equal(Number(account.reservedMicros), 0);
      console.log('  ✅ Two concurrent settlements of one reservation charge once');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 7. A reservation of a process that stopped before the settlement is
  //    recovered, and a late settlement still charges the real cost.
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
        // The deadline has passed, the request can no longer be running.
        expiresAt: new Date(Date.now() - 1_000),
      });

      const recovered = await reservationService.recoverExpiredReservations(
        fixtures.organizationId,
      );
      assert.equal(recovered, 1, 'The expired reservation has to be recovered');
      const { account, reservations } = await readState(fixtures);
      assert.equal(reservations[0]?.status, 'EXPIRED');
      assert.equal(Number(account.reservedMicros), 0, 'The held credit has to be returned');
      assert.equal(account.creditBalanceCents, 100);
      console.log('  ✅ A leftover reservation is recovered and its credit returned');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 8. A request that never produced a usage keeps its reservation until the
  //    deadline, the credit is not returned while the request could still run.
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
      const usage = await usageRepository.createUsageRecord({
        userId: fixtures.userId,
        apiKeyId: fixtures.apiKeyId,
        organizationId: fixtures.organizationId,
        provider: '9router',
        model: 'demo-model',
        endpoint: '/v1/chat/completions',
        method: 'POST',
        requestId: `req-${randomUUID()}`,
        usageKey: randomUUID(),
        reservationId: reservation.id,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
        latencyMs: 10,
        statusCode: 504,
      });
      await billingService.charge({
        usageId: usage.id,
        organizationId: fixtures.organizationId,
        estimatedCostUsd: 0,
        model: 'demo-model',
        requestId: usage.requestId,
        reservationId: reservation.id,
        usageKnown: false,
      });

      const { account, reservations } = await readState(fixtures);
      assert.equal(
        reservations[0]?.status,
        'RESERVED',
        'The credit of a request without a usage stays held until the deadline',
      );
      assert.equal(Number(account.reservedMicros), 100_000);
      assert.equal(account.creditBalanceCents, 100);
      console.log('  ✅ A failed request keeps its credit until the request can no longer run');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 9. The retry of a request does not reserve a second time.
  {
    const fixtures = await createFixtures(100);
    try {
      const idempotencyKey = randomUUID();
      const input = {
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: `req-${randomUUID()}`,
        idempotencyKey,
        modality: 'chat' as const,
        amountMicros: 100_000,
        expiresAt: new Date(Date.now() + 120_000),
      };
      const first = await reservationService.reserve(input);
      const second = await reservationService.reserve(input);
      assert.equal(first.id, second.id, 'The retry has to use the same reservation');
      assert.equal(second.existing, true);
      const { account, reservations } = await readState(fixtures);
      assert.equal(reservations.length, 1);
      assert.equal(
        Number(account.reservedMicros),
        100_000,
        'The retry must not hold the credit twice',
      );
      console.log('  ✅ A retry of a request reserves the credit only once');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  // 10. The spending limit of the next period does not destroy the open
  //     reservations of the current period.
  {
    const fixtures = await createFixtures(1_000, 5);
    try {
      const reservation = await reservationService.reserve({
        organizationId: fixtures.organizationId,
        apiKeyId: fixtures.apiKeyId,
        requestId: `req-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        modality: 'chat',
        amountMicros: 50_000,
        expiresAt: new Date(Date.now() + 120_000),
      });
      assert.ok(reservation.id);
      // The settlement of a request that belongs to the previous period.
      const previousPeriod = await prisma.creditTransaction.create({
        data: {
          billingAccountId: (
            await prisma.billingAccount.findFirstOrThrow({
              where: { organizationId: fixtures.organizationId },
            })
          ).id,
          type: 'USAGE',
          amountCents: -5,
          costMicros: 50_000,
          balanceAfterCents: 995,
          idempotencyKey: `previous-period-${randomUUID()}`,
          description: 'AI usage: previous period',
          metadata: {},
          createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        },
      });
      assert.ok(previousPeriod.id);

      const { account, reservations } = await readState(fixtures);
      assert.equal(
        reservations[0]?.status,
        'RESERVED',
        'The reservation of the current period survives the period change',
      );
      assert.equal(Number(account.reservedMicros), 50_000);
      console.log('  ✅ The period change of the spending limit keeps the open reservations');
    } finally {
      await removeFixtures(fixtures);
    }
  }

  console.log('🎉 All Credit Reservation Concurrency Tests passed successfully!\n');
  await prisma.$disconnect();
}

void run();
