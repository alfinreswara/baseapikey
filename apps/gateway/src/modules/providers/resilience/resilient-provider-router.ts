import {
  ProviderError,
  type IProviderAdapter,
  type ProviderCapabilities,
  type ProviderRegistry,
  type ProviderRequestOptions,
} from '@baseapikey/shared';

interface CircuitState {
  failures: number[];
  openUntil: number;
}

export interface ProviderResilienceOptions {
  maxRetries?: number | undefined;
  baseDelayMs?: number | undefined;
  failureThreshold?: number | undefined;
  failureWindowMs?: number | undefined;
  cooldownMs?: number | undefined;
  now?: (() => number) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
}

export class ResilientProviderRouter {
  private readonly circuits = new Map<string, CircuitState>();
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly registry: ProviderRegistry,
    options: ProviderResilienceOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 2;
    this.baseDelayMs = options.baseDelayMs ?? 100;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.failureWindowMs = options.failureWindowMs ?? 60_000;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async execute<T>(
    preferredProviderId: string,
    operation: (provider: IProviderAdapter) => Promise<T>,
    options?: ProviderRequestOptions,
    requiredCapability?: keyof ProviderCapabilities,
  ): Promise<T> {
    const providers = this.orderedProviders(preferredProviderId, requiredCapability);
    let lastError: unknown;

    if (providers.length === 0) {
      throw new ProviderError({
        code: 'PROVIDER_CAPABILITY_UNSUPPORTED',
        message: `No configured provider supports ${requiredCapability ?? 'the requested operation'}`,
        statusCode: 400,
        category: 'INVALID_REQUEST',
        isRetryable: false,
        providerSlug: preferredProviderId,
      });
    }

    for (const provider of providers) {
      if (this.isCircuitOpen(provider.getName())) continue;
      const maxRetries = this.providerMaxRetries(provider.getName());
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        if (options?.signal?.aborted) {
          throw ProviderError.fromHttpStatus(408, 'Request aborted by client', provider.getName());
        }
        try {
          const result = await operation(provider);
          this.recordSuccess(provider.getName());
          return result;
        } catch (error) {
          lastError = error;
          if (!this.isRetryable(error)) throw error;
          this.recordFailure(provider.getName());
          if (attempt === maxRetries) break;
          const jitter = Math.floor(Math.random() * Math.max(1, this.baseDelayMs));
          await this.sleep(this.baseDelayMs * 2 ** attempt + jitter);
        }
      }
    }

    if (lastError) throw lastError;
    throw new ProviderError({
      code: 'PROVIDER_CIRCUIT_OPEN',
      message: 'All configured AI providers are temporarily unavailable',
      statusCode: 503,
      category: 'PROVIDER_UNAVAILABLE',
      isRetryable: true,
      providerSlug: preferredProviderId,
    });
  }

  isCircuitOpen(providerId: string): boolean {
    const state = this.circuits.get(providerId);
    if (!state) return false;
    if (state.openUntil > this.now()) return true;
    if (state.openUntil !== 0) this.circuits.delete(providerId);
    return false;
  }

  private orderedProviders(
    preferredProviderId: string,
    requiredCapability?: keyof ProviderCapabilities,
  ): IProviderAdapter[] {
    const preferred = this.registry.get(preferredProviderId);
    const fallbacks = this.registry
      .listRegistrations()
      .filter((registration) => registration.providerId !== preferredProviderId)
      .sort((a, b) => this.priority(a.metadata) - this.priority(b.metadata))
      .map((registration) => registration.provider);
    const candidates = [preferred, ...fallbacks];
    return requiredCapability
      ? candidates.filter((provider) => Boolean(provider.getCapabilities()[requiredCapability]))
      : candidates;
  }

  private priority(metadata?: Record<string, unknown>): number {
    return typeof metadata?.['priority'] === 'number' ? metadata['priority'] : 100;
  }

  private providerMaxRetries(providerId: string): number {
    const configured = this.registry.lookup(providerId).registration?.metadata?.['maxRetries'];
    return typeof configured === 'number' && Number.isInteger(configured) && configured >= 0
      ? configured
      : this.maxRetries;
  }

  private isRetryable(error: unknown): boolean {
    return error instanceof ProviderError && error.isRetryable;
  }

  private recordSuccess(providerId: string): void {
    this.circuits.delete(providerId);
  }

  private recordFailure(providerId: string): void {
    const now = this.now();
    const state = this.circuits.get(providerId) ?? { failures: [], openUntil: 0 };
    state.failures = state.failures.filter((timestamp) => now - timestamp <= this.failureWindowMs);
    state.failures.push(now);
    if (state.failures.length >= this.failureThreshold) {
      state.openUntil = now + this.cooldownMs;
    }
    this.circuits.set(providerId, state);
  }
}
