import assert from 'node:assert/strict';

import { UserStatus } from '@baseapikey/database';

import { API_KEY_PERMISSIONS } from './permissions/permission.constants';
import {
  createTestContainer,
  createTestUserHelper,
  createTestApiKeyHelper,
} from './testing/api-key-test-fixtures';

const createTestApiKey = (label: string): string => `sk_live_${label.padEnd(40, '0')}`;

export async function runApiKeyLifecycleIntegrationTests(): Promise<void> {
  console.log('🧪 Starting API Key Lifecycle Comprehensive Integration Tests (P04-T09)...');

  const container = await createTestContainer();

  // Create primary test user and secondary user (for cross-user isolation tests)
  const userA = await createTestUserHelper(container.mockUserRepo, container.passwordService, {
    email: 'usera@example.com',
    username: 'usera',
  });

  const userB = await createTestUserHelper(container.mockUserRepo, container.passwordService, {
    email: 'userb@example.com',
    username: 'userb',
  });

  // ===========================================================================
  // 1. API Key Generation Tests
  // ===========================================================================
  console.log('\n  ▶ 1. API Key Generation Tests');
  const keyResponse = await container.apiKeyService.createApiKey(userA.id, {
    name: 'Primary Gateway Key',
  });

  assert.ok(keyResponse.id);
  assert.equal(keyResponse.name, 'Primary Gateway Key');
  assert.ok(keyResponse.apiKey.startsWith('sk_live_'));

  const plaintextKeyA = keyResponse.apiKey;
  const keyIdA = keyResponse.id;

  const keyRecordDetails = await container.apiKeyService.getApiKey(userA.id, keyIdA);
  assert.equal(keyRecordDetails.keyPrefix, plaintextKeyA.substring(0, 16));
  assert.deepEqual(keyRecordDetails.permissions, [
    API_KEY_PERMISSIONS.CHAT_COMPLETIONS,
    API_KEY_PERMISSIONS.MODELS_LIST,
  ]);
  console.log('    ✅ Successful key creation with sk_live_ prefix & default permissions verified');

  // Verify AuditLog event recorded for creation
  const auditLogsAfterCreate = container.mockApiKeyRepo.auditLogs;
  assert.ok(
    auditLogsAfterCreate.some((log) => log.action === 'API_KEY_CREATE' && log.apiKeyId === keyIdA),
  );
  console.log('    ✅ API_KEY_CREATE event recorded in AuditLog');

  // ===========================================================================
  // 2. Authentication Middleware Tests
  // ===========================================================================
  console.log('\n  ▶ 2. Authentication Middleware Tests');
  // Valid API Key
  const resValid = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${plaintextKeyA}` },
    payload: { messages: [{ role: 'user', content: 'Hello' }] },
  });
  assert.equal(resValid.statusCode, 200);
  console.log('    ✅ Valid API key authentication succeeded (200 OK)');

  // Invalid API Key
  const resInvalid = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${createTestApiKey('invalid-key')}` },
  });
  assert.equal(resInvalid.statusCode, 401);
  console.log('    ✅ Invalid API key rejected (401 Unauthorized)');

  // Expired API Key
  const { plaintextKey: expiredKey } = await createTestApiKeyHelper(
    container.mockApiKeyRepo,
    container.passwordService,
    userA.id,
    { expiresAt: new Date(Date.now() - 10000) },
  );
  const resExpired = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${expiredKey}` },
  });
  assert.equal(resExpired.statusCode, 401);
  console.log('    ✅ Expired API key rejected (401 Unauthorized)');

  // Missing Authorization Header
  const resMissing = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
  });
  assert.equal(resMissing.statusCode, 401);
  console.log('    ✅ Missing Authorization header rejected (401 Unauthorized)');

  // Invalid Bearer format
  const resFormat = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Basic ${plaintextKeyA}` },
  });
  assert.equal(resFormat.statusCode, 401);
  console.log('    ✅ Invalid Bearer format rejected (401 Unauthorized)');

  // Suspended User
  const suspendedUser = await createTestUserHelper(
    container.mockUserRepo,
    container.passwordService,
    { email: 'suspended@example.com', username: 'suspended', status: UserStatus.SUSPENDED },
  );
  const { plaintextKey: suspendedKey } = await createTestApiKeyHelper(
    container.mockApiKeyRepo,
    container.passwordService,
    suspendedUser.id,
  );
  const resSuspended = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${suspendedKey}` },
  });
  assert.equal(resSuspended.statusCode, 401);
  console.log('    ✅ Suspended user key rejected (401 Unauthorized)');

  // ===========================================================================
  // 3. API Key Management Tests & Cross-User Isolation
  // ===========================================================================
  console.log('\n  ▶ 3. API Key Management Tests & Cross-User Isolation');
  const userKeys = await container.apiKeyService.listApiKeys(userA.id);
  assert.ok(userKeys.length >= 1);
  assert.ok(userKeys.some((k) => k.id === keyIdA));
  console.log('    ✅ List API keys for user succeeded');

  const keyDetails = await container.apiKeyService.getApiKey(userA.id, keyIdA);
  assert.equal(keyDetails.id, keyIdA);
  assert.equal(keyDetails.name, 'Primary Gateway Key');
  console.log('    ✅ Get API key details succeeded');

  // Cross-user access rejection (User B attempting to view User A's key)
  await assert.rejects(async () => {
    await container.apiKeyService.getApiKey(userB.id, keyIdA);
  }, /Forbidden/);
  console.log('    ✅ Cross-user API key access rejected (403 Forbidden)');

  // ===========================================================================
  // 4. API Key Permissions Tests
  // ===========================================================================
  console.log('\n  ▶ 4. API Key Permissions Tests');
  // Attempt /v1/embeddings (requires embeddings:create permission, initially missing)
  const resEmbeddingsDenied = await container.app.inject({
    method: 'POST',
    url: '/v1/embeddings',
    headers: { authorization: `Bearer ${plaintextKeyA}` },
  });
  assert.equal(resEmbeddingsDenied.statusCode, 403);
  console.log('    ✅ Request with missing permission rejected (403 Forbidden)');

  // Update permissions to grant embeddings:create
  const updatedPerms = await container.permissionService.updatePermissions(userA.id, keyIdA, {
    permissions: [API_KEY_PERMISSIONS.CHAT_COMPLETIONS, API_KEY_PERMISSIONS.EMBEDDINGS_CREATE],
  });
  const permsList = updatedPerms.permissions as string[];
  assert.ok(permsList.includes(API_KEY_PERMISSIONS.EMBEDDINGS_CREATE));
  console.log('    ✅ Permissions updated successfully');

  // Attempt /v1/embeddings again (now granted)
  const resEmbeddingsAllowed = await container.app.inject({
    method: 'POST',
    url: '/v1/embeddings',
    headers: { authorization: `Bearer ${plaintextKeyA}` },
  });
  assert.equal(resEmbeddingsAllowed.statusCode, 200);
  console.log('    ✅ Request allowed after granting new permission (200 OK)');

  // Reject invalid permission string
  await assert.rejects(async () => {
    await container.permissionService.updatePermissions(userA.id, keyIdA, {
      permissions: [
        'invalid:permission' as unknown as (typeof API_KEY_PERMISSIONS)[keyof typeof API_KEY_PERMISSIONS],
      ],
    });
  }, /Invalid or unsupported API key permission/);
  console.log('    ✅ Invalid permission string rejected (400 Bad Request)');

  // ===========================================================================
  // 5. API Key Rotation Tests
  // ===========================================================================
  console.log('\n  ▶ 5. API Key Rotation Tests');
  const rotatedResult = await container.rotationService.rotateApiKey(userA.id, keyIdA);
  assert.equal(rotatedResult.id, keyIdA);
  assert.ok(rotatedResult.apiKey.startsWith('sk_live_'));
  assert.notEqual(rotatedResult.apiKey, plaintextKeyA);

  const newPlaintextKeyA = rotatedResult.apiKey;
  console.log('    ✅ API key rotated successfully');

  // Old key immediately fails authentication
  const resOldKey = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${plaintextKeyA}` },
  });
  assert.equal(resOldKey.statusCode, 401);
  console.log('    ✅ Old API key rejected immediately (401 Unauthorized)');

  // New key authenticates successfully
  const resNewKey = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${newPlaintextKeyA}` },
  });
  assert.equal(resNewKey.statusCode, 200);
  console.log('    ✅ New rotated API key authenticated successfully (200 OK)');

  // ===========================================================================
  // 6. Usage Tracking & lastUsedAt Tests
  // ===========================================================================
  console.log('\n  ▶ 6. Usage Tracking Tests');
  // Wait briefly for setImmediate background usage recording
  await new Promise((resolve) => setTimeout(resolve, 50));

  const usageRecords = await container.mockUsageRepo.findByApiKeyId(keyIdA);
  assert.ok(usageRecords.length >= 1);

  const usageRec = usageRecords[0];
  assert.ok(usageRec);
  assert.equal(usageRec.userId, userA.id);
  assert.equal(usageRec.apiKeyId, keyIdA);
  assert.equal(usageRec.provider, 'openai');
  assert.equal(usageRec.model, 'gpt-4o');
  assert.equal(usageRec.totalTokens, 150);
  assert.equal(usageRec.estimatedCost, 0.003);

  // Check lastUsedAt updated on key
  const keyAfterUsage = await container.mockApiKeyRepo.findById(keyIdA);
  assert.ok(keyAfterUsage?.lastUsedAt);
  console.log('    ✅ Usage tracking recorded token counts, cost, and updated lastUsedAt');

  // ===========================================================================
  // 7. Quotas & Limits Tests
  // ===========================================================================
  // Reset minute counter & set low per-minute limit (1 req/min)
  await container.mockQuotaRepo.resetMinuteCounter(keyIdA, new Date());
  await container.mockQuotaRepo.updateQuota(keyIdA, { requestsPerMinute: 1 });

  // Make request 1 (allowed)
  const resQuota1 = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${newPlaintextKeyA}` },
  });
  assert.equal(resQuota1.statusCode, 200);

  // Make request 2 (exceeds limit 1/min -> HTTP 429)
  const resQuota2 = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${newPlaintextKeyA}` },
  });
  assert.equal(resQuota2.statusCode, 429);
  console.log('    ✅ Quota limit enforced correctly (HTTP 429 Too Many Requests)');

  // Restore quota limit
  await container.mockQuotaRepo.updateQuota(keyIdA, { requestsPerMinute: 60 });

  // ===========================================================================
  // 8. API Key Revocation Tests
  // ===========================================================================
  console.log('\n  ▶ 8. API Key Revocation Tests');
  const revokeResult = await container.revocationService.revokeApiKey(userA.id, keyIdA);
  assert.equal(revokeResult.success, true);
  console.log('    ✅ API key revoked successfully');

  // Revoked key cannot authenticate
  const resRevokedAuth = await container.app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: { authorization: `Bearer ${newPlaintextKeyA}` },
  });
  assert.equal(resRevokedAuth.statusCode, 401);
  console.log('    ✅ Revoked API key blocked by authentication middleware (401 Unauthorized)');

  // Revoked key cannot be rotated
  await assert.rejects(async () => {
    await container.rotationService.rotateApiKey(userA.id, keyIdA);
  }, /revoked/);
  console.log('    ✅ Revoked key rotation rejected (400 Bad Request)');

  // Revoked key cannot be updated
  await assert.rejects(async () => {
    await container.apiKeyService.updateApiKey(userA.id, keyIdA, { name: 'New Name' });
  }, /revoked/);
  console.log('    ✅ Revoked key update rejected (400 Bad Request)');

  // ===========================================================================
  // 9. Performance & Latency Verification
  // ===========================================================================
  console.log('\n  ▶ 9. Performance & Latency Verification');
  const { plaintextKey: perfKey } = await createTestApiKeyHelper(
    container.mockApiKeyRepo,
    container.passwordService,
    userA.id,
  );

  const startMs = Date.now();
  const iterations = 10;
  for (let i = 0; i < iterations; i++) {
    await container.app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { authorization: `Bearer ${perfKey}` },
    });
  }
  const avgLatency = (Date.now() - startMs) / iterations;
  console.log(
    `    ✅ Executed ${iterations} requests. Avg Latency: ${avgLatency.toFixed(2)} ms/req (Argon2id verified)`,
  );
  assert.ok(avgLatency < 500, 'Average authentication and request latency must remain acceptable');

  console.log('\n🎉 All API Key Integration Test Cases (P04-T09) passed 100% successfully!\n');
}

if (process.argv[1]?.endsWith('api-key-lifecycle-integration.test.ts')) {
  void runApiKeyLifecycleIntegrationTests();
}
