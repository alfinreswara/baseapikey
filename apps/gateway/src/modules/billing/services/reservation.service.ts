import { prisma } from '@baseapikey/database';
import { RESERVATION_LIFETIME_MS, RESERVATION_RENEWAL_INTERVAL_MS } from '@baseapikey/shared';

/**
 * The unit of the reservation is the micro dollar. One cent are ten thousand
 * micros, the same unit the unbilled usage accumulator uses.
 */
export const MICROS_PER_CENT = 10_000;

export { RESERVATION_LIFETIME_MS, RESERVATION_RENEWAL_INTERVAL_MS };

export type ReservationStatus = 'RESERVED' | 'SETTLED' | 'RELEASED' | 'EXPIRED';
export type ReservationModality = 'chat' | 'embedding' | 'image' | 'speech' | 'transcription';

export interface ReserveCreditInput {
  organizationId: string;
  apiKeyId: string | null;
  requestId: string;
  /** Identifies the request, a retry never creates a second reservation. */
  idempotencyKey: string;
  modality: ReservationModality;
  /** The upper bound of the cost of the request, in micros. */
  amountMicros: number;
  /**
   * The point in time at which the request can no longer be running. The
   * reservation is only recovered after that moment, never by its age alone.
   */
  expiresAt: Date;
}

export interface ReservationResult {
  id: string;
  amountMicros: number;
  /** The reservation was already created for this request. */
  existing: boolean;
}

export interface SettleReservationInput {
  reservationId: string;
  /** The real cost of the request, in micros. */
  settledAmountMicros: number;
  /** The reason of the settlement, it is stored in the audit trail. */
  reason: string;
}

export type SettlementOutcome = 'settled' | 'already-settled' | 'not-found' | 'usage-unknown';

export interface IReservationService {
  reserve(input: ReserveCreditInput): Promise<ReservationResult>;
  settle(input: SettleReservationInput): Promise<SettlementOutcome>;
  release(reservationId: string, reason: string): Promise<boolean>;
  /**
   * Extends the lease of a reservation that is still in use. The renewal
   * fails when the reservation is no longer reserved, a recovered or a
   * settled reservation can not be renewed.
   */
  renew(reservationId: string, expiresAt: Date): Promise<boolean>;
  /** Returns the reservations that were recovered. */
  recoverExpiredReservations(organizationId?: string): Promise<number>;
}

/**
 * The credit of an organization is reserved before the request is forwarded to
 * a provider and settled when the real usage is known.
 *
 * The reservation is the source of truth, the `reserved_micros` column of the
 * billing account is the denormalized sum of the open reservations. Every
 * transition is a conditional update, so it happens exactly once:
 *
 * - reserve: the row of the billing account is locked, the available credit
 *   and the spending limit are checked, the reservation is created and the
 *   held credit is increased,
 * - settle: the reservation moves to SETTLED, the held credit is returned
 *   and the real cost is charged,
 * - release: the request never produced a billable usage, the held credit is
 *   returned without a charge,
 * - recover: the request can no longer be running, the held credit is
 *   returned. A late settlement of a recovered reservation still charges the
 *   real cost, the ledger decides with its unique constraint.
 */
export class PrismaReservationService implements IReservationService {
  async reserve(input: ReserveCreditInput): Promise<ReservationResult> {
    const amountMicros = Math.max(0, Math.round(input.amountMicros));

    return prisma.$transaction(async (tx) => {
      const account = await tx.billingAccount.findUnique({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          creditBalanceCents: true,
          unbilledUsageMicros: true,
          reservedMicros: true,
        },
      });
      if (!account) {
        throw new CreditReservationError(
          'The organization has no billing account',
          'BILLING_ACCOUNT_UNAVAILABLE',
        );
      }

      // The existing reservation of the request is returned, a retry never
      // reserves a second time.
      const existing = await tx.billingReservation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return {
          id: existing.id,
          amountMicros: Number(existing.amountMicros),
          existing: true,
        };
      }

      // The account is locked, the reservations of an organization are
      // serialized, so the available credit and the spending limit are exact.
      await tx.$queryRaw`
        SELECT id FROM billing_accounts WHERE id = ${account.id}::uuid FOR UPDATE
      `;
      const locked = await tx.billingAccount.findUniqueOrThrow({
        where: { id: account.id },
        select: { creditBalanceCents: true, unbilledUsageMicros: true, reservedMicros: true },
      });

      const reservedMicros = Number(locked.reservedMicros);
      const availableMicros =
        locked.creditBalanceCents * MICROS_PER_CENT + locked.unbilledUsageMicros - reservedMicros;

      if (availableMicros < amountMicros) {
        throw new CreditReservationError(
          'The credit balance does not cover the request',
          'INSUFFICIENT_CREDIT',
          { availableMicros, amountMicros, reservedMicros },
        );
      }

      const limitMicros = await this.getSpendingLimitMicros(tx, input.organizationId);
      if (limitMicros !== null) {
        const settledMicros = await this.getSettledMicros(tx, input.organizationId);
        if (settledMicros + reservedMicros + amountMicros > limitMicros) {
          throw new CreditReservationError(
            'The spending limit of the organization does not cover the request',
            'SPENDING_LIMIT_REACHED',
            { settledMicros, reservedMicros, amountMicros, limitMicros },
          );
        }
      }

      const created = await tx.billingReservation.create({
        data: {
          organizationId: input.organizationId,
          billingAccountId: account.id,
          apiKeyId: input.apiKeyId,
          requestId: input.requestId,
          idempotencyKey: input.idempotencyKey,
          modality: input.modality,
          amountMicros: BigInt(amountMicros),
          status: 'RESERVED',
          expiresAt: input.expiresAt,
        },
        select: { id: true },
      });

      // The held credit is increased with a relative update, the update of
      // another request can never be overwritten.
      await tx.billingAccount.update({
        where: { id: account.id },
        data: { reservedMicros: { increment: BigInt(amountMicros) } },
      });

      return { id: created.id, amountMicros, existing: false };
    });
  }

  async settle(input: SettleReservationInput): Promise<SettlementOutcome> {
    const settledAmountMicros = Math.max(0, Math.round(input.settledAmountMicros));

    return prisma.$transaction(async (tx) => {
      const reservation = await tx.billingReservation.findUnique({
        where: { id: input.reservationId },
      });
      if (!reservation) {
        return 'not-found';
      }
      if (reservation.status === 'SETTLED') {
        return 'already-settled';
      }
      if (reservation.status === 'RELEASED') {
        return 'already-settled';
      }

      const account = await tx.billingAccount.findUniqueOrThrow({
        where: { id: reservation.billingAccountId },
        select: {
          id: true,
          creditBalanceCents: true,
          unbilledUsageMicros: true,
          reservedMicros: true,
        },
      });
      await tx.$queryRaw`
        SELECT id FROM billing_accounts WHERE id = ${account.id}::uuid FOR UPDATE
      `;

      // The transition happens exactly once, a concurrent settlement of the
      // same reservation finds the status already changed.
      const transitioned = await tx.billingReservation.updateMany({
        where: { id: reservation.id, status: { in: ['RESERVED', 'EXPIRED'] } },
        data: {
          status: 'SETTLED',
          settledAmountMicros,
        },
      });
      if (transitioned.count === 0) {
        return 'already-settled';
      }

      // The held credit is returned, the reservation of a recovered request
      // does not hold anything anymore.
      if (reservation.status === 'RESERVED') {
        await tx.billingAccount.update({
          where: { id: account.id },
          data: { reservedMicros: { decrement: reservation.amountMicros } },
        });
      }

      return 'settled';
    });
  }

  async release(reservationId: string, reason: string): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const reservation = await tx.billingReservation.findUnique({
        where: { id: reservationId },
      });
      if (!reservation || reservation.status !== 'RESERVED') {
        return false;
      }
      await tx.$queryRaw`
        SELECT id FROM billing_accounts WHERE id = ${reservation.billingAccountId}::uuid FOR UPDATE
      `;
      const transitioned = await tx.billingReservation.updateMany({
        where: { id: reservationId, status: 'RESERVED' },
        data: { status: 'RELEASED' },
      });
      if (transitioned.count === 0) {
        return false;
      }
      await tx.billingAccount.update({
        where: { id: reservation.billingAccountId },
        data: { reservedMicros: { decrement: reservation.amountMicros } },
      });
      await this.writeAudit(tx, reservation, 'BILLING_RESERVATION_RELEASED', reason);
      return true;
    });
  }

  /**
   * Extends the lease of a reservation that is still in use.
   *
   * The update is conditional on the status, so a reservation that was
   * settled, released or recovered in the meantime is never renewed. The
   * renewal only touches the deadline, the held credit is not changed.
   */
  async renew(reservationId: string, expiresAt: Date): Promise<boolean> {
    const renewed = await prisma.billingReservation.updateMany({
      where: { id: reservationId, status: 'RESERVED' },
      data: { expiresAt },
    });
    return renewed.count > 0;
  }

  /**
   * Recovers the reservations of the requests that can no longer be running.
   * The recovery only touches the reservations whose deadline has passed, the
   * deadline is derived from the maximum lifetime of a request and not from an
   * arbitrary age.
   */
  async recoverExpiredReservations(organizationId?: string): Promise<number> {
    return prisma.$transaction(async (tx) => {
      const expired = await tx.billingReservation.findMany({
        where: {
          status: 'RESERVED',
          expiresAt: { lt: new Date() },
          ...(organizationId ? { organizationId } : {}),
        },
        select: {
          id: true,
          billingAccountId: true,
          amountMicros: true,
          organizationId: true,
          requestId: true,
        },
      });
      if (expired.length === 0) {
        return 0;
      }

      const accountIds = [...new Set(expired.map((reservation) => reservation.billingAccountId))];
      for (const accountId of accountIds) {
        await tx.$queryRaw`
          SELECT id FROM billing_accounts WHERE id = ${accountId}::uuid FOR UPDATE
        `;
      }

      let recovered = 0;
      for (const reservation of expired) {
        // The deadline is checked again in the update, so a lease that was
        // renewed between the read and the update wins. The recovery never
        // releases the credit of a request that is still running.
        const transitioned = await tx.billingReservation.updateMany({
          where: {
            id: reservation.id,
            status: 'RESERVED',
            expiresAt: { lt: new Date() },
          },
          data: { status: 'EXPIRED' },
        });
        if (transitioned.count === 0) {
          continue;
        }
        await tx.billingAccount.update({
          where: { id: reservation.billingAccountId },
          data: { reservedMicros: { decrement: reservation.amountMicros } },
        });
        // The recovery is recorded, the reason of the released credit is
        // visible in the audit trail of the organization.
        await this.writeAudit(
          tx,
          reservation,
          'BILLING_RESERVATION_EXPIRED',
          'The request can no longer be running',
        );
        recovered += 1;
      }
      return recovered;
    });
  }

  private async getSpendingLimitMicros(
    tx: { organization: { findFirst: (args: never) => Promise<unknown> } },
    organizationId: string,
  ): Promise<number | null> {
    const organization = (await tx.organization.findFirst({
      where: { id: organizationId },
      select: { spendingLimitCents: true },
    } as never)) as { spendingLimitCents: number | null } | null;
    if (
      organization?.spendingLimitCents === null ||
      organization?.spendingLimitCents === undefined
    ) {
      return null;
    }
    return organization.spendingLimitCents * MICROS_PER_CENT;
  }

  /**
   * The settled cost of the current period. Only the settled entries are
   * counted, the credit of the open reservations is counted separately, so the
   * two are never added twice.
   */
  private async getSettledMicros(
    tx: { creditTransaction: { aggregate: (args: never) => Promise<unknown> } },
    organizationId: string,
  ): Promise<number> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const aggregate = (await tx.creditTransaction.aggregate({
      where: {
        billingAccount: { organizationId },
        type: 'USAGE',
        createdAt: { gte: monthStart },
      },
      _sum: { costMicros: true },
    } as never)) as { _sum: { costMicros: number | null } | null };
    return aggregate._sum?.costMicros ?? 0;
  }

  private async writeAudit(
    tx: {
      auditLog: {
        create: (args: never) => Promise<unknown>;
      };
    },
    reservation: { id: string; organizationId: string; requestId: string },
    action: string,
    reason: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        organizationId: reservation.organizationId,
        action,
        resource: 'BillingReservation',
        resourceId: reservation.id,
        requestId: reservation.requestId,
        metadata: { reason },
      },
    } as never);
  }
}

/** The reservation of the credit was refused. */
export class CreditReservationError extends Error {
  constructor(
    message: string,
    readonly code: 'INSUFFICIENT_CREDIT' | 'SPENDING_LIMIT_REACHED' | 'BILLING_ACCOUNT_UNAVAILABLE',
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CreditReservationError';
  }
}
