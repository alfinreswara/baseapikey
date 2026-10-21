#!/usr/bin/env node
/**
 * Publishes the release tags of an image that passed the security gate.
 *
 * The image was built and pushed to the scan registry under the scan tag. The
 * security gate scanned every platform of that image. The release tags are
 * created from the digest of the scanned image:
 *
 *   docker buildx imagetools create --tag <image>:<version> <image>@<digest>
 *
 * When a single source is given, `imagetools create` performs a carbon copy:
 * the new tag points to exactly the manifests that were scanned, with the same
 * digests, the same labels, and the same provenance and SBOM attestations.
 * The release tag is never the result of a second build.
 *
 * The scan tag is removed afterwards. It is never a release tag, the deployment
 * never refers to it, and the release tags keep the manifests alive.
 *
 * The environment:
 *   RELEASE_IMAGE    the image of the release, for example ghcr.io/owner/baseapikey-gateway
 *   SCAN_IMAGE       the image in the scan registry, the same repository for a release
 *   SCAN_TAG         the temporary tag of the scanned image
 *   SCAN_DIGEST      the digest of the scanned image, sha256:<hex>
 *   RELEASE_VERSION  the semantic version of the release, for example v1.2.3
 *   COMMIT_SHA       the commit the image was built from
 */
import { execFileSync } from 'node:child_process';

const REQUIRED = [
  'RELEASE_IMAGE',
  'SCAN_IMAGE',
  'SCAN_TAG',
  'SCAN_DIGEST',
  'RELEASE_VERSION',
  'COMMIT_SHA',
];

function fail(message) {
  console.error(`[publish-release-image] ${message}`);
  process.exit(1);
}

function run(command, args) {
  console.log(`[publish-release-image] ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit' });
}

const env = process.env;
for (const name of REQUIRED) {
  if (!env[name]) {
    fail(`the environment variable ${name} is required`);
  }
}

const releaseImage = env.RELEASE_IMAGE;
const scanImage = env.SCAN_IMAGE;
const scanTag = env.SCAN_TAG;
const scanDigest = env.SCAN_DIGEST;
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

// The release tags are created from the digest of the scanned image. The
// carbon copy keeps the manifests, the labels, and the attestations.
const source = `${scanImage}@${scanDigest}`;
for (const tag of [version, `sha-${commitSha}`]) {
  try {
    run('docker', ['buildx', 'imagetools', 'create', '--tag', `${releaseImage}:${tag}`, source]);
  } catch (error) {
    fail(
      `the release tag ${releaseImage}:${tag} was not created: ${error.message}. ` +
        'The scan tag stays, remove it with: ' +
        `skopeo delete docker://${scanImage}:${scanTag}`,
    );
  }
}

// The scan tag is a temporary artifact of the gate. It is removed after the
// release tags exist, the release tags keep the manifests alive.
try {
  run('skopeo', ['delete', `docker://${scanImage}:${scanTag}`]);
} catch (error) {
  // The release tags exist, a leftover scan tag is not a failure of the
  // release. It is reported and removed by the operator.
  console.warn(
    `[publish-release-image] the scan tag ${scanImage}:${scanTag} could not be removed: ${error.message}`,
  );
  console.warn(
    `[publish-release-image] remove it with: skopeo delete docker://${scanImage}:${scanTag}`,
  );
}

console.log(
  `[publish-release-image] the release tags ${releaseImage}:${version} and ` +
    `${releaseImage}:sha-${commitSha} point to the scanned image ${scanDigest}`,
);
