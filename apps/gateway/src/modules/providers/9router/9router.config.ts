/**
 * Configuration options for 9Router Provider Adapter
 */
import type { ProviderCapabilities } from '@baseapikey/shared';

export interface NineRouterConfig {
  apiKey: string;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  providerSlug?: string | undefined;
  capabilities?: Partial<ProviderCapabilities> | undefined;
}

export const DEFAULT_NINE_ROUTER_BASE_URL = 'https://api.9router.com/v1';
export const DEFAULT_NINE_ROUTER_TIMEOUT_MS = 30000;
