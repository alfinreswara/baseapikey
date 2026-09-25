import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

import { PrismaClient, UserRole, UserStatus, ProviderStatus, ModelCategory } from '@prisma/client';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derivedKey}`;
}

function encryptProviderApiKey(apiKey: string, encodedKey: string): string {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    throw new Error('PROVIDER_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

async function seed(): Promise<void> {
  console.log('🌱 Starting production database seed...');

  // 1. Default Admin User
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@baseapikey.local';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'AdminSecretPass123!';
  const adminFullName = process.env.ADMIN_FULL_NAME || 'System Administrator';

  const passwordHash = hashPassword(adminPassword);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      username: adminUsername,
      fullName: adminFullName,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
    create: {
      email: adminEmail,
      username: adminUsername,
      fullName: adminFullName,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    },
  });

  console.log(`✅ Default Admin User upserted: ${adminUser.email} (ID: ${adminUser.id})`);

  // 2. Default AI Provider (9Router)
  const providerSlug = '9router';
  const providerName = '9Router AI Gateway';
  const providerBaseUrl = process.env.NINEROUTER_BASE_URL || 'https://api.9router.com/v1';
  const rawProviderApiKey = process.env.NINE_ROUTER_API_KEY || process.env.NINEROUTER_API_KEY;
  const providerEncryptionKey = process.env.PROVIDER_ENCRYPTION_KEY;
  if (rawProviderApiKey && !providerEncryptionKey) {
    throw new Error('PROVIDER_ENCRYPTION_KEY is required when seeding a provider API key');
  }
  const providerEncryptedApiKey =
    rawProviderApiKey && providerEncryptionKey
      ? encryptProviderApiKey(rawProviderApiKey, providerEncryptionKey)
      : 'enc_seed_9router_key';

  const provider = await prisma.provider.upsert({
    where: { slug: providerSlug },
    update: {
      name: providerName,
      baseUrl: providerBaseUrl,
      encryptedApiKey: providerEncryptedApiKey,
      status: ProviderStatus.ACTIVE,
      priority: 100,
      timeoutMs: 60000,
      maxRetries: 2,
      supportsStreaming: true,
      supportsImages: true,
      supportsEmbeddings: true,
      supportsAudio: true,
      supportsVision: true,
    },
    create: {
      name: providerName,
      slug: providerSlug,
      baseUrl: providerBaseUrl,
      encryptedApiKey: providerEncryptedApiKey,
      status: ProviderStatus.ACTIVE,
      priority: 100,
      timeoutMs: 60000,
      maxRetries: 2,
      supportsStreaming: true,
      supportsImages: true,
      supportsEmbeddings: true,
      supportsAudio: true,
      supportsVision: true,
    },
  });

  console.log(
    `✅ Default Provider upserted: ${provider.name} (Slug: ${provider.slug}, ID: ${provider.id})`,
  );

  // 3. Default AI Models
  const defaultModels = [
    {
      name: 'gpt-5',
      slug: 'gpt-5',
      displayName: 'GPT-5',
      category: ModelCategory.CHAT,
      contextWindow: 200000,
      maxOutputTokens: 16384,
      inputPricePerMillion: 2.5,
      outputPricePerMillion: 10.0,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      isActive: true,
    },
    {
      name: 'gpt-5-mini',
      slug: 'gpt-5-mini',
      displayName: 'GPT-5 Mini',
      category: ModelCategory.CHAT,
      contextWindow: 128000,
      maxOutputTokens: 8192,
      inputPricePerMillion: 0.15,
      outputPricePerMillion: 0.6,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      isActive: true,
    },
    {
      name: 'claude-3-5-sonnet',
      slug: 'claude-sonnet',
      displayName: 'Claude 3.5 Sonnet',
      category: ModelCategory.CHAT,
      contextWindow: 200000,
      maxOutputTokens: 8192,
      inputPricePerMillion: 3.0,
      outputPricePerMillion: 15.0,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: false,
      isActive: true,
    },
    {
      name: 'gemini-2.5-pro',
      slug: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      category: ModelCategory.CHAT,
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      inputPricePerMillion: 1.25,
      outputPricePerMillion: 5.0,
      supportsStreaming: true,
      supportsVision: true,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      isActive: true,
    },
    {
      name: 'deepseek-chat',
      slug: 'deepseek-chat',
      displayName: 'DeepSeek V3',
      category: ModelCategory.CHAT,
      contextWindow: 64000,
      maxOutputTokens: 8192,
      inputPricePerMillion: 0.27,
      outputPricePerMillion: 1.1,
      supportsStreaming: true,
      supportsVision: false,
      supportsFunctionCalling: true,
      supportsJsonMode: true,
      supportsReasoning: true,
      isActive: true,
    },
  ];

  for (const modelData of defaultModels) {
    const aiModel = await prisma.aIModel.upsert({
      where: {
        providerId_slug: {
          providerId: provider.id,
          slug: modelData.slug,
        },
      },
      update: {
        name: modelData.name,
        displayName: modelData.displayName,
        category: modelData.category,
        contextWindow: modelData.contextWindow,
        maxOutputTokens: modelData.maxOutputTokens,
        inputPricePerMillion: modelData.inputPricePerMillion,
        outputPricePerMillion: modelData.outputPricePerMillion,
        supportsStreaming: modelData.supportsStreaming,
        supportsVision: modelData.supportsVision,
        supportsFunctionCalling: modelData.supportsFunctionCalling,
        supportsJsonMode: modelData.supportsJsonMode,
        supportsReasoning: modelData.supportsReasoning,
        isActive: modelData.isActive,
      },
      create: {
        providerId: provider.id,
        name: modelData.name,
        slug: modelData.slug,
        displayName: modelData.displayName,
        category: modelData.category,
        contextWindow: modelData.contextWindow,
        maxOutputTokens: modelData.maxOutputTokens,
        inputPricePerMillion: modelData.inputPricePerMillion,
        outputPricePerMillion: modelData.outputPricePerMillion,
        supportsStreaming: modelData.supportsStreaming,
        supportsVision: modelData.supportsVision,
        supportsFunctionCalling: modelData.supportsFunctionCalling,
        supportsJsonMode: modelData.supportsJsonMode,
        supportsReasoning: modelData.supportsReasoning,
        isActive: modelData.isActive,
      },
    });

    console.log(`✅ Default AI Model upserted: ${aiModel.displayName} (${aiModel.slug})`);
  }

  console.log('🎉 Database seed completed successfully!');
}

seed()
  .catch((error: unknown) => {
    console.error('❌ Database seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
