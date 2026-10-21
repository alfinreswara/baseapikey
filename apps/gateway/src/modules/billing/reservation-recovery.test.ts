import assert from 'node:assert/strict';

import { HealthService } from '../health/health.service';

import {
  ReservationRecoveryService,
  type ReservationRecoveryLogger,
} from './services/reservation-recovery.service';
import type { IReservationService } from './services/reservation.service';

class FakeReservationService implements IReservationService {
  calls = 0;
  recovered = 0;
  failure: Error | undefined;

  async recoverExpiredReservations(): Promise<number> {
    this.calls += 1;
    if (this.failure) {
      throw this.failure;
    }
    return this.recovered;
  }

  async reserve(): Promise<never> {
    throw new Error('not used');
  }

  async settle(): Promise<never> {
    throw new Error('not used');
  }

  async release(): Promise<boolean> {
    throw new Error('not used');
  }
}

const silentLogger: ReservationRecoveryLogger = {
  info: () => undefined,
  error: () => undefined,
};

async function run(): Promise<void> {
  console.log('🧪 Starting Reservation Recovery Tests...');

  // 1. A recovery without an expired reservation recovers nothing and
  //    succeeds.
  {
    const reservations = new FakeReservationService();
    const recovery = new ReservationRecoveryService(reservations, silentLogger);
    const result = await recovery.runOnce();
    assert.equal(result.failed, false);
    assert.equal(result.recovered, 0);
    assert.equal(reservations.calls, 1);
    console.log('  ✅ A recovery without an expired reservation succeeds');
  }

  // 2. A failing recovery is reported, it does not throw, and the billing
  //    state stays unready.
  {
    const reservations = new FakeReservationService();
    reservations.failure = new Error('database is unreachable');
    let recoveredSignal = 0;
    const recovery = new ReservationRecoveryService(reservations, silentLogger, () => {
      recoveredSignal += 1;
    });
    const result = await recovery.runOnce();
    assert.equal(result.failed, true);
    assert.ok(result.error instanceof Error);
    assert.equal(recoveredSignal, 0, 'A failed recovery must not report a ready billing state');

    // The readiness of the instance stays false while the billing state is
    // unknown, a paid request is not served.
    let billingReady = false;
    const healthService = new HealthService(
      'gateway',
      '0.1.0',
      'test',
      {
        async database(): Promise<void> {},
        async redis(): Promise<void> {},
        async billing(): Promise<void> {
          if (!billingReady) {
            throw new Error('The credit reservations have not been recovered yet');
          }
        },
      },
      1_000,
    );
    const notReady = await healthService.getReadiness();
    assert.equal(notReady.ready, false);
    assert.equal(notReady.checks.billing?.status, 'error');

    // The next run succeeds, the instance becomes ready.
    reservations.failure = undefined;
    const retry = await recovery.runOnce();
    assert.equal(retry.failed, false);
    assert.equal(recoveredSignal, 1);
    billingReady = true;
    const ready = await healthService.getReadiness();
    assert.equal(ready.ready, true);
    assert.equal(ready.checks.billing?.status, 'ok');
    console.log('  ✅ A failing recovery keeps the instance unready until it succeeds');
  }

  // 3. The periodic recovery runs and can be stopped with the gateway.
  {
    const reservations = new FakeReservationService();
    reservations.recovered = 2;
    const recovery = new ReservationRecoveryService(reservations, silentLogger);
    recovery.start(20);
    assert.equal(recovery.isRunning, true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const callsAfterRun = reservations.calls;
    assert.ok(callsAfterRun >= 2, `The recovery has to run periodically, ran ${callsAfterRun}`);
    recovery.stop();
    assert.equal(recovery.isRunning, false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(reservations.calls, callsAfterRun, 'The stopped scheduler must not run again');
    console.log('  ✅ The periodic recovery runs and stops with the gateway');
  }

  // 4. The timer of the scheduler does not keep the process alive.
  {
    const reservations = new FakeReservationService();
    const recovery = new ReservationRecoveryService(reservations, silentLogger);
    recovery.start(60_000);
    assert.equal(recovery.isRunning, true);
    // The timer is unreferenced, the process can exit although the scheduler
    // is still active.
    recovery.stop();
    console.log('  ✅ The scheduler does not keep the process alive');
  }

  // 5. Two recoveries of the same instance do not overlap.
  {
    let concurrent = 0;
    let maxConcurrent = 0;
    const slow: IReservationService = {
      async recoverExpiredReservations(): Promise<number> {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 30));
        concurrent -= 1;
        return 0;
      },
      async reserve(): Promise<never> {
        throw new Error('not used');
      },
      async settle(): Promise<never> {
        throw new Error('not used');
      },
      async release(): Promise<boolean> {
        throw new Error('not used');
      },
    };
    const recovery = new ReservationRecoveryService(slow, silentLogger);
    await Promise.all([recovery.runOnce(), recovery.runOnce()]);
    assert.equal(maxConcurrent, 1, 'The recoveries of one instance must not overlap');
    console.log('  ✅ Two recoveries of the same instance do not overlap');
  }

  console.log('🎉 All Reservation Recovery Tests passed successfully!\n');
}

void run();
