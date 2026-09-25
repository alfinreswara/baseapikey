import assert from 'node:assert/strict';

import { buildApp } from './app';

async function runAppHardeningTests(): Promise<void> {
  console.log('🧪 Starting Gateway Runtime Hardening Tests...');

  const internalErrorMessage = 'database password leaked in internal exception';
  const allowedOrigin = 'https://dashboard.example.com';
  const app = buildApp({
    maxRequestSize: 128,
    corsOrigin: `${allowedOrigin},https://admin.example.com`,
  });
  app.get('/__test/internal-error', async () => {
    throw new Error(internalErrorMessage);
  });

  await app.ready();

  try {
    const internalErrorResponse = await app.inject({
      method: 'GET',
      url: '/__test/internal-error',
    });
    assert.equal(internalErrorResponse.statusCode, 500);
    const internalErrorBody = JSON.parse(internalErrorResponse.body);
    assert.equal(internalErrorBody.error.code, 'INTERNAL_ERROR');
    assert.equal(internalErrorBody.error.message, 'Internal server error');
    assert.equal(internalErrorResponse.body.includes(internalErrorMessage), false);
    console.log('  ✅ Unknown internal errors are logged but not exposed to clients');

    const securityResponse = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: allowedOrigin },
    });
    assert.equal(securityResponse.statusCode, 200);
    assert.equal(securityResponse.headers['access-control-allow-origin'], allowedOrigin);
    assert.equal(securityResponse.headers['x-content-type-options'], 'nosniff');
    assert.equal(securityResponse.headers['x-frame-options'], 'DENY');
    assert.equal(
      securityResponse.headers['strict-transport-security'],
      'max-age=31536000; includeSubDomains',
    );
    assert.equal(typeof securityResponse.headers['content-security-policy'], 'string');

    const rejectedOriginResponse = await app.inject({
      method: 'GET',
      url: '/health/live',
      headers: { origin: 'https://attacker.example.com' },
    });
    assert.equal(rejectedOriginResponse.headers['access-control-allow-origin'], undefined);
    console.log('  ✅ Security headers and configured CORS allowlist are enforced');

    const oversizedPayloadResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'payload@example.com',
        username: 'payload-user',
        fullName: 'x'.repeat(512),
        password: 'StrongPassword123!@#',
      },
    });
    assert.equal(oversizedPayloadResponse.statusCode, 413);
    const oversizedPayloadBody = JSON.parse(oversizedPayloadResponse.body);
    assert.equal(oversizedPayloadBody.error.code, 'PAYLOAD_TOO_LARGE');
    console.log('  ✅ Configured request body limit returns a structured 413 response');

    console.log('🎉 All Gateway Runtime Hardening Tests passed successfully!\n');
  } finally {
    await app.close();
  }
}

if (process.argv[1]?.endsWith('app.test.ts')) {
  void runAppHardeningTests();
}
