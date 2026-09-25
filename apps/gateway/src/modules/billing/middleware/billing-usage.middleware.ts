import { BillingAccountStatus, prisma } from '@baseapikey/database';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';

import { BillingUsageBlockedError } from '../errors/billing.errors';

export interface IOrganizationBillingGuard {
  assertCanSpend(organizationId: string): Promise<void>;
}

export class PrismaOrganizationBillingGuard implements IOrganizationBillingGuard {
  async assertCanSpend(organizationId: string): Promise<void> {
    const organization = await prisma.organization.findFirst({
      where: { id: organizationId, isActive: true, deletedAt: null },
      select: {
        spendingLimitCents: true,
        billingAccount: {
          select: { status: true, creditBalanceCents: true },
        },
      },
    });
    if (!organization?.billingAccount) {
      throw new BillingUsageBlockedError('Organization billing account is unavailable');
    }
    if (organization.billingAccount.status !== BillingAccountStatus.ACTIVE) {
      throw new BillingUsageBlockedError('Organization billing account is not active', {
        status: organization.billingAccount.status,
      });
    }
    if (organization.billingAccount.creditBalanceCents < 0) {
      throw new BillingUsageBlockedError('Credit balance is exhausted', {
        creditBalanceCents: organization.billingAccount.creditBalanceCents,
      });
    }
    if (!organization.spendingLimitCents) return;

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const aggregate = await prisma.usage.aggregate({
      where: { organizationId, createdAt: { gte: monthStart } },
      _sum: { estimatedCost: true },
    });
    const spentCents = Number(aggregate._sum.estimatedCost ?? 0) * 100;
    if (spentCents >= organization.spendingLimitCents) {
      throw new BillingUsageBlockedError('Organization monthly spending limit has been reached', {
        spendingLimitCents: organization.spendingLimitCents,
        spentCents,
      });
    }
  }
}

export function requireAvailableBilling(guard: IOrganizationBillingGuard): preHandlerHookHandler {
  return async (request: FastifyRequest): Promise<void> => {
    const organizationId = request.apiKey?.organizationId;
    if (organizationId) await guard.assertCanSpend(organizationId);
  };
}
