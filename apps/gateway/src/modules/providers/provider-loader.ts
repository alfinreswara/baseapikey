import { prisma, ProviderStatus } from '@baseapikey/database';
import type { ProviderRegistry } from '@baseapikey/shared';

import { ProviderSecretService } from '../admin/services/provider-secret.service';

import { NineRouterProvider } from './9router';

export async function loadDatabaseProviders(
  registry: ProviderRegistry,
  encryptionKey: string,
): Promise<number> {
  return syncDatabaseProviders(registry, encryptionKey);
}

export async function syncDatabaseProviders(
  registry: ProviderRegistry,
  encryptionKey: string,
): Promise<number> {
  const records = await prisma.provider.findMany({
    where: { status: ProviderStatus.ACTIVE },
    orderBy: { priority: 'asc' },
  });
  const secrets = new ProviderSecretService(encryptionKey);
  let loaded = 0;

  for (const registration of registry.listRegistrations()) {
    if (registration.metadata?.['source'] === 'database') {
      registry.unregister(registration.providerId);
    }
  }

  for (const record of records) {
    if (registry.has(record.slug)) continue;
    const apiKey = secrets.decrypt(record.encryptedApiKey);
    registry.register(
      new NineRouterProvider({
        apiKey,
        baseUrl: record.baseUrl,
        timeoutMs: record.timeoutMs,
        providerSlug: record.slug,
        capabilities: {
          supportsStreaming: record.supportsStreaming,
          supportsImages: record.supportsImages,
          supportsEmbeddings: record.supportsEmbeddings,
          supportsAudio: record.supportsAudio,
          supportsVision: record.supportsVision,
        },
      }),
      { priority: record.priority, maxRetries: record.maxRetries, source: 'database' },
    );
    loaded += 1;
  }
  return loaded;
}
