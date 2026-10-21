import assert from 'node:assert/strict';

import {
  ReservationLease,
  type ReservationLeaseLogger,
} from './services/reservation-lease.service';
import type { IReservationService } from './services/reservation.service';

const silentLogger: ReservationLeaseLogger = {
  info: () => undefined,
  error: () => undefined,
};

class FakeReservationService implements IReservationService {
  renewals: Date[] = [];
  renewalResult = true;
  failure: Error | undefined;

  async renew(_reservationId: string, expiresAt: Date): Promise<boolean> {
    this.renewals.push(expiresAt);
    if (this.failure) {
      throw this.failure;
    }
    return this.renewalResult;
  }

  async recoverExpiredReservations(): Promise<number> {
    return 0;
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

async function run(): Promise<void> {
  console.log('🧪 Starting Reservation Lease Tests...');

  // 1. The lease renews the deadline of a reservation that is in use.
  {
    const reservations = new FakeReservationService();
    const lease = new ReservationLease('res-1', reservations, {
      lifetimeMs: 120_000,
      intervalMs: 20,
      onGuaranteeLost: () => undefined,
      logger: silentLogger,
    });
    lease.start();
    assert.equal(lease.isRunning, true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    lease.stop();
    assert.equal(lease.isRunning, false);
    assert.ok(reservations.renewals.length >= 2, 'The lease has to renew the deadline');
    const first = reservations.renewals[0]!.getTime();
    assert.ok(
      first > Date.now() + 60_000,
      'The renewed deadline has to be in the future, the request can still run',
    );
    const renewalsAfterStop = reservations.renewals.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(
      reservations.renewals.length,
      renewalsAfterStop,
      'A stopped lease must not renew any more',
    );
    console.log('  ✅ The lease renews the deadline while the request runs');
  }

  // 2. A reservation that is no longer reserved can not be renewed, the
  //    request lost its credit guarantee.
  {
    const reservations = new FakeReservationService();
    reservations.renewalResult = false;
    let lostReason = '';
    const lease = new ReservationLease('res-2', reservations, {
      lifetimeMs: 120_000,
      intervalMs: 20,
      onGuaranteeLost: (reason) => {
        lostReason = reason;
      },
      logger: silentLogger,
    });
    lease.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    lease.stop();
    assert.notEqual(lostReason, '', 'The lost guarantee has to be reported');
    assert.equal(lease.isRunning, false, 'The lease stops when the guarantee is lost');
    console.log('  ✅ A reservation that is gone reports the lost guarantee');
  }

  // 3. A failed renewal is retried, the guarantee is only lost when the lease
  //    is about to expire.
  {
    const reservations = new FakeReservationService();
    reservations.failure = new Error('the database is unreachable');
    let lost = 0;
    const lease = new ReservationLease('res-3', reservations, {
      // A short lease, the first failure is already too late.
      lifetimeMs: 100,
      intervalMs: 60,
      onGuaranteeLost: () => {
        lost += 1;
      },
      logger: silentLogger,
    });
    lease.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    lease.stop();
    assert.equal(lost, 1, 'The guarantee is lost when the lease can not be renewed');
    console.log('  ✅ A failing renewal loses the guarantee when the lease expires');
  }

  // 4. A failing renewal with a long lease is retried, the request keeps its
  //    credit guarantee.
  {
    const reservations = new FakeReservationService();
    reservations.failure = new Error('the database is unreachable');
    let lost = 0;
    const lease = new ReservationLease('res-4', reservations, {
      lifetimeMs: 120_000,
      intervalMs: 20,
      onGuaranteeLost: () => {
        lost += 1;
      },
      logger: silentLogger,
    });
    lease.start();
    await new Promise((resolve) => setTimeout(resolve, 120));
    lease.stop();
    assert.equal(lost, 0, 'A single failure must not end a long lease');
    console.log('  ✅ A failing renewal is retried while the lease is alive');
  }

  console.log('🎉 All Reservation Lease Tests passed successfully!\n');
}

void run();
