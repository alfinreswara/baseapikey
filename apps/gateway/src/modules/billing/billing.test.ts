import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  BillingInvoiceStatus,
  CreditTransactionType,
  OrganizationMemberStatus,
  OrganizationRole,
} from '@baseapikey/database';

import { BillingForbiddenError, InvalidBillingWebhookError } from './errors/billing.errors';
import type { IBillingPaymentProvider } from './providers/billing-payment.provider';
import type { IBillingRepository } from './repositories/billing.repository';
import { BillingService } from './services/billing.service';

const now = new Date('2026-09-19T00:00:00.000Z');
let applied = 0;

const repository: IBillingRepository = {
  getAccess: async (_organizationId, userId) =>
    userId === 'member'
      ? { role: OrganizationRole.MEMBER, status: OrganizationMemberStatus.ACTIVE }
      : { role: OrganizationRole.OWNER, status: OrganizationMemberStatus.ACTIVE },
  getAccount: async (organizationId) => ({
    id: 'account-id',
    organizationId,
    status: 'ACTIVE',
    currency: 'USD',
    creditBalanceCents: 1200,
    currentPeriodStart: now,
    currentPeriodEnd: null,
    updatedAt: now,
  }),
  listInvoices: async () => [
    {
      id: 'invoice-id',
      status: BillingInvoiceStatus.OPEN,
      currency: 'USD',
      subtotalCents: 1000,
      taxCents: 100,
      totalCents: 1100,
      invoiceUrl: null,
      periodStart: now,
      periodEnd: now,
      dueAt: null,
      paidAt: null,
      createdAt: now,
    },
  ],
  listTransactions: async () => [
    {
      id: 'transaction-id',
      type: CreditTransactionType.PURCHASE,
      amountCents: 1200,
      balanceAfterCents: 1200,
      description: 'Test purchase',
      createdAt: now,
    },
  ],
  applyCreditPurchase: async ({ amountCents }) => {
    applied += 1;
    return { applied: true, balanceAfterCents: 1200 + amountCents };
  },
};

const paymentProvider: IBillingPaymentProvider = {
  name: 'test-payments',
  createCheckout: async (request) => ({
    checkoutId: request.idempotencyKey,
    checkoutUrl: 'https://payments.example/checkout',
    expiresAt: null,
  }),
};

async function run(): Promise<void> {
  const secret = 'billing-webhook-secret';
  const service = new BillingService(repository, paymentProvider, secret);
  const account = await service.getAccount('owner', 'organization-id');
  assert.equal(account['creditBalanceCents'], 1200);
  await assert.rejects(service.getAccount('member', 'organization-id'), BillingForbiddenError);

  const checkout = await service.createCheckout('owner', 'organization-id', {
    amountCents: 500,
    successUrl: 'https://app.example/success',
    cancelUrl: 'https://app.example/cancel',
  });
  assert.equal(checkout.checkoutUrl, 'https://payments.example/checkout');

  const webhook = {
    id: 'event-1',
    type: 'credit.purchased' as const,
    organizationId: '11111111-1111-4111-8111-111111111111',
    amountCents: 500,
    currency: 'USD',
  };
  const signature = createHmac('sha256', secret)
    .update(
      `${webhook.id}.${webhook.type}.${webhook.organizationId}.${webhook.amountCents}.${webhook.currency}`,
    )
    .digest('hex');
  const result = await service.processWebhook('test-payments', signature, webhook);
  assert.equal(result.balanceAfterCents, 1700);
  assert.equal(applied, 1);
  await assert.rejects(
    service.processWebhook('test-payments', '0'.repeat(64), webhook),
    InvalidBillingWebhookError,
  );
  console.log('✅ Billing access, checkout, and signed webhook tests passed');
}

void run();
