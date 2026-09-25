import type { ProviderRegistry } from '@baseapikey/shared';

import type { NineRouterConfig } from './9router.config';
import { NineRouterProvider } from './9router.provider';

export * from './9router.config';
export * from './9router.types';
export * from './9router.mappers';
export * from './9router.error-mapper';
export * from './9router.provider';

/**
 * Registers NineRouterProvider with ProviderRegistry if valid configuration is present.
 * Fails clearly if API key is missing when registration is explicitly attempted.
 */
export function registerNineRouter(
  registry: ProviderRegistry,
  config: NineRouterConfig,
  metadata?: Record<string, unknown>,
): NineRouterProvider {
  const provider = new NineRouterProvider(config);
  registry.register(provider, metadata);
  return provider;
}
