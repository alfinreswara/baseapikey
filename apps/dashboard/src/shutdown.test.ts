import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { DashboardServerState } from './server.js';

process.env['NODE_ENV'] = 'test';

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function run(): Promise<void> {
  const { createDashboardServer } = await import('./server.js');
  const { shutdownDashboardServer } = await import('./shutdown.js');

  const state: DashboardServerState = { shuttingDown: false };
  const dashboard = createDashboardServer({
    gatewayUrl: 'http://127.0.0.1:9',
    publicUrl: 'http://127.0.0.1:3001',
    production: false,
    state,
  });
  const dashboardUrl = await listen(dashboard);

  const live = await fetch(`${dashboardUrl}/health/live`);
  assert.equal(live.status, 200);
  const ready = await fetch(`${dashboardUrl}/health/ready`);
  assert.equal(ready.status, 200);
  assert.equal(((await ready.json()) as { ready: boolean }).ready, true);

  state.shuttingDown = true;
  const draining = await fetch(`${dashboardUrl}/health/ready`);
  assert.equal(draining.status, 503);
  const drainingBody = (await draining.json()) as { ready: boolean; reason?: string };
  assert.equal(drainingBody.ready, false);
  assert.equal(drainingBody.reason, 'Dashboard is shutting down');
  const stillLive = await fetch(`${dashboardUrl}/health/live`);
  assert.equal(stillLive.status, 200);
  console.log('✅ Dashboard readiness fails during shutdown while liveness stays healthy');

  const slowServer = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('slow-response');
    }, 150);
  });
  const slowUrl = await listen(slowServer);

  const inFlight = fetch(`${slowUrl}/slow`);
  await new Promise((resolve) => setTimeout(resolve, 20));

  const shutdownStatus = await shutdownDashboardServer({
    server: slowServer,
    markNotReady: () => undefined,
    drainDelayMs: 0,
    timeoutMs: 5_000,
    sleep: async () => undefined,
  });
  assert.equal(shutdownStatus, 'clean');

  const response = await inFlight;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'slow-response');
  console.log('✅ Dashboard shutdown waits for in-flight requests before the server closes');

  await assert.rejects(() => fetch(`${slowUrl}/after-shutdown`));
  console.log('✅ Dashboard stops accepting connections after the shutdown');

  let timeoutTriggered = false;
  const stuckServer = createServer(() => undefined);
  const stuckUrl = await listen(stuckServer);
  const hangingRequest = fetch(`${stuckUrl}/hang`).catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stuckShutdown = shutdownDashboardServer({
    server: stuckServer,
    markNotReady: () => undefined,
    drainDelayMs: 0,
    timeoutMs: 50,
    sleep: async () => undefined,
    onTimeout: () => {
      timeoutTriggered = true;
    },
  });
  void stuckShutdown.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(timeoutTriggered, true);
  stuckServer.closeAllConnections();
  await hangingRequest;
  console.log('✅ Dashboard shutdown budget forces the exit when the server never closes');

  await new Promise<void>((resolve) => {
    dashboard.close(() => resolve());
  });

  console.log('Dashboard shutdown tests passed');
}

void run();
