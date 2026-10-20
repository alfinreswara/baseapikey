import type { Server } from 'node:http';

export interface DashboardShutdownLogger {
  info(message: string): void;
  error(message: string): void;
}

export interface DashboardShutdownOptions {
  server: Server;
  /** Stop advertising the instance as ready to receive new traffic. */
  markNotReady: () => void;
  /** Time the instance keeps serving traffic while it drains. */
  drainDelayMs: number;
  /** Hard budget for the whole shutdown sequence. */
  timeoutMs: number;
  logger?: DashboardShutdownLogger;
  /** Injectable delay, used by the tests to avoid real waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Invoked when the shutdown exceeds the timeout budget. */
  onTimeout?: () => void;
}

export type DashboardShutdownStatus = 'clean' | 'failed';

export const DEFAULT_DASHBOARD_SHUTDOWN_DRAIN_DELAY_MS = 10_000;
export const DEFAULT_DASHBOARD_SHUTDOWN_TIMEOUT_MS = 30_000;

const consoleLogger: DashboardShutdownLogger = {
  info: (message) => console.log(message),
  error: (message) => console.error(message),
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // The timer stays referenced on purpose: the process must not exit while
    // it is still draining traffic.
    setTimeout(resolve, ms);
  });
}

/**
 * Closes the HTTP server and waits for the requests that are still running.
 * Node stops accepting new connections and closes idle keep-alive
 * connections, so only in-flight responses are still written.
 */
export async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * Runs the Dashboard shutdown sequence.
 *
 * The runtime image is distroless and cannot run a shell based `preStop`
 * hook, so Kubernetes sends SIGTERM to the Node process and the process
 * owns the termination sequence: it stops advertising readiness, drains
 * traffic, and only then closes the HTTP server.
 */
export async function shutdownDashboardServer(
  options: DashboardShutdownOptions,
): Promise<DashboardShutdownStatus> {
  const logger = options.logger ?? consoleLogger;
  const sleep = options.sleep ?? defaultSleep;
  const onTimeout =
    options.onTimeout ??
    (() => {
      process.exit(1);
    });

  const forceTimer = setTimeout(() => {
    logger.error(`Dashboard shutdown timed out after ${options.timeoutMs}ms`);
    onTimeout();
  }, options.timeoutMs);
  forceTimer.unref();

  try {
    options.markNotReady();
    if (options.drainDelayMs > 0) {
      logger.info(`Draining dashboard traffic for ${options.drainDelayMs}ms before closing`);
      await sleep(options.drainDelayMs);
    }
    await closeHttpServer(options.server);
    clearTimeout(forceTimer);
    logger.info('Dashboard shutdown completed cleanly');
    return 'clean';
  } catch (error) {
    clearTimeout(forceTimer);
    logger.error(
      `Dashboard shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 'failed';
  }
}

/**
 * Ends the process after a finished shutdown. The exit code is set first so
 * a process that exits on its own reports the same result, and the forced
 * exit only runs when a keep-alive connection keeps the event loop alive.
 */
export function scheduleProcessExit(code: number, delayMs = 1_000): void {
  process.exitCode = code;
  const timer = setTimeout(() => process.exit(code), delayMs);
  timer.unref();
}
