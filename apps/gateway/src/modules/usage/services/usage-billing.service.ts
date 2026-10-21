import { AuditSeverity, CreditTransactionType, prisma } from '@baseapikey/database';

export interface IUsageBillingService {
  charge(data: {
    usageId: string;
    organizationId: string;
    estimatedCostUsd: number;
    model: string;
    requestId: string;
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
}

/**
 * Applies the credit of a usage event.
 *
 * The whole charge runs in one transaction and the row of the billing account
 * is locked while it runs, so the charges of an organization are serialized:
 *
 * - the balance is decremented with a relative and conditional update, it can
 *   never become negative and it can never overwrite the update of another
 *   charge,
 * - the spending limit is checked while the account is locked,
 * - the ledger entry is written with the idempotency key of the usage event.
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
  }): Promise<void> {
    const costMicros = Math.max(0, Math.round(data.estimatedCostUsd * 1_000_000));
    if (costMicros === 0) return;

    const idempotencyKey = `usage:${data.usageId}`;

    try {
      await prisma.$transaction(async (tx) => {
        // The lock serializes the charges of the organization.
        const rows = await tx.$queryRaw<LockedAccount[]>`
          SELECT id,
                 credit_balance_cents AS "creditBalanceCents",
                 unbilled_usage_micros AS "unbilledUsageMicros"
          FROM billing_accounts
          WHERE organization_id = ${data.organizationId}::uuid
          FOR UPDATE
        `;
        const account = rows[0];
        if (!account) {
          // Without a billing account there is nothing to charge.
          return;
        }

        const spendingLimitCents = await this.getSpendingLimitCents(tx, data.organizationId);
        if (spendingLimitCents !== null) {
          const spentMicros = await this.getSpentMicros(tx, data.organizationId);
          if (spentMicros + costMicros > spendingLimitCents * MICROS_PER_CENT) {
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
            balanceAfterCents: account.creditBalanceCents - billableCents,
            idempotencyKey,
            description: `AI usage: ${data.model}`,
            metadata: {
              usageId: data.usageId,
              requestId: data.requestId,
              costMicros,
              unbilledUsageMicros,
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

  private async getSpendingLimitCents(
    tx: { organization: { findFirst: (args: never) => Promise<unknown> } },
    organizationId: string,
  ): Promise<number | null> {
    const organization = (await tx.organization.findFirst({
      where: { id: organizationId },
      select: { spendingLimitCents: true },
    } as never)) as { spendingLimitCents: number | null } | null;
    return organization?.spendingLimitCents ?? null;
  }

  private async getSpentMicros(
    tx: { usage: { aggregate: (args: never) => Promise<unknown> } },
    organizationId: string,
  ): Promise<number> {
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const aggregate = (await tx.usage.aggregate({
      where: { organizationId, createdAt: { gte: monthStart } },
      _sum: { estimatedCost: true },
    } as never)) as { _sum: { estimatedCost: unknown } | null };
    const spent = Number(aggregate._sum?.estimatedCost ?? 0);
    return Math.round(spent * 1_000_000);
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
