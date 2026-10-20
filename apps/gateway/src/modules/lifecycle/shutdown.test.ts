import assert from 'node:assert/strict';

import { HealthService } from '../health/health.service';

import { ShutdownCoordinator, type ShutdownHooks, type ShutdownLogger } from './shutdown';

interface RecordingHooks extends ShutdownHooks {
  calls: string[];
}

function createRecordingHooks(overrides: Partial<ShutdownHooks> = {}): RecordingHooks {
  const calls: string[] = [];
  const hooks: RecordingHooks = {
    calls,
    markNotReady: () => {
      calls.push('markNotReady');
    },
    stopBackgroundWork: async () => {
      calls.push('stopBackgroundWork');
    },
    closeServer: async () => {
      calls.push('closeServer');
    },
    closeResources: async () => {
      calls.push('closeResources');
    },
    ...overrides,
  };
  return hooks;
}

const silentLogger: ShutdownLogger = {
  info: () => undefined,
  error: () => undefined,
};

async function runShutdownTests(): Promise<void> {
  console.log('🧪 Starting Gateway Shutdown Tests...');

  const hooks = createRecordingHooks();
  const drainedDelays: number[] = [];
  const coordinator = new ShutdownCoordinator({
    hooks,
    drainDelayMs: 10_000,
    timeoutMs: 30_000,
    logger: silentLogger,
    sleep: async (ms) => {
      drainedDelays.push(ms);
    },
  });

  const result = await coordinator.shutdown('SIGTERM');
  assert.equal(result.status, 'clean');
  assert.deepEqual(hooks.calls, [
    'markNotReady',
    'stopBackgroundWork',
    'closeServer',
    'closeResources',
  ]);
  assert.deepEqual(drainedDelays, [10_000]);
  console.log('  ✅ Shutdown drains traffic before it closes the server and the resources');

  const repeated = await coordinator.shutdown('SIGINT');
  assert.equal(repeated.status, 'clean');
  assert.deepEqual(hooks.calls, [
    'markNotReady',
    'stopBackgroundWork',
    'closeServer',
    'closeResources',
  ]);
  console.log('  ✅ Repeated shutdown requests are ignored instead of interrupting cleanup');

  const failingHooks = createRecordingHooks();
  failingHooks.closeServer = async () => {
    failingHooks.calls.push('closeServer');
    throw new Error('close failed');
  };
  const failingCoordinator = new ShutdownCoordinator({
    hooks: failingHooks,
    drainDelayMs: 0,
    timeoutMs: 30_000,
    logger: silentLogger,
    sleep: async () => undefined,
  });
  const failingResult = await failingCoordinator.shutdown('SIGTERM');
  assert.equal(failingResult.status, 'failed');
  assert.ok(failingResult.error instanceof Error);
  assert.deepEqual(failingHooks.calls, ['markNotReady', 'stopBackgroundWork', 'closeServer']);
  console.log('  ✅ A failing shutdown step is reported instead of silently succeeding');

  let timeoutTriggered = false;
  const timeoutCoordinator = new ShutdownCoordinator({
    hooks: createRecordingHooks({
      closeServer: () => new Promise<void>(() => undefined),
    }),
    drainDelayMs: 0,
    timeoutMs: 20,
    logger: silentLogger,
    sleep: async () => undefined,
    onTimeout: () => {
      timeoutTriggered = true;
    },
  });
  const stuckShutdown = timeoutCoordinator.shutdown('SIGTERM');
  void stuckShutdown.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(timeoutTriggered, true);
  console.log('  ✅ The shutdown budget forces the exit when a close step never finishes');

  const healthService = new HealthService('gateway', '0.1.0', 'test', {
    async database(): Promise<void> {},
    async redis(): Promise<void> {},
  });
  const readyBeforeShutdown = await healthService.getReadiness();
  assert.equal(readyBeforeShutdown.ready, true);
  assert.equal(readyBeforeShutdown.status, 'ok');

  healthService.markShuttingDown();
  const readyDuringShutdown = await healthService.getReadiness();
  assert.equal(readyDuringShutdown.ready, false);
  assert.equal(readyDuringShutdown.status, 'error');
  assert.equal(readyDuringShutdown.reason, 'Gateway is shutting down');
  assert.equal(healthService.getLiveness().status, 'ok');
  console.log('  ✅ Readiness fails during shutdown while liveness stays healthy');

  console.log('🎉 All Gateway Shutdown Tests passed successfully!\n');
}

if (process.argv[1]?.endsWith('shutdown.test.ts')) {
  void runShutdownTests();
}
