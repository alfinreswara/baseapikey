#!/usr/bin/env node
/**
 * BaseAPIKey release workflow validation.
 *
 * The script checks the release pipeline without a cluster, a registry, or an
 * extra YAML dependency. It protects the order of the security gate: the
 * release tag of an image may only exist after the image was scanned on every
 * platform that the publication uses.
 *
 * It verifies:
 *
 *   1. The build pushes to the scan tag, never to a release tag.
 *   2. Every platform of the release is scanned, and the scan is the gate:
 *      a finding of HIGH or CRITICAL fails the step and stops the job.
 *   3. The publication runs after the scan and creates the release tags from
 *      the digest of the scanned image.
 *   4. A dry run does not write to GitHub Container Registry and does not need
 *      a registry credential.
 *   5. The SBOM of every published platform is generated and uploaded, and the
 *      provenance of the release is generated.
 *   6. No security check is weakened: the severity threshold is unchanged, no
 *      ignore list is used, and the scan covers the packages of the operating
 *      system and the libraries.
 *
 * Usage:
 *   node scripts/validate-release-workflow.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isPublicRegistry } from './registry-reference.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The tests point the validation at a fixture, the repository workflow is the
// default.
const WORKFLOW = process.env['RELEASE_WORKFLOW'] ?? join(ROOT, '.github/workflows/release.yml');
const PUBLISH_SCRIPT = join(ROOT, 'scripts/publish-release-image.mjs');

const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

/**
 * Reads the steps of the workflow with a small scanner. The workflow is a
 * file of the repository, the scanner reads the names, the conditions, and
 * the inputs of the steps, it does not need a full YAML implementation.
 */
function readSteps(text) {
  const lines = text.split('\n');
  const steps = [];
  let current = null;
  for (const [index, line] of lines.entries()) {
    const nameMatch = /^ {6}- name: (.+)$/.exec(line);
    if (nameMatch) {
      current = { name: nameMatch[1].trim(), line: index, body: [] };
      steps.push(current);
      continue;
    }
    if (current) {
      // A key of the job ends the list of the steps.
      if (/^ {4}\S/.test(line)) {
        current = null;
        continue;
      }
      current.body.push(line);
    }
  }
  return steps;
}

function stepText(step) {
  return step.body.join('\n');
}

function stepInput(step, key) {
  const pattern = new RegExp(`^ {10}${key}: (.*)$`, 'm');
  const match = pattern.exec(stepText(step));
  return match ? match[1].trim().replace(/^'(.*)'$/, '$1') : undefined;
}

function stepEnv(step, key) {
  const pattern = new RegExp(`^ {10}${key}: (.*)$`, 'm');
  const match = pattern.exec(stepText(step));
  return match ? match[1].trim() : undefined;
}

/** The condition of a step, it is a key of the step itself. */
function stepIf(step) {
  const pattern = /^ {8}if: (.+)$/m;
  const match = pattern.exec(stepText(step));
  return match ? match[1].trim() : undefined;
}

/** The environment of the job, its keys are indented deeper than the ones of the workflow. */
function jobEnv(text, key) {
  const pattern = new RegExp(`^ {6}${key}: (.*)$`, 'm');
  const match = pattern.exec(text);
  return match ? match[1].trim().replace(/^'(.*)'$/, '$1') : undefined;
}

function workflowEnv(text, key) {
  const pattern = new RegExp(`^ {2}${key}: (.*)$`, 'm');
  const match = pattern.exec(text);
  return match ? match[1].trim().replace(/^'(.*)'$/, '$1') : undefined;
}

if (!existsSync(WORKFLOW)) {
  console.error(`❌ the workflow ${WORKFLOW} does not exist`);
  process.exit(1);
}

const text = readFileSync(WORKFLOW, 'utf8');
const steps = readSteps(text);
const platforms = (workflowEnv(text, 'RELEASE_PLATFORMS') ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter((value) => value.length > 0);
const scanTag = workflowEnv(text, 'SCAN_TAG') ?? '';
const scanImage = jobEnv(text, 'SCAN_IMAGE') ?? '';
const scanRegistry = jobEnv(text, 'SCAN_REGISTRY') ?? '';

// The image of the gate is never in a public registry. It is built and
// scanned in the registry of the runner, in the dry run and in the release.
check(
  scanImage.length > 0 && !isPublicRegistry(scanImage),
  'the image of the gate must not live in a public registry',
);
check(
  scanRegistry.length > 0 && !isPublicRegistry(scanRegistry),
  'the scan registry of the gate must not be a public registry',
);

// 1. The build pushes to the scan tag, never to a release tag.
const build = steps.find((step) => step.name.includes('Build the image'));
check(build !== undefined, 'the workflow has no build step');
if (build) {
  const tags = stepInput(build, 'tags') ?? '';
  check(
    tags.includes('SCAN_TAG'),
    'the build step must push to the scan tag, not to a release tag',
  );
  check(
    !tags.includes('inputs.version'),
    'the build step must not create the release tag of the version',
  );
  const platformsInput = stepInput(build, 'platforms') ?? '';
  check(
    platformsInput.includes('RELEASE_PLATFORMS'),
    'the build step must build the platforms of the release',
  );
  check(
    stepInput(build, 'push') === 'true',
    'the build step must push the image to the scan registry',
  );
  check(
    !isPublicRegistry(tags),
    'the build step must not push the image to a public registry, the image of the gate is ' +
      'never public before the scan',
  );
  check(
    tags.includes('env.SCAN_IMAGE'),
    'the build step must push to the image of the scan registry',
  );
  check(
    (stepInput(build, 'provenance') ?? '').includes('mode=max'),
    'the release must generate the provenance attestation',
  );
}

// 2. Every platform is scanned, and the scan is the gate.
const scans = steps.filter((step) => step.name.startsWith('Scan '));
const scannedPlatforms = scans.map((step) => stepEnv(step, 'TRIVY_PLATFORM'));
for (const platform of platforms) {
  check(
    scannedPlatforms.includes(platform),
    `the platform ${platform} is published but it is not scanned`,
  );
}
for (const scan of scans) {
  const imageRef = stepInput(scan, 'image-ref') ?? '';
  check(
    imageRef.includes('SCAN_IMAGE') && imageRef.includes('SCAN_TAG'),
    `the scan step "${scan.name}" must read the image of the scan registry`,
  );
  check(
    !isPublicRegistry(imageRef),
    `the scan step "${scan.name}" must not read the image from a public registry`,
  );
  check(
    stepInput(scan, 'exit-code') === '1',
    `the scan step "${scan.name}" must fail the job on a finding`,
  );
  check(
    stepInput(scan, 'severity') === 'HIGH,CRITICAL',
    `the scan step "${scan.name}" must keep the severity threshold HIGH,CRITICAL`,
  );
  check(
    stepInput(scan, 'vuln-type') === 'os,library',
    `the scan step "${scan.name}" must scan the packages of the system and the libraries`,
  );
  check(
    stepInput(scan, 'trivyignores') === undefined,
    `the scan step "${scan.name}" must not use an ignore list`,
  );
}

// 3. The publication runs after the scan and uses the scanned digest.
const publish = steps.find((step) => step.name.includes('Publish the release tags'));
check(publish !== undefined, 'the workflow has no publication step');
if (publish && build) {
  check(
    publish.line > scans[scans.length - 1].line,
    'the publication must run after every scan step',
  );
  check(
    stepEnv(publish, 'SCAN_DIGEST')?.includes('steps.build.outputs.digest'),
    'the publication must create the release tags from the digest of the scanned image',
  );
  check(
    stepEnv(publish, 'SCAN_IMAGE')?.includes('SCAN_IMAGE'),
    'the publication must copy the image of the scan registry',
  );
  check(
    stepEnv(publish, 'RELEASE_VERSION')?.includes('inputs.version'),
    'the publication must create the tag of the release version',
  );
  check(
    stepEnv(publish, 'COMMIT_SHA')?.includes('github.sha'),
    'the publication must create the tag of the commit',
  );
  check(
    (stepIf(publish) ?? '').includes('inputs.publish'),
    'the publication must only run when the publication is requested',
  );
}

// 4. A dry run writes nothing to GitHub Container Registry.
const login = steps.find((step) => step.name.includes('Log in to GitHub Container Registry'));
check(login !== undefined, 'the workflow has no registry login step');
if (login) {
  check(
    (stepIf(login) ?? '').includes('inputs.publish'),
    'the registry login must only run when the publication is requested',
  );
  if (scans.length > 0) {
    check(
      login.line > scans[scans.length - 1].line,
      'the registry login must run after the scan, the credential is used for the copy only',
    );
  }
}

// The scan registry of the runner holds the image while it is scanned. It is
// used by the dry run and by the release, the image of the gate is never in a
// public registry.
const localRegistry = steps.find((step) => step.name.includes('scan registry'));
check(
  localRegistry !== undefined,
  'the workflow must scan against a registry of the runner, it never writes to GHCR',
);
if (localRegistry && !localRegistry.name.includes('Remove')) {
  check(
    (stepIf(localRegistry) ?? '') === '',
    'the scan registry of the runner must run for the dry run and for the release',
  );
}

// The temporary artifact of the gate is removed.
const cleanup = steps.find((step) => step.name.includes('Remove the scan registry'));
check(cleanup !== undefined, 'the workflow does not remove the scan registry');
if (cleanup) {
  check(
    (stepIf(cleanup) ?? '').includes('always()'),
    'the scan registry must be removed even when the job fails',
  );
}

// 5. The SBOM of every platform is generated and uploaded, the provenance is
//    generated on the release.
const sboms = steps.filter((step) => step.name.includes('Generate the SBOM'));
for (const platform of platforms) {
  const sbom = sboms.find((step) => stepEnv(step, 'TRIVY_PLATFORM') === platform);
  check(sbom !== undefined, `the SBOM of the platform ${platform} is not generated`);
  if (sbom) {
    check(
      (stepInput(sbom, 'format') ?? '') === 'cyclonedx',
      `the SBOM of ${platform} must be a CycloneDX report`,
    );
    check(
      (stepInput(sbom, 'output') ?? '').includes(platform.replace('/', '-')),
      `the SBOM of ${platform} must be stored in a file of its own`,
    );
  }
}
const upload = steps.find((step) => step.name.includes('Upload release SBOM'));
check(upload !== undefined, 'the workflow does not upload the SBOM');
if (upload) {
  check(
    (stepInput(upload, 'if-no-files-found') ?? '') === 'error',
    'the upload of the SBOM must fail when the report is missing',
  );
}

// 6. No security check is weakened.
check(
  !existsSync(join(ROOT, '.trivyignore')),
  'the repository must not contain a .trivyignore file',
);
check(
  !text.includes('severity: CRITICAL\n'),
  'the severity threshold of the scan must not be lowered',
);
check(
  existsSync(PUBLISH_SCRIPT),
  'the publication script scripts/publish-release-image.mjs does not exist',
);
if (existsSync(PUBLISH_SCRIPT)) {
  const script = readFileSync(PUBLISH_SCRIPT, 'utf8');
  check(
    script.includes('--preserve-digests'),
    'the publication must copy the manifest without a conversion, the digest must not change',
  );
  check(script.includes('--all'), 'the publication must copy every platform of the image');
  check(
    script.includes('published !== scanDigest'),
    'the publication must verify that the published digest is the scanned digest',
  );
}

if (failures.length > 0) {
  console.error('❌ The release workflow validation failed:');
  for (const failure of failures) {
    console.error(`   - ${failure}`);
  }
  process.exit(1);
}

console.log('✅ The release workflow validation passed.');
console.log(`   platforms: ${platforms.join(', ')}`);
console.log(`   scan tag: ${scanTag}`);
