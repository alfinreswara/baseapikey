#!/usr/bin/env node
/**
 * Publishes the release tags of an image that passed the security gate.
 *
 * The image was built and pushed to the scan registry of the runner and every
 * platform of it was scanned there. The image never was in a public registry
 * while it was scanned.
 *
 * The release tags are created by copying the scanned image to GitHub
 * Container Registry with the digest it has after the scan:
 *
 *   skopeo copy --all --preserve-digests \
 *     docker://localhost:5000/<image>:<scan tag> docker://ghcr.io/<image>:<release tag>
 *
 * `--preserve-digests` forbids the conversion of the manifest, so the copied
 * manifest is byte for byte the manifest that was scanned, with the same
 * digests, the same labels, and the same inlined provenance and SBOM
 * attestations. The copy is verified afterwards: the digest of the published
 * manifest must be the digest that was scanned, otherwise the release fails.
 *
 * The temporary artifact of the gate is the scan registry of the runner. It
 * disappears with the runner, and the workflow removes the container
 * explicitly.
 *
 * The environment:
 *   SCAN_REGISTRY    the registry of the runner, for example localhost:5000
 *   SCAN_IMAGE       the image in the scan registry
 *   SCAN_TAG         the temporary tag of the scanned image
 *   SCAN_DIGEST      the digest of the scanned image, sha256:<hex>
 *   RELEASE_IMAGE    the image of the release, for example ghcr.io/owner/baseapikey-gateway
 *   RELEASE_VERSION  the semantic version of the release, for example v1.2.3
 *   COMMIT_SHA       the commit the image was built from
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const REQUIRED = [
  'SCAN_REGISTRY',
  'SCAN_IMAGE',
  'SCAN_TAG',
  'SCAN_DIGEST',
  'RELEASE_IMAGE',
  'RELEASE_VERSION',
  'COMMIT_SHA',
];

function fail(message) {
  console.error(`[publish-release-image] ${message}`);
  process.exit(1);
}

function run(command, args) {
  console.log(`[publish-release-image] ${command} ${args.join(' ')}`);
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

const env = process.env;
for (const name of REQUIRED) {
  if (!env[name]) {
    fail(`the environment variable ${name} is required`);
  }
}

const scanRegistry = env.SCAN_REGISTRY;
const scanImage = env.SCAN_IMAGE;
const scanTag = env.SCAN_TAG;
const scanDigest = env.SCAN_DIGEST;
const releaseImage = env.RELEASE_IMAGE;
const version = env.RELEASE_VERSION;
const commitSha = env.COMMIT_SHA;

if (!/^sha256:[0-9a-f]{64}$/.test(scanDigest)) {
  fail(`the scan digest "${scanDigest}" is not a sha256 digest`);
}
if (!/^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`the release version "${version}" is not a semantic version`);
}
if (!/^[0-9a-f]{40}$/.test(commitSha)) {
  fail(`the commit "${commitSha}" is not a commit sha`);
}

// The source of the copy is the scan registry of the runner, over plain HTTP.
// The destination is the registry of the release, the credentials of the
// login of the workflow are used.
const source = `docker://${scanImage}@${scanDigest}`;
const insecure = scanRegistry.startsWith('localhost') || scanRegistry.startsWith('127.0.0.1');

for (const tag of [version, `sha-${commitSha}`]) {
  const destination = `docker://${releaseImage}:${tag}`;
  try {
    run('skopeo', [
      'copy',
      '--all',
      '--preserve-digests',
      ...(insecure ? ['--src-tls-verify=false'] : []),
      source,
      destination,
    ]);
  } catch (error) {
    fail(
      `the release tag ${releaseImage}:${tag} was not published: ${error.message}. ` +
        'The image stays in the scan registry of the runner, it is removed with the runner.',
    );
  }

  // The published manifest must be the manifest that was scanned. The digest
  // of a manifest is the digest of its bytes, the registry serves the bytes it
  // stored.
  let published;
  try {
    const raw = run('skopeo', ['inspect', '--raw', destination]);
    published = `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`;
  } catch (error) {
    fail(`the published manifest of ${releaseImage}:${tag} could not be read: ${error.message}`);
  }
  if (published !== scanDigest) {
    fail(
      `the published digest of ${releaseImage}:${tag} is ${published} but the scanned ` +
        `digest is ${scanDigest}. The release is not consistent with the scan.`,
    );
  }
  console.log(
    `[publish-release-image] ${releaseImage}:${tag} points to the scanned digest ${published}`,
  );
}

console.log(
  `[publish-release-image] the release tags ${releaseImage}:${version} and ` +
    `${releaseImage}:sha-${commitSha} point to the scanned image ${scanDigest}`,
);
