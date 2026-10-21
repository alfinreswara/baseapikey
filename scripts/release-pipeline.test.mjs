#!/usr/bin/env node
/**
 * Tests of the release pipeline.
 *
 * The tests use fixtures and mocks, they never build an image, never push to
 * a registry, and never publish an image.
 *
 * They verify:
 *
 *   1. The validation of the workflow accepts the workflow of the repository.
 *   2. The validation rejects a workflow that publishes before it scans, a
 *      workflow that does not scan every platform, a workflow that lowers the
 *      severity threshold, a workflow that scans a public registry, and a
 *      workflow that pushes the image of the gate to a public registry. A
 *      check that never fails is not a check.
 *   3. The publication copies the scanned image to the release registry with
 *      the digest it has after the scan, and it verifies that the published
 *      digest is the scanned digest.
 *   4. A failed publication creates no release tag, and a published digest
 *      that differs from the scanned digest fails the publication.
 *   5. The publication refuses an input that is not a digest or a version.
 *
 * Usage:
 *   node scripts/release-pipeline.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isLocalRegistry, isPublicRegistry, registryHost } from './registry-reference.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR = join(ROOT, 'scripts/validate-release-workflow.mjs');
const PUBLISHER = join(ROOT, 'scripts/publish-release-image.mjs');
const WORKFLOW = join(ROOT, '.github/workflows/release.yml');

let failures = 0;

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function check(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  ❌ ${name}`);
    console.error(`     ${error.message}`);
  }
}

/**
 * A directory with a mock that records its arguments. The mock of `skopeo`
 * answers the inspection of a manifest with the given bytes, the digest of
 * those bytes is the digest of the published manifest.
 */
function mockBinaries(commands, options = {}) {
  const { failing = [], manifest = 'scanned-manifest-bytes' } = options;
  const dir = mkdtempSync(join(tmpdir(), 'release-mock-'));
  const log = join(dir, 'calls.log');
  for (const command of commands) {
    const path = join(dir, command);
    const body =
      command === 'skopeo'
        ? `if [ "$1" = "inspect" ]; then printf '%s' "${manifest}"; exit 0; fi\n`
        : '';
    writeFileSync(
      path,
      `#!/usr/bin/env bash\nprintf '%s %s\\n' "${command}" "$*" >> "${log}"\n` +
        body +
        (failing.includes(command)
          ? `echo "mock failure of ${command}" >&2\nexit 1\n`
          : 'exit 0\n'),
    );
    chmodSync(path, 0o755);
  }
  return { dir, log };
}

function readCalls(mock) {
  try {
    return readFileSync(mock.log, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

console.log('🧪 Starting the Release Pipeline Tests...');

// 1. The workflow of the repository passes the validation.
check('the release workflow of the repository passes the validation', () => {
  const result = run(process.execPath, [VALIDATOR]);
  assert.equal(result.status, 0, `the validation failed: ${result.stdout}${result.stderr}`);
});

// 2. The validation catches a broken workflow.
const original = readFileSync(WORKFLOW, 'utf8');

/** Extracts the block of a step, from its name line to the next step. */
function stepBlock(workflow, name) {
  const start = workflow.indexOf(`      - name: ${name}`);
  if (start < 0) throw new Error(`the workflow does not have the step ${name}`);
  const next = workflow.indexOf('\n      - name: ', start + 1);
  return {
    start,
    end: next < 0 ? workflow.length : next + 1,
    text: workflow.slice(start, next < 0 ? workflow.length : next + 1),
  };
}

/** Moves a step in front of another step. */
function moveStepBefore(workflow, name, before) {
  const source = stepBlock(workflow, name);
  const target = stepBlock(workflow, before);
  const withoutSource = workflow.slice(0, source.start) + workflow.slice(source.end);
  const targetIndex = withoutSource.indexOf(target.text);
  return withoutSource.slice(0, targetIndex) + source.text + withoutSource.slice(targetIndex);
}

function validateVariant(name, mutate, expectedFragment) {
  check(name, () => {
    const broken = mutate(original);
    // The fixture lives in a directory of its own, the temporary directory of
    // the system is world writable and a file in it can be replaced by a
    // symlink of another user.
    const dir = mkdtempSync(join(tmpdir(), 'release-fixture-'));
    const path = join(dir, 'release.yml');
    writeFileSync(path, broken);
    try {
      const result = run(process.execPath, [VALIDATOR], {
        env: { ...process.env, RELEASE_WORKFLOW: path },
      });
      assert.notEqual(result.status, 0, 'the validation accepted the broken workflow');
      assert.match(
        `${result.stdout}${result.stderr}`,
        expectedFragment,
        'the validation did not report the expected failure',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

validateVariant(
  'the validation rejects a publication that runs before the scan',
  (workflow) => moveStepBefore(workflow, 'Publish the release tags', 'Scan linux/amd64'),
  /publication must run after every scan step/,
);

validateVariant(
  'the validation rejects a platform that is published but not scanned',
  (workflow) =>
    workflow
      .replace('      - name: Scan linux/arm64', '      - name: Scan linux/s390x')
      .replace('          TRIVY_PLATFORM: linux/arm64', '          TRIVY_PLATFORM: linux/s390x'),
  /is published but it is not scanned/,
);

validateVariant(
  'the validation rejects a lowered severity threshold',
  (workflow) => workflow.replace('severity: HIGH,CRITICAL', 'severity: CRITICAL'),
  /must keep the severity threshold/,
);

validateVariant(
  'the validation rejects a scan that does not fail the job',
  (workflow) => workflow.replace("exit-code: '1'", "exit-code: '0'"),
  /must fail the job on a finding/,
);

validateVariant(
  'the validation rejects a scan that ignores findings',
  (workflow) =>
    workflow.replace(
      '          vuln-type: os,library',
      '          vuln-type: os,library\n          trivyignores: .trivyignore',
    ),
  /must not use an ignore list/,
);

validateVariant(
  'the validation rejects a publication without the scanned digest',
  (workflow) =>
    workflow.replace(
      'SCAN_DIGEST: ${{ steps.build.outputs.digest }}',
      'SCAN_DIGEST: ${{ github.sha }}',
    ),
  /must create the release tags from the digest of the scanned image/,
);

validateVariant(
  'the validation rejects a publication that is not bound to the request',
  (workflow) =>
    workflow.replace(
      '        if: inputs.publish\n        env:\n          SCAN_REGISTRY:',
      '        env:\n          SCAN_REGISTRY:',
    ),
  /must only run when the publication is requested/,
);

validateVariant(
  'the validation rejects a build that pushes the image of the gate to a public registry',
  (workflow) =>
    workflow.replace(
      '      SCAN_IMAGE: localhost:5000/baseapikey-',
      '      SCAN_IMAGE: ghcr.io/alfinreswara/baseapikey-',
    ),
  /the image of the gate must not live in a public registry/,
);

validateVariant(
  'the validation rejects a scan that reads the image from a public registry',
  (workflow) =>
    workflow.replace(
      "          image-ref: ${{ env.SCAN_IMAGE }}:${{ env.SCAN_TAG }}\n          format: table\n          exit-code: '1'\n          severity: HIGH,CRITICAL\n          vuln-type: os,library\n        env:\n          TRIVY_PLATFORM: linux/amd64",
      "          image-ref: ghcr.io/alfinreswara/baseapikey-gateway:${{ env.SCAN_TAG }}\n          format: table\n          exit-code: '1'\n          severity: HIGH,CRITICAL\n          vuln-type: os,library\n        env:\n          TRIVY_PLATFORM: linux/amd64",
    ),
  /must not read the image from a public registry/,
);

validateVariant(
  'the validation rejects a workflow without the cleanup of the temporary artifact',
  (workflow) =>
    workflow.replace(
      '      - name: Remove the scan registry',
      '      - name: Keep the scan registry',
    ),
  /does not remove the scan registry/,
);

// 3. The publication copies the scanned image with its digest.
const manifestBytes = 'the-scanned-manifest-bytes';
const scanDigest = `sha256:${createHash('sha256').update(manifestBytes, 'utf8').digest('hex')}`;
const sha = 'b'.repeat(40);

function publishEnv(extra = {}) {
  return {
    ...process.env,
    RELEASE_IMAGE: 'ghcr.io/owner/baseapikey-gateway',
    SCAN_REGISTRY: 'localhost:5000',
    SCAN_IMAGE: 'localhost:5000/baseapikey-gateway',
    SCAN_TAG: 'scan-abc',
    SCAN_DIGEST: scanDigest,
    RELEASE_VERSION: 'v1.2.3',
    COMMIT_SHA: sha,
    ...extra,
  };
}

check('the publication copies the scanned image with the digest of the scan', () => {
  const mock = mockBinaries(['skopeo'], { manifest: manifestBytes });
  try {
    const result = run(process.execPath, [PUBLISHER], {
      env: { ...publishEnv(), PATH: `${mock.dir}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, `the publication failed: ${result.stderr}`);
    const calls = readCalls(mock);
    const copies = calls.filter((call) => call.startsWith('skopeo copy'));
    assert.equal(copies.length, 2, `expected two copies, got: ${copies.join(' | ')}`);
    for (const copy of copies) {
      assert.match(copy, /--all/, 'the copy must include every platform');
      assert.match(copy, /--preserve-digests/, 'the copy must not convert the manifest');
      assert.match(
        copy,
        new RegExp(`docker://localhost:5000/baseapikey-gateway@${scanDigest}`),
        'the copy must read the scanned digest',
      );
    }
    assert.match(copies[0], /docker:\/\/ghcr\.io\/owner\/baseapikey-gateway:v1\.2\.3/);
    assert.match(copies[1], new RegExp(`docker://ghcr\\.io/owner/baseapikey-gateway:sha-${sha}`));
  } finally {
    rmSync(mock.dir, { recursive: true, force: true });
  }
});

check('the publication verifies that the published digest is the scanned digest', () => {
  const mock = mockBinaries(['skopeo'], { manifest: 'a-different-manifest' });
  try {
    const result = run(process.execPath, [PUBLISHER], {
      env: { ...publishEnv(), PATH: `${mock.dir}:${process.env.PATH}` },
    });
    assert.notEqual(result.status, 0, 'the publication must fail when the digest differs');
    assert.match(
      `${result.stdout}${result.stderr}`,
      /the published digest .* is sha256:[0-9a-f]+ but the scanned digest is/,
      'the failure must name both digests',
    );
  } finally {
    rmSync(mock.dir, { recursive: true, force: true });
  }
});

// 4. A failed publication creates no release tag.
check('a failed publication creates no release tag and reports the failure', () => {
  const mock = mockBinaries(['skopeo'], { failing: ['skopeo'] });
  try {
    const result = run(process.execPath, [PUBLISHER], {
      env: { ...publishEnv(), PATH: `${mock.dir}:${process.env.PATH}` },
    });
    assert.notEqual(result.status, 0, 'the publication must fail when the copy fails');
    assert.match(
      `${result.stdout}${result.stderr}`,
      /was not published/,
      'the failure must be reported',
    );
  } finally {
    rmSync(mock.dir, { recursive: true, force: true });
  }
});

// 5. The publication refuses a malformed input.
check('the publication refuses a malformed digest, version and commit', () => {
  const mock = mockBinaries(['skopeo'], { manifest: manifestBytes });
  try {
    for (const [name, env] of [
      ['digest', { SCAN_DIGEST: 'not-a-digest' }],
      ['version', { RELEASE_VERSION: '1.2.3' }],
      ['commit', { COMMIT_SHA: 'HEAD' }],
    ]) {
      const result = run(process.execPath, [PUBLISHER], {
        env: { ...publishEnv(env), PATH: `${mock.dir}:${process.env.PATH}` },
      });
      assert.notEqual(result.status, 0, `the publication accepted a malformed ${name}`);
    }
    assert.equal(readCalls(mock).length, 0, 'a malformed input must not reach the registry');
  } finally {
    rmSync(mock.dir, { recursive: true, force: true });
  }
});

// 6. The host of an image reference is parsed, never compared with a
//    substring. A host that contains the name of a registry is not the
//    registry.
check('the host of an image reference is parsed and not matched as a substring', () => {
  assert.equal(registryHost('ghcr.io/owner/baseapikey-gateway:scan-abc'), 'ghcr.io');
  assert.equal(registryHost('ghcr.io/owner/baseapikey-gateway'), 'ghcr.io');
  assert.equal(registryHost('localhost:5000/baseapikey-gateway:scan-abc'), 'localhost');
  assert.equal(registryHost('127.0.0.1:5000/baseapikey-gateway'), '127.0.0.1');
  assert.equal(
    registryHost('notghcr.io.evil.example/owner/baseapikey-gateway:scan-abc'),
    'notghcr.io.evil.example',
  );
  assert.equal(
    registryHost('ghcr.io.evil.example/owner/baseapikey-gateway'),
    'ghcr.io.evil.example',
  );
  assert.equal(isPublicRegistry('ghcr.io/owner/baseapikey-gateway:scan-abc'), true);
  assert.equal(isPublicRegistry('notghcr.io.evil.example/owner/img'), false);
  assert.equal(isPublicRegistry('ghcr.io.evil.example/owner/img'), false);
  assert.equal(isPublicRegistry('localhost:5000/baseapikey-gateway'), false);
  assert.equal(isLocalRegistry('localhost:5000/baseapikey-gateway'), true);
  assert.equal(isLocalRegistry('ghcr.io/owner/baseapikey-gateway'), false);
});

if (failures > 0) {
  console.error(`\n❌ ${failures} release pipeline test(s) failed.`);
  process.exit(1);
}
console.log('🎉 All Release Pipeline Tests passed successfully!\n');
