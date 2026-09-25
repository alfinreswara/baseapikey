import { ProviderRegistryError } from './provider-registry.error';
import type {
  ProviderCapabilityQuery,
  ProviderLookupResult,
  ProviderRegistration,
} from './provider-registry.types';
import type { IProviderAdapter } from './provider.interface';
import type { ProviderCapabilities } from './provider.types';

/**
 * ProviderRegistry manages registered AI provider adapters.
 * Provides lookup by provider ID, capability filtering, and contract validation.
 */
export class ProviderRegistry {
  private readonly registrations = new Map<string, ProviderRegistration>();

  /**
   * Registers an AI provider adapter.
   * Throws ProviderRegistryError if contract validation fails or duplicate provider ID exists.
   */
  register(provider: IProviderAdapter, metadata?: Record<string, unknown>): void {
    this.validateProvider(provider);

    const providerId = provider.getName();
    if (this.registrations.has(providerId)) {
      throw new ProviderRegistryError(
        'DUPLICATE_PROVIDER_REGISTRATION',
        `Provider '${providerId}' is already registered in the registry`,
        409,
        { providerId },
      );
    }

    const registration: ProviderRegistration = {
      providerId,
      provider,
      registeredAt: new Date(),
      metadata,
    };

    this.registrations.set(providerId, registration);
  }

  /**
   * Unregisters a provider by its unique identifier.
   */
  unregister(providerId: string): boolean {
    return this.registrations.delete(providerId);
  }

  /**
   * Retrieves registered provider adapter by ID.
   * Throws ProviderRegistryError (404) if provider is not found.
   */
  get(providerId: string): IProviderAdapter {
    const registration = this.registrations.get(providerId);
    if (!registration) {
      throw new ProviderRegistryError(
        'PROVIDER_NOT_FOUND',
        `Provider '${providerId}' is not registered in the provider registry`,
        404,
        { providerId },
      );
    }
    return registration.provider;
  }

  /**
   * Performs a safe lookup query returning metadata without throwing.
   */
  lookup(providerId: string): ProviderLookupResult {
    const registration = this.registrations.get(providerId);
    if (!registration) {
      return { found: false };
    }
    return {
      found: true,
      provider: registration.provider,
      registration,
    };
  }

  /**
   * Checks if provider ID is currently registered.
   */
  has(providerId: string): boolean {
    return this.registrations.has(providerId);
  }

  /**
   * Returns array of all registered provider adapters.
   */
  list(): IProviderAdapter[] {
    return Array.from(this.registrations.values()).map((r) => r.provider);
  }

  /**
   * Returns array of all provider registrations with metadata.
   */
  listRegistrations(): ProviderRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * Returns provider adapters supporting specified capability.
   */
  getByCapability(capability: ProviderCapabilityQuery): IProviderAdapter[] {
    const normKey = this.normalizeCapabilityKey(capability);
    return this.list().filter((provider) => {
      const caps = provider.getCapabilities();
      return Boolean(caps[normKey]);
    });
  }

  /**
   * Clears all registered providers from registry.
   */
  clear(): void {
    this.registrations.clear();
  }

  private validateProvider(provider: IProviderAdapter): void {
    if (!provider || typeof provider !== 'object') {
      throw new ProviderRegistryError(
        'INVALID_PROVIDER_CONTRACT',
        'Provider registration failed: provider instance must be an object',
        400,
      );
    }

    if (typeof provider.getName !== 'function' || !provider.getName()) {
      throw new ProviderRegistryError(
        'INVALID_PROVIDER_CONTRACT',
        'Provider registration failed: provider must implement getName() returning a non-empty string',
        400,
      );
    }

    if (typeof provider.getCapabilities !== 'function') {
      throw new ProviderRegistryError(
        'INVALID_PROVIDER_CONTRACT',
        `Provider registration failed for '${provider.getName()}': provider must implement getCapabilities()`,
        400,
      );
    }

    const caps = provider.getCapabilities();
    if (!caps || typeof caps !== 'object') {
      throw new ProviderRegistryError(
        'INVALID_PROVIDER_CONTRACT',
        `Provider registration failed for '${provider.getName()}': getCapabilities() must return a valid object`,
        400,
      );
    }

    if (
      typeof provider.chat !== 'function' ||
      typeof provider.streamChat !== 'function' ||
      typeof provider.listModels !== 'function' ||
      typeof provider.healthCheck !== 'function'
    ) {
      throw new ProviderRegistryError(
        'INVALID_PROVIDER_CONTRACT',
        `Provider registration failed for '${provider.getName()}': provider must implement chat(), streamChat(), listModels(), and healthCheck()`,
        400,
      );
    }
  }

  private normalizeCapabilityKey(capability: ProviderCapabilityQuery): keyof ProviderCapabilities {
    switch (capability) {
      case 'chat':
        return 'supportsChat';
      case 'streaming':
        return 'supportsStreaming';
      case 'models':
        return 'supportsModels';
      case 'tools':
        return 'supportsTools';
      case 'vision':
        return 'supportsVision';
      case 'embeddings':
        return 'supportsEmbeddings';
      case 'images':
        return 'supportsImages';
      case 'audio':
        return 'supportsAudio';
      default:
        return capability;
    }
  }
}
