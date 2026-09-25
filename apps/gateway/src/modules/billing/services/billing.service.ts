import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { OrganizationRole } from '@baseapikey/database';
import { NotFoundError } from '@baseapikey/shared';

import { toCursorPage, type CursorPage } from '../../common/pagination';
import type { BillingWebhookDto, CreateCheckoutDto } from '../dto/billing.dto';
import { BillingForbiddenError, InvalidBillingWebhookError } from '../errors/billing.errors';
import type {
  CheckoutResult,
  IBillingPaymentProvider,
} from '../providers/billing-payment.provider';
import type {
  BillingAccountRecord,
  BillingInvoiceRecord,
  CreditTransactionRecord,
  IBillingRepository,
} from '../repositories/billing.repository';

export class BillingService {
  constructor(
    private readonly repository: IBillingRepository,
    private readonly paymentProvider: IBillingPaymentProvider,
    private readonly webhookSecret?: string,
  ) {}

  async getAccount(userId: string, organizationId: string): Promise<Record<string, unknown>> {
    await this.requireManager(userId, organizationId);
    const account = await this.repository.getAccount(organizationId);
    if (!account) throw new NotFoundError('Billing account');
    return this.accountDto(account);
  }

  async listInvoices(
    userId: string,
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<Record<string, unknown> & { id: string }>> {
    await this.requireManager(userId, organizationId);
    const records = await this.repository.listInvoices(organizationId, limit, cursor);
    return toCursorPage(
      records.map((invoice) => this.invoiceDto(invoice)),
      limit,
    );
  }

  async listTransactions(
    userId: string,
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<Record<string, unknown> & { id: string }>> {
    await this.requireManager(userId, organizationId);
    const records = await this.repository.listTransactions(organizationId, limit, cursor);
    return toCursorPage(
      records.map((transaction) => this.transactionDto(transaction)),
      limit,
    );
  }

  async createCheckout(
    userId: string,
    organizationId: string,
    dto: CreateCheckoutDto,
  ): Promise<CheckoutResult> {
    await this.requireManager(userId, organizationId);
    const account = await this.repository.getAccount(organizationId);
    if (!account) throw new NotFoundError('Billing account');
    return this.paymentProvider.createCheckout({
      organizationId,
      amountCents: dto.amountCents,
      currency: account.currency,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
      idempotencyKey: randomUUID(),
    });
  }

  async processWebhook(
    provider: string,
    signature: string | undefined,
    dto: BillingWebhookDto,
  ): Promise<{ applied: boolean; balanceAfterCents: number }> {
    if (!this.webhookSecret || !signature) throw new InvalidBillingWebhookError();
    const canonical = `${dto.id}.${dto.type}.${dto.organizationId}.${dto.amountCents}.${dto.currency}`;
    const expected = createHmac('sha256', this.webhookSecret).update(canonical).digest('hex');
    const supplied = signature.replace(/^sha256=/, '').toLowerCase();
    if (
      !/^[a-f0-9]{64}$/.test(supplied) ||
      supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      throw new InvalidBillingWebhookError();
    }
    return this.repository.applyCreditPurchase({
      provider,
      providerEventId: dto.id,
      organizationId: dto.organizationId,
      amountCents: dto.amountCents,
      currency: dto.currency,
      description: dto.description,
      payload: { ...dto },
    });
  }

  private async requireManager(userId: string, organizationId: string): Promise<void> {
    const membership = await this.repository.getAccess(organizationId, userId);
    if (
      !membership ||
      (membership.role !== OrganizationRole.OWNER && membership.role !== OrganizationRole.ADMIN)
    ) {
      throw new BillingForbiddenError();
    }
  }

  private accountDto(account: BillingAccountRecord): Record<string, unknown> {
    return {
      id: account.id,
      organizationId: account.organizationId,
      status: account.status,
      currency: account.currency,
      creditBalanceCents: account.creditBalanceCents,
      unbilledUsageMicros: account.unbilledUsageMicros ?? 0,
      currentPeriodStart: account.currentPeriodStart.toISOString(),
      currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private invoiceDto(invoice: BillingInvoiceRecord): Record<string, unknown> & { id: string } {
    return {
      ...invoice,
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
      dueAt: invoice.dueAt?.toISOString() ?? null,
      paidAt: invoice.paidAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
    };
  }

  private transactionDto(
    transaction: CreditTransactionRecord,
  ): Record<string, unknown> & { id: string } {
    return { ...transaction, createdAt: transaction.createdAt.toISOString() };
  }
}
