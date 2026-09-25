import { buildApp } from '../../app';

import { HealthService } from './health.service';

async function runTests(): Promise<void> {
  const app = buildApp();

  // Test GET /health
  const resHealth = await app.inject({
    method: 'GET',
    url: '/health',
  });
  if (resHealth.statusCode !== 200) {
    throw new Error(`GET /health status should be 200, got ${resHealth.statusCode}`);
  }
  const bodyHealth = resHealth.json();
  if (bodyHealth.status !== 'ok' || bodyHealth.service !== 'gateway') {
    throw new Error(`GET /health response body invalid: ${JSON.stringify(bodyHealth)}`);
  }

  // Test GET /health/live
  const resLive = await app.inject({
    method: 'GET',
    url: '/health/live',
  });
  if (resLive.statusCode !== 200) {
    throw new Error(`GET /health/live status should be 200, got ${resLive.statusCode}`);
  }
  const bodyLive = resLive.json();
  if (bodyLive.status !== 'ok') {
    throw new Error(`GET /health/live response body invalid: ${JSON.stringify(bodyLive)}`);
  }

  // Test GET /health/ready
  const resReady = await app.inject({
    method: 'GET',
    url: '/health/ready',
  });
  if (resReady.statusCode !== 200) {
    throw new Error(`GET /health/ready status should be 200, got ${resReady.statusCode}`);
  }
  const bodyReady = resReady.json();
  if (bodyReady.status !== 'ok' || bodyReady.ready !== true || !bodyReady.checks) {
    throw new Error(`GET /health/ready response body invalid: ${JSON.stringify(bodyReady)}`);
  }

  const unhealthyApp = buildApp({
    healthService: new HealthService('gateway', '0.1.0', 'test', {
      async database(): Promise<void> {
        throw new Error('sensitive database connection detail');
      },
      async redis(): Promise<void> {},
    }),
  });
  const unhealthyResponse = await unhealthyApp.inject({
    method: 'GET',
    url: '/health/ready',
  });
  if (unhealthyResponse.statusCode !== 503) {
    throw new Error(
      `GET /health/ready must return 503 for failed dependencies, got ${unhealthyResponse.statusCode}`,
    );
  }
  const unhealthyBody = unhealthyResponse.json();
  if (
    unhealthyBody.ready !== false ||
    unhealthyBody.checks.database.status !== 'error' ||
    unhealthyBody.checks.redis.status !== 'ok' ||
    unhealthyResponse.body.includes('sensitive database connection detail')
  ) {
    throw new Error(`Failed readiness response is invalid: ${unhealthyResponse.body}`);
  }

  await app.close();
  await unhealthyApp.close();
  console.log('Health check integration tests passed successfully.');
}

void runTests();
