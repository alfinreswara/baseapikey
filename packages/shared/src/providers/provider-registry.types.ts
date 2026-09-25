import type { IProviderAdapter } from './provider.interface';
import type { ProviderCapabilities } from './provider.types';

/**
 * Registration record stored in ProviderRegistry
 */
export interface ProviderRegistration {
  providerId: string;
  provider: IProviderAdapter;
  registeredAt: Date;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Result of provider lookup query
 */
export interface ProviderLookupResult {
  found: boolean;
  provider?: IProviderAdapter | undefined;
  registration?: ProviderRegistration | undefined;
}

/**
 * Allowed capability queries for registry lookup
 */
export type ProviderCapabilityQuery =
  | keyof ProviderCapabilities
  | 'chat'
  | 'streaming'
  | 'models'
  | 'tools'
  | 'vision'
  | 'embeddings'
  | 'images'
  | 'audio';
