import { BillingNotConfiguredError } from '../errors/billing.errors';

export interface CheckoutRequest {
  organizationId: string;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}

export interface CheckoutResult {
  checkoutId: string;
  checkoutUrl: string;
  expiresAt: string | null;
}

export interface IBillingPaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
}

export class DisabledBillingPaymentProvider implements IBillingPaymentProvider {
  readonly name = 'disabled';

  async createCheckout(_request: CheckoutRequest): Promise<CheckoutResult> {
    throw new BillingNotConfiguredError();
  }
}

export class HttpBillingPaymentProvider implements IBillingPaymentProvider {
  readonly name: string;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    name = 'payment-provider',
    private readonly timeoutMs = 10_000,
  ) {
    this.name = name;
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/checkouts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Payment provider returned HTTP ${response.status}`);
      }
      const result = (await response.json()) as Partial<CheckoutResult>;
      if (!result.checkoutId || !result.checkoutUrl) {
        throw new Error('Payment provider returned an invalid checkout response');
      }
      return {
        checkoutId: result.checkoutId,
        checkoutUrl: result.checkoutUrl,
        expiresAt: result.expiresAt ?? null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
