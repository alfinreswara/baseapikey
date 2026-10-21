import { AuditSeverity, CreditTransactionType, prisma } from '@baseapikey/database';

export interface IUsageBillingService {
  charge(data: {
    usageId: string;
    organizationId: string;
    estimatedCostUsd: number;
    model: string;
    requestId: string;
    reservationId?: string | null | undefined;
    /** False when the request failed before the provider reported a usage. */
    usageKnown?: boolean | undefined;
  }): Promise<void>;
}

/** A hundredth of a cent, the unit of the unbilled usage accumulator. */
const MICROS_PER_CENT = 10_000;

/**
 * The database rejected a duplicate. The unique constraint of the
 * idempotency key is the guarantee that a charge is applied once.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

/** Thrown inside the transaction when the charge must not be applied. */
class ChargeRejectedError extends Error {
  constructor(readonly reason: 'insufficient-credit' | 'spending-limit') {
    super(`The charge was rejected: ${reason}`);
    this.name = 'ChargeRejectedError';
  }
}

interface LockedAccount {
  id: string;
  creditBalanceCents: number;
  unbilledUsageMicros: number;
  reservedMicros: bigint;
}

/**
 * Applies the credit of a usage event.
 *
 * The whole charge runs in one transaction and the row of the billing account
 * is locked while it runs, so the charges of an organization are serialized:
 *
 * - the reservation of the request is settled exactly once, the held credit is
 *   returned and the real cost is charged,
 * - the balance is decremented with a relative and conditional update, it can
 *   never become negative and it can never overwrite the update of another
 *   charge,
 * - the spending limit is checked against the settled cost plus the credit
 *   that is held for the other running requests. The two are never counted
 *   twice, the unsettled usage is covered by its reservation.
 * - the ledger entry uses the id of the usage event as its idempotency key.
 *   The unique constraint of the database rejects a second entry, so a retry
 *   never charges the balance a second time.
 */
export class PrismaUsageBillingService implements IUsageBillingService {
  async charge(data: {
    usageId: string;
    organizationId: string;
    estimatedCostUsd: number;
    model: string;
    requestId: string;
    reservationId?: string | null | undefined;
    usageKnown?: boolean | undefined;
  }): Promise<void> {
    const costMicros = Math.max(0, Math.round(data.estimatedCostUsd * 1_000_000));
    const idempotencyKey = `usage:${data.usageId}`;

    if (costMicros === 0 && !data.reservationId) {
      return;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const account = await this.lockAccount(tx, data.organizationId);
        if (!account) {
          // Without a billing account there is nothing to charge.
          return;
        }

        // The reservation of the request is settled. The transition is a
        // conditional update, a concurrent settlement finds the status
        // already changed and does nothing.
        let reservedMicros = Number(account.reservedMicros);
        if (data.reservationId && data.usageKnown !== false) {
          // The reservation is read before the transition, the status tells
          // whether the credit is still held.
          const reservation = await tx.billingReservation.findUnique({
            where: { id: data.reservationId },
            select: { amountMicros: true, status: true },
          });
          const settled = await tx.billingReservation.updateMany({
            where: { id: data.reservationId, status: { in: ['RESERVED', 'EXPIRED'] } },
            data: { status: 'SETTLED' },
          });
          if (settled.count > 0 && reservation?.status === 'RESERVED') {
            reservedMicros -= Number(reservation.amountMicros);
            await tx.billingAccount.update({
              where: { id: account.id },
              data: { reservedMicros: { decrement: reservation.amountMicros } },
            });
          }
        }

        if (costMicros === 0) {
          return;
        }

        const spendingLimitMicros = await this.getSpendingLimitMicros(tx, data.organizationId);
        if (spendingLimitMicros !== null) {
          const settledMicros = await this.getSettledMicros(tx, data.organizationId);
          if (settledMicros + reservedMicros + costMicros > spendingLimitMicros) {
            throw new ChargeRejectedError('spending-limit');
          }
        }

        const accumulatedMicros = account.unbilledUsageMicros + costMicros;
        const billableCents = Math.floor(accumulatedMicros / MICROS_PER_CENT);
        const unbilledUsageMicros = accumulatedMicros % MICROS_PER_CENT;

        if (billableCents > 0) {
          // The conditional update is the guarantee that the balance never
          // becomes negative, even when the requests run concurrently.
          const updated = await tx.billingAccount.updateMany({
            where: { id: account.id, creditBalanceCents: { gte: billableCents } },
            data: {
              creditBalanceCents: { decrement: billableCents },
              unbilledUsageMicros,
            },
          });
          if (updated.count === 0) {
            throw new ChargeRejectedError('insufficient-credit');
          }
        } else {
          await tx.billingAccount.update({
            where: { id: account.id },
            data: { unbilledUsageMicros },
          });
        }

        await tx.creditTransaction.create({
          data: {
            billingAccountId: account.id,
            type: CreditTransactionType.USAGE,
            amountCents: -billableCents,
            costMicros,
            balanceAfterCents: account.creditBalanceCents - billableCents,
            idempotencyKey,
            description: `AI usage: ${data.model}`,
            metadata: {
              usageId: data.usageId,
              requestId: data.requestId,
              costMicros,
              unbilledUsageMicros,
              ...(data.reservationId ? { reservationId: data.reservationId } : {}),
            },
          },
        });
      });
    } catch (error) {
      if (error instanceof ChargeRejectedError) {
        // The charge was not applied, the usage stays visible as an unpaid
        // usage event. The balance of the account is untouched.
        await this.recordRejectedCharge(data, error.reason);
        return;
      }
      if (isUniqueViolation(error)) {
        // The charge was already applied. The unique constraint of the
        // idempotency key is the guarantee, the transaction was rolled back.
        const existing = await prisma.creditTransaction.findUnique({
          where: { idempotencyKey },
        });
        if (existing) return;
      }
      throw error;
    }
  }

  private async lockAccount(
    tx: {
      $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
    },
    organizationId: string,
  ): Promise<LockedAccount | null> {
    // The lock serializes the charges and the reservations of the
    // organization.
    const rows = (await tx.$queryRaw`
      SELECT id,
             credit_balance_cents AS "creditBalanceCents",
             unbilled_usage_micros AS "unbilledUsageMicros",
             reserved_micros AS "reservedMicros"
      FROM billing_accounts
      WHERE organization_id = ${organizationId}::uuid
      FOR UPDATE
    `) as LockedAccount[];
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      creditBalanceCents: Number(row.creditBalanceCents),
      unbilledUsageMicros: Number(row.unbilledUsageMicros),
      reservedMicros: BigInt(row.reservedMicros ?? 0),
    };
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

  private async recordRejectedCharge(
    data: { usageId: string; organizationId: string; model: string; requestId: string },
    reason: 'insufficient-credit' | 'spending-limit',
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          organizationId: data.organizationId,
          action: 'BILLING_CHARGE_REJECTED',
          resource: 'BillingAccount',
          requestId: data.requestId,
          severity: AuditSeverity.WARNING,
          metadata: {
            usageId: data.usageId,
            requestId: data.requestId,
            model: data.model,
            reason,
          },
        },
      });
    } catch {
      // The audit trail must not break the shutdown of the delivery worker.
    }
  }
}
