import {
  BillingInvoiceStatus,
  CreditTransactionType,
  OrganizationMemberStatus,
  OrganizationRole,
  prisma,
} from '@baseapikey/database';

export interface BillingAccessRecord {
  role: OrganizationRole;
  status: OrganizationMemberStatus;
}

export interface BillingAccountRecord {
  id: string;
  organizationId: string;
  status: string;
  currency: string;
  creditBalanceCents: number;
  unbilledUsageMicros?: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date | null;
  updatedAt: Date;
}

export interface BillingInvoiceRecord {
  id: string;
  status: BillingInvoiceStatus;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  invoiceUrl: string | null;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
}

export interface CreditTransactionRecord {
  id: string;
  type: CreditTransactionType;
  amountCents: number;
  balanceAfterCents: number;
  description: string | null;
  createdAt: Date;
}

export interface IBillingRepository {
  getAccess(organizationId: string, userId: string): Promise<BillingAccessRecord | null>;
  getAccount(organizationId: string): Promise<BillingAccountRecord | null>;
  listInvoices(
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<BillingInvoiceRecord[]>;
  listTransactions(
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<CreditTransactionRecord[]>;
  applyCreditPurchase(data: {
    provider: string;
    providerEventId: string;
    organizationId: string;
    amountCents: number;
    currency: string;
    description?: string | undefined;
    payload: Record<string, unknown>;
  }): Promise<{ applied: boolean; balanceAfterCents: number }>;
}

export class PrismaBillingRepository implements IBillingRepository {
  async getAccess(organizationId: string, userId: string): Promise<BillingAccessRecord | null> {
    return prisma.organizationMember.findFirst({
      where: { organizationId, userId, status: OrganizationMemberStatus.ACTIVE },
      select: { role: true, status: true },
    });
  }

  async getAccount(organizationId: string): Promise<BillingAccountRecord | null> {
    return prisma.billingAccount.findUnique({ where: { organizationId } });
  }

  async listInvoices(
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<BillingInvoiceRecord[]> {
    return prisma.billingInvoice.findMany({
      where: { billingAccount: { organizationId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async listTransactions(
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<CreditTransactionRecord[]> {
    return prisma.creditTransaction.findMany({
      where: { billingAccount: { organizationId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        amountCents: true,
        balanceAfterCents: true,
        description: true,
        createdAt: true,
      },
    });
  }

  async applyCreditPurchase(data: {
    provider: string;
    providerEventId: string;
    organizationId: string;
    amountCents: number;
    currency: string;
    description?: string | undefined;
    payload: Record<string, unknown>;
  }): Promise<{ applied: boolean; balanceAfterCents: number }> {
    return prisma.$transaction(async (tx) => {
      const existing = await tx.billingWebhookEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: data.provider,
            providerEventId: data.providerEventId,
          },
        },
      });
      if (existing?.processedAt) {
        const account = await tx.billingAccount.findUniqueOrThrow({
          where: { organizationId: data.organizationId },
        });
        return { applied: false, balanceAfterCents: account.creditBalanceCents };
      }
      const event =
        existing ??
        (await tx.billingWebhookEvent.create({
          data: {
            provider: data.provider,
            providerEventId: data.providerEventId,
            eventType: 'credit.purchased',
            payload: data.payload as object,
          },
        }));
      const account = await tx.billingAccount.update({
        where: { organizationId: data.organizationId },
        data: { creditBalanceCents: { increment: data.amountCents } },
      });
      await tx.creditTransaction.create({
        data: {
          billingAccountId: account.id,
          type: CreditTransactionType.PURCHASE,
          amountCents: data.amountCents,
          balanceAfterCents: account.creditBalanceCents,
          idempotencyKey: `${data.provider}:${data.providerEventId}`,
          description: data.description ?? 'Credit purchase',
          metadata: { provider: data.provider, currency: data.currency },
        },
      });
      await tx.billingWebhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), error: null },
      });
      return { applied: true, balanceAfterCents: account.creditBalanceCents };
    });
  }
}
