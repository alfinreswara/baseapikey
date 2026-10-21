// Regression test of the load test stub.
//
// The stub is a local test double for the 9Router upstream. The test proves
// the properties the load tests rely on:
//
// - the stub binds to the loopback interface, the control endpoint of the
//   stub is not reachable from another host,
// - the control endpoint accepts only a known mode, a caller can not write an
//   arbitrary value into the state of the stub,
// - a value of a request can not forge a log entry of the stub.
//
//   node loadtest/stub/stub-9router.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STUB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stub-9router.mjs');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForStub(child, output, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (output().includes('listening on')) return output();
    if (child.exitCode !== null) throw new Error(`the stub exited with ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('the stub did not start in time');
}

function connect(host, port, timeoutMs = 2_000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function run() {
  console.log('🧪 Starting the Load Test Stub Tests...');

  const port = await freePort();
  const child = spawn(process.execPath, [STUB], {
    env: { ...process.env, STUB_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', () => undefined);

  try {
    const log = await waitForStub(child, () => stdout);

    // 1. The stub binds to the loopback interface.
    assert.match(
      log,
      /listening on http:\/\/127\.0\.0\.1:\d+/,
      'the stub has to bind to the loopback interface',
    );
    console.log('  ✅ The stub binds to the loopback interface');

    // 2. The control endpoint of the stub is not reachable from another host.
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((entry) => entry && entry.family === 'IPv4' && !entry.internal);
    if (external) {
      const reachable = await connect(external.address, port);
      assert.equal(reachable, false, `the stub must not be reachable on ${external.address}`);
      console.log('  ✅ The control endpoint is not reachable from another host');
    } else {
      console.log('  ➖ No external interface, the reachability check was skipped');
    }

    // 3. A known mode is accepted.
    const accepted = await fetch(`http://127.0.0.1:${port}/control/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'slow' }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { mode: 'slow' });
    console.log('  ✅ A known mode is accepted');

    // 4. An unknown mode is refused, the state of the stub is unchanged.
    const rejected = await fetch(`http://127.0.0.1:${port}/control/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'not-a-mode' }),
    });
    assert.equal(rejected.status, 400, 'an unknown mode has to be refused');
    const stats = await (await fetch(`http://127.0.0.1:${port}/control/stats`)).json();
    assert.equal(stats.mode, 'slow', 'the mode of the stub must not change');
    console.log('  ✅ An unknown mode is refused and the state stays unchanged');

    // 5. A mode with a line break can not forge a log entry of the stub.
    const injection = await fetch(`http://127.0.0.1:${port}/control/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ok\n[stub-9router] forged log entry' }),
    });
    assert.equal(injection.status, 400, 'a mode with a line break has to be refused');
    const afterInjection = await (await fetch(`http://127.0.0.1:${port}/control/stats`)).json();
    assert.equal(afterInjection.mode, 'slow', 'the mode of the stub must not change');
    assert.ok(
      !stdout.includes('forged log entry'),
      'a value of a request must not end up in the log of the stub',
    );
    console.log('  ✅ A request can not forge a log entry of the stub');

    // 6. The stub answers the endpoints of the provider adapter.
    const models = await (await fetch(`http://127.0.0.1:${port}/v1/models`)).json();
    assert.equal(models.data.length, 1);
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.deepEqual(health, { status: 'ok' });
    console.log('  ✅ The stub answers the endpoints of the provider adapter');
  } finally {
    child.kill('SIGKILL');
  }

  console.log('🎉 All Load Test Stub Tests passed successfully!\n');
}

void run();
