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
 *      workflow that does not scan every platform, and a workflow that lowers
 *      the severity threshold. A check that never fails is not a check.
 *   3. The publication creates the release tags from the digest of the
 *      scanned image and removes the scan tag.
 *   4. A failed publication does not create a release tag and keeps the scan
 *      tag, so the failure is visible and the operator can clean it up.
 *
 * Usage:
 *   node scripts/release-pipeline.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** A directory with a mock that records its arguments. */
function mockBinaries(commands, failing = []) {
  const dir = mkdtempSync(join(tmpdir(), 'release-mock-'));
  const log = join(dir, 'calls.log');
  for (const command of commands) {
    const path = join(dir, command);
    writeFileSync(
      path,
      `#!/usr/bin/env bash\nprintf '%s %s\\n' "${command}" "$*" >> "${log}"\n` +
        (failing.includes(command)
          ? `echo "mock failure of ${command}" >&2\nexit 1\n`
          : 'exit 0\n'),
    );
    chmodSync(path, 0o755);
  }
  return { dir, log, path: join(dir, 'calls.log') };
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

function validateVariant(name, mutate, expectedFragment) {
  check(name, () => {
    const broken = mutate(original);
    const path = join(tmpdir(), `release-workflow-${Math.abs(hash(broken))}.yml`);
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
      rmSync(path, { force: true });
    }
  });
}

function hash(value) {
  let result = 0;
  for (const character of value) {
    result = (result * 31 + character.charCodeAt(0)) | 0;
  }
  return result;
}

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
      '        if: inputs.publish\n        env:\n          RELEASE_IMAGE:',
      '        env:\n          RELEASE_IMAGE:',
    ),
  /must only run when the publication is requested/,
);

// 3. The publication creates the release tags from the scanned digest.
const digest = `sha256:${'a'.repeat(64)}`;
const sha = 'b'.repeat(40);

check('the publication creates the release tags from the scanned digest', () => {
  const mock = mockBinaries(['docker', 'skopeo']);
  try {
    const result = run(process.execPath, [PUBLISHER], {
      env: {
        ...process.env,
        PATH: `${mock.dir}:${process.env.PATH}`,
        RELEASE_IMAGE: 'ghcr.io/owner/baseapikey-gateway',
        SCAN_IMAGE: 'ghcr.io/owner/baseapikey-gateway',
        SCAN_TAG: 'scan-abc',
        SCAN_DIGEST: digest,
        RELEASE_VERSION: 'v1.2.3',
        COMMIT_SHA: sha,
      },
    });
    assert.equal(result.status, 0, `the publication failed: ${result.stderr}`);
    const calls = readCalls(mock);
    assert.equal(calls.length, 3, `expected three calls, got: ${calls.join(' | ')}`);
    assert.match(
      calls[0],
      /docker buildx imagetools create --tag ghcr\.io\/owner\/baseapikey-gateway:v1\.2\.3 ghcr\.io\/owner\/baseapikey-gateway@sha256:/,
      'the version tag must be a carbon copy of the scanned image',
    );
    assert.match(
      calls[1],
      /--tag ghcr\.io\/owner\/baseapikey-gateway:sha-b{40} ghcr\.io\/owner\/baseapikey-gateway@sha256:/,
      'the commit tag must be a carbon copy of the scanned image',
    );
    assert.match(
      calls[2],
      /skopeo delete docker:\/\/ghcr\.io\/owner\/baseapikey-gateway:scan-abc/,
      'the scan tag must be removed after the release tags exist',
    );
  } finally {
    rmSync(mock.dir, { recursive: true, force: true });
  }
});

// 4. A failed publication creates no release tag and keeps the scan tag.
check('a failed publication creates no release tag and keeps the scan tag', () => {
  const mock = mockBinaries(['docker', 'skopeo'], ['docker']);
  try {
    const result = run(process.execPath, [PUBLISHER], {
      env: {
        ...process.env,
        PATH: `${mock.dir}:${process.env.PATH}`,
        RELEASE_IMAGE: 'ghcr.io/owner/baseapikey-gateway',
        SCAN_IMAGE: 'ghcr.io/owner/baseapikey-gateway',
        SCAN_TAG: 'scan-abc',
        SCAN_DIGEST: digest,
        RELEASE_VERSION: 'v1.2.3',
        COMMIT_SHA: sha,
      },
    });
    assert.notEqual(result.status, 0, 'the publication must fail when the copy fails');
    const calls = readCalls(mock);
    assert.equal(
      calls.filter((call) => call.includes('skopeo delete')).length,
      0,
      'the scan tag must survive a failed publication, the operator removes it',
    );
    assert.match(
      `${result.stdout}${result.stderr}`,
      /skopeo delete docker:\/\/ghcr\.io\/owner\/baseapikey-gateway:scan-abc/,
      'the failure must name the command that removes the scan tag',
    );
  } finally {
    rmSync(mock.dir, { recursive: true, force: true });
  }
});

// 5. The publication refuses an input that is not a digest or a version.
check('the publication refuses a malformed digest and a malformed version', () => {
  const mock = mockBinaries(['docker', 'skopeo']);
  try {
    for (const [name, env] of [
      ['digest', { SCAN_DIGEST: 'not-a-digest' }],
      ['version', { SCAN_DIGEST: digest, RELEASE_VERSION: '1.2.3' }],
      ['commit', { SCAN_DIGEST: digest, COMMIT_SHA: 'HEAD' }],
    ]) {
      const result = run(process.execPath, [PUBLISHER], {
        env: {
          ...process.env,
          PATH: `${mock.dir}:${process.env.PATH}`,
          RELEASE_IMAGE: 'ghcr.io/owner/baseapikey-gateway',
          SCAN_IMAGE: 'ghcr.io/owner/baseapikey-gateway',
          SCAN_TAG: 'scan-abc',
          RELEASE_VERSION: 'v1.2.3',
          COMMIT_SHA: sha,
          ...env,
        },
      });
      assert.notEqual(result.status, 0, `the publication accepted a malformed ${name}`);
    }
    assert.equal(readCalls(mock).length, 0, 'a malformed input must not reach the registry');
  } finally {
    rmSync(mock.dir, { recursive: true, force: true });
  }
});

if (failures > 0) {
  console.error(`\n❌ ${failures} release pipeline test(s) failed.`);
  process.exit(1);
}

console.log('🎉 All Release Pipeline Tests passed successfully!\n');
