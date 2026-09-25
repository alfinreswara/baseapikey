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

    await prisma.$transaction(async (tx) => {
      const idempotencyKey = `usage:${data.usageId}`;
      if (await tx.creditTransaction.findUnique({ where: { idempotencyKey } })) return;

      const account = await tx.billingAccount.findUnique({
        where: { organizationId: data.organizationId },
        include: { organization: { select: { spendingLimitCents: true } } },
      });
      if (!account) return;

      const accumulatedMicros = account.unbilledUsageMicros + costMicros;
      const billableCents = Math.floor(accumulatedMicros / 10_000);
      const unbilledUsageMicros = accumulatedMicros % 10_000;
      const balanceAfterCents = account.creditBalanceCents - billableCents;

      await tx.billingAccount.update({
        where: { id: account.id },
        data: {
          unbilledUsageMicros,
          ...(billableCents > 0 ? { creditBalanceCents: balanceAfterCents } : {}),
        },
      });
      await tx.creditTransaction.create({
        data: {
          billingAccountId: account.id,
          type: CreditTransactionType.USAGE,
          amountCents: -billableCents,
          balanceAfterCents,
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

      const spendingLimit = account.organization.spendingLimitCents;
      if (!spendingLimit) return;
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const aggregate = await tx.usage.aggregate({
        where: { organizationId: data.organizationId, createdAt: { gte: monthStart } },
        _sum: { estimatedCost: true },
      });
      const spentCents = Number(aggregate._sum.estimatedCost ?? 0) * 100;
      const previousCents = Math.max(0, spentCents - data.estimatedCostUsd * 100);
      for (const threshold of [75, 90, 100]) {
        const boundary = (spendingLimit * threshold) / 100;
        if (previousCents < boundary && spentCents >= boundary) {
          const action = `BILLING_SPENDING_ALERT_${threshold}`;
          const duplicate = await tx.auditLog.findFirst({
            where: {
              organizationId: data.organizationId,
              action,
              createdAt: { gte: monthStart },
            },
            select: { id: true },
          });
          if (!duplicate) {
            await tx.auditLog.create({
              data: {
                organizationId: data.organizationId,
                action,
                resource: 'BillingAccount',
                resourceId: account.id,
                requestId: data.requestId,
                severity: threshold === 100 ? AuditSeverity.CRITICAL : AuditSeverity.WARNING,
                metadata: { threshold, spendingLimitCents: spendingLimit, spentCents },
              },
            });
          }
        }
      }
    });
  }
}
