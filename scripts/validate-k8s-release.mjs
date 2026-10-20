#!/usr/bin/env node
/**
 * BaseAPIKey Kubernetes release validation.
 *
 * The script checks the deployment manifests without requiring a cluster, a
 * kubectl binary, or an extra YAML dependency. It is intentionally strict
 * about the failure modes that broke the previous release configuration:
 *
 *   1. Image references that point at an example registry, at a mutable tag,
 *      or at a release identifier the components do not share.
 *   2. Lifecycle hooks or commands that rely on an executable the distroless
 *      runtime image does not contain (there is no shell and the Node binary
 *      is not on PATH).
 *   3. A termination grace period that is shorter than the shutdown budget
 *      of the application, which makes Kubernetes send SIGKILL while
 *      requests are still running.
 *
 * Usage:
 *   node scripts/validate-k8s-release.mjs
 *   node scripts/validate-k8s-release.mjs --rendered <rendered-manifest.yaml>
 *
 * The `--rendered` mode validates the output of `kubectl kustomize`, which is
 * the authoritative renderer. The default mode validates the checked-in base
 * manifests and applies the `images:` and `labels:` transformers of the
 * production overlay the same way kustomize does.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const k8sRoot = join(repositoryRoot, 'infrastructure', 'k8s');
const baseRoot = join(k8sRoot, 'base');
const overlayRoot = join(k8sRoot, 'overlays', 'production');

const EXPECTED_REGISTRY = 'ghcr.io';
const EXPECTED_IMAGES = new Set(['baseapikey-gateway', 'baseapikey-dashboard']);
const PLACEHOLDER_TAG = 'RELEASE_TAG_PLACEHOLDER';
const FORBIDDEN_TAG = 'latest';
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const VERSION_LABEL = 'app.kubernetes.io/version';
/** Executables the distroless runtime image really provides. */
const DISTROLESS_EXECUTABLES = new Set(['/nodejs/bin/node']);
const DISTROLESS_REPOSITORY = 'gcr.io/distroless/nodejs';

const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function note(message) {
  notes.push(message);
}

function listYamlFiles(directory) {
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.yaml') || entry.endsWith('.yml'))
    .map((entry) => join(directory, entry));
}

function splitDocuments(content) {
  return content
    .split(/^---\s*$/m)
    .map((document) => document.trim())
    .filter((document) => document.length > 0);
}

function documentKind(document) {
  const match = document.match(/^kind:\s*(\S+)/m);
  return match ? match[1] : undefined;
}

function metadataName(document) {
  const lines = document.split('\n');
  let insideMetadata = false;
  for (const line of lines) {
    if (/^metadata:\s*$/.test(line)) {
      insideMetadata = true;
      continue;
    }
    if (!insideMetadata) continue;
    const match = line.match(/^\s{2}name:\s*(\S+)/);
    if (match) return match[1];
    if (/^\S/.test(line)) break;
  }
  return undefined;
}

/** Reads a label from the metadata block of a manifest. */
function metadataLabel(document, label) {
  const lines = document.split('\n');
  let insideMetadata = false;
  let insideLabels = false;
  const valuePattern = new RegExp(`^\\s{4}${label.replace(/[.\/]/g, '\\$&')}:\\s*['"]?([^'"\\s]+)`);
  for (const line of lines) {
    if (/^metadata:\s*(&\S+)?\s*$/.test(line)) {
      insideMetadata = true;
      continue;
    }
    if (!insideMetadata) continue;
    if (/^\s{2}labels:\s*(&\S+)?\s*$/.test(line)) {
      insideLabels = true;
      continue;
    }
    if (insideLabels) {
      const match = line.match(valuePattern);
      if (match) return match[1];
      if (/^\s{0,3}\S/.test(line)) insideLabels = false;
    }
    if (/^\S/.test(line)) break;
  }
  return undefined;
}

function documentImages(document) {
  const images = [];
  const lines = document.split('\n');
  lines.forEach((line, index) => {
    const match = line.match(/^\s*image:\s*['"]?([^'"\s]+)['"]?\s*$/);
    if (match) images.push({ value: match[1], line: index + 1 });
  });
  return images;
}

function documentNumberValue(document, key) {
  const match = document.match(new RegExp(`^\\s*${key}:\\s*['"]?(\\d+)['"]?\\s*$`, 'm'));
  return match ? Number(match[1]) : undefined;
}

/** Command lists of a container or of an `exec` lifecycle hook. */
function commandLists(document) {
  const lists = [];
  const lines = document.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const inline = line.match(/^\s*command:\s*\[(.*)\]\s*$/);
    if (inline) {
      const items = inline[1]
        .split(',')
        .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      if (items.length > 0) lists.push({ items, line: index + 1 });
      continue;
    }
    if (/^\s*command:\s*$/.test(line)) {
      const items = [];
      let cursor = index + 1;
      while (cursor < lines.length && /^\s*-\s+/.test(lines[cursor])) {
        items.push(lines[cursor].replace(/^\s*-\s+/, '').replace(/^['"]|['"]$/g, ''));
        cursor += 1;
      }
      if (items.length > 0) lists.push({ items, line: index + 1 });
      index = cursor - 1;
    }
  }
  return lists;
}

function parseImageReference(reference) {
  const [withoutDigest, digest] = reference.split('@');
  const slashIndex = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  const hasTag = lastColon > slashIndex;
  const name = hasTag ? withoutDigest.slice(0, lastColon) : withoutDigest;
  const tag = hasTag ? withoutDigest.slice(lastColon + 1) : undefined;
  return { name, tag, digest };
}

function repositoryPath(reference) {
  const parsed = parseImageReference(reference);
  const path = parsed.name.startsWith(`${EXPECTED_REGISTRY}/`)
    ? parsed.name.slice(`${EXPECTED_REGISTRY}/`.length)
    : parsed.name;
  return path.includes('/') ? path.slice(path.indexOf('/') + 1) : path;
}

function isBaseApiKeyImage(reference) {
  return (
    EXPECTED_IMAGES.has(repositoryPath(reference)) ||
    repositoryPath(reference).includes('baseapikey')
  );
}

/**
 * Reads the runtime stage of every Dockerfile so the manifest checks know
 * which executables the published image really contains. A distroless
 * runtime image has no shell and does not add /nodejs/bin to PATH.
 */
function readRuntimeBaseImages() {
  const dockerDirectory = join(repositoryRoot, 'infrastructure', 'docker');
  const baseImages = new Map();
  for (const file of readdirSync(dockerDirectory).filter((entry) =>
    entry.startsWith('Dockerfile'),
  )) {
    const content = readFileSync(join(dockerDirectory, file), 'utf8');
    const fromStatements = [...content.matchAll(/^FROM\s+(\S+)(.*)$/gm)];
    if (fromStatements.length === 0) continue;
    const runtimeStage = fromStatements.find((statement) =>
      /AS\s+runtime/i.test(statement[2] ?? ''),
    );
    const baseImage = (runtimeStage ?? fromStatements.at(-1))?.[1] ?? '';
    const service = file.replace(/^Dockerfile\./, '').toLowerCase();
    baseImages.set(`baseapikey-${service}`, baseImage);
    if (!/@sha256:[0-9a-f]{64}$/.test(baseImage)) {
      fail(
        `${file}: the runtime base image "${baseImage}" must be pinned by digest so the ` +
          'published image cannot change unexpectedly',
      );
    }
  }
  return baseImages;
}

function isDistrolessImage(reference, runtimeBaseImages) {
  const baseImage = runtimeBaseImages.get(repositoryPath(reference));
  if (baseImage === undefined) return false;
  return baseImage.includes(DISTROLESS_REPOSITORY);
}

/** Reads the `images:` and `labels:` sections of the production overlay. */
function readOverlayConfig() {
  const overlayFile = join(overlayRoot, 'kustomization.yaml');
  if (!existsSync(overlayFile)) {
    fail(`Missing overlay definition: ${overlayFile}`);
    return { images: [], releaseVersion: undefined };
  }
  const lines = readFileSync(overlayFile, 'utf8').split('\n');

  const blockOf = (key) => {
    const start = lines.findIndex((line) => new RegExp(`^${key}:\\s*$`).test(line));
    if (start === -1) return [];
    const block = [];
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^\S/.test(lines[index])) break;
      block.push(lines[index]);
    }
    return block;
  };

  const images = [];
  const imageBlock = blockOf('images').join('\n');
  const entryPattern = /-\s+name:\s*(\S+)([\s\S]*?)(?=\n\s*-\s+name:|$)/g;
  let match = entryPattern.exec(imageBlock);
  while (match) {
    const body = match[2] ?? '';
    images.push({
      name: match[1],
      newName: body.match(/newName:\s*(\S+)/)?.[1],
      newTag: body.match(/newTag:\s*(\S+)/)?.[1],
      digest: body.match(/digest:\s*(\S+)/)?.[1],
    });
    match = entryPattern.exec(imageBlock);
  }
  if (images.length === 0) {
    fail('The production overlay does not pin any image');
  }

  const labelBlock = blockOf('labels').join('\n');
  const releaseVersion = labelBlock
    .match(new RegExp(`${VERSION_LABEL.replace(/[.\/]/g, '\\$&')}:\\s*['"]?([^'"\n]+)['"]?`))?.[1]
    ?.trim();

  if (!releaseVersion) {
    fail(
      `The production overlay must declare the release version once as the ` +
        `"${VERSION_LABEL}" label`,
    );
  }

  return { images, releaseVersion };
}

/**
 * The release identifier of an image reference. Tag and digest pinning are
 * two different modes: a tag is shared by all components of a release, while
 * every image has its own digest.
 */
function pinningMode(reference) {
  const parsed = parseImageReference(reference);
  if (parsed.digest) return 'digest';
  if (parsed.tag) return 'tag';
  return 'unpinned';
}

/** Applies the `images:` transformer of the production overlay. */
function applyOverlay(reference, overlayImages) {
  const parsed = parseImageReference(reference);
  const entry = overlayImages.find((candidate) => candidate.name === parsed.name);
  if (!entry) return reference;
  const target = entry.newName ?? entry.name;
  if (entry.digest) return `${target}@${entry.digest}`;
  if (entry.newTag) return `${target}:${entry.newTag}`;
  return reference;
}

function validateImageReference(reference, context, releaseVersion) {
  if (!isBaseApiKeyImage(reference)) return undefined;
  const parsed = parseImageReference(reference);
  if (!parsed.name.startsWith(`${EXPECTED_REGISTRY}/`)) {
    fail(`${context}: image "${reference}" must be published to ${EXPECTED_REGISTRY}`);
    return undefined;
  }
  if (!EXPECTED_IMAGES.has(repositoryPath(reference))) {
    fail(`${context}: image "${reference}" is not a known BaseAPIKey image`);
    return undefined;
  }
  if (parsed.tag === FORBIDDEN_TAG) {
    fail(`${context}: image "${reference}" uses the mutable tag "${FORBIDDEN_TAG}"`);
  }
  if (parsed.tag === PLACEHOLDER_TAG) {
    fail(`${context}: image "${reference}" still uses the release placeholder`);
  }
  if (parsed.digest && !DIGEST_PATTERN.test(parsed.digest)) {
    fail(`${context}: image "${reference}" does not use a valid sha256 digest`);
  }
  if (!parsed.digest && parsed.tag && releaseVersion && parsed.tag !== releaseVersion) {
    fail(
      `${context}: image "${reference}" is not pinned to the release version ` +
        `"${releaseVersion}"`,
    );
  }
  if (!parsed.digest && !parsed.tag) {
    fail(`${context}: image "${reference}" is not pinned to a release tag or a digest`);
  }
  return pinningMode(reference);
}

function validateDistrolessCommands(document, context, imageReferences, runtimeBaseImages) {
  const distroless = imageReferences.some((reference) =>
    isDistrolessImage(reference, runtimeBaseImages),
  );
  if (!distroless) return;
  for (const list of commandLists(document)) {
    const executable = list.items[0];
    if (!executable) continue;
    if (executable === 'node') {
      fail(
        `${context}: the distroless image does not add /nodejs/bin to PATH, use the absolute ` +
          `path "/nodejs/bin/node" instead of "${executable}" (line ${list.line})`,
      );
      continue;
    }
    if (!DISTROLESS_EXECUTABLES.has(executable)) {
      fail(
        `${context}: the distroless image does not contain "${executable}", ` +
          'commands and lifecycle hooks must not depend on a shell or on other system ' +
          `binaries (line ${list.line})`,
      );
    }
  }
}

function validateTerminationSettings(documents, configValues) {
  const shutdownTimeoutMs = Number(configValues['SHUTDOWN_TIMEOUT_MS'] ?? '30000');
  const drainDelayMs = Number(configValues['SHUTDOWN_DRAIN_DELAY_MS'] ?? '10000');
  if (!Number.isFinite(shutdownTimeoutMs) || !Number.isFinite(drainDelayMs)) {
    fail('The shutdown configuration values must be numbers');
    return;
  }
  if (drainDelayMs >= shutdownTimeoutMs) {
    fail(
      `SHUTDOWN_DRAIN_DELAY_MS (${drainDelayMs}) must stay below SHUTDOWN_TIMEOUT_MS ` +
        `(${shutdownTimeoutMs})`,
    );
  }
  for (const document of documents) {
    const kind = documentKind(document);
    if (kind !== 'Deployment') continue;
    const images = documentImages(document).map((image) => image.value);
    if (!images.some((reference) => isBaseApiKeyImage(reference))) continue;
    const name = metadataName(document) ?? 'unknown';
    const gracePeriod = documentNumberValue(document, 'terminationGracePeriodSeconds');
    if (gracePeriod === undefined) {
      fail(`${kind} ${name}: terminationGracePeriodSeconds must be set explicitly`);
      continue;
    }
    if (gracePeriod * 1000 <= shutdownTimeoutMs) {
      fail(
        `${kind} ${name}: terminationGracePeriodSeconds (${gracePeriod}) must be above the ` +
          `shutdown budget (${shutdownTimeoutMs}ms) so the process can exit before SIGKILL`,
      );
    }
  }
}

function readConfigValues(documents) {
  const values = {};
  for (const document of documents) {
    if (documentKind(document) !== 'ConfigMap') continue;
    if (metadataName(document) !== 'baseapikey-config') continue;
    const dataMatch = document.match(/^data:\s*$([\s\S]*)$/m);
    if (!dataMatch) continue;
    for (const line of dataMatch[1].split('\n')) {
      const match = line.match(/^\s{2}([A-Z0-9_]+):\s*['"]?([^'"\n]+)['"]?\s*$/);
      if (match) values[match[1]] = match[2].trim();
    }
  }
  return values;
}

/**
 * Every component of a release must use the same pinning mode. A tag is
 * shared by the whole release, a digest belongs to one image only.
 */
function validatePinningModes(modes, context) {
  const distinct = new Set(modes.filter(Boolean));
  if (distinct.size > 1) {
    fail(
      `${context}: the components do not use the same pinning mode ` +
        `(${distinct.size > 1 ? [...distinct].join(', ') : 'unknown'})`,
    );
  }
}

function validateSource() {
  const baseFiles = listYamlFiles(baseRoot);
  const documents = [];
  for (const file of baseFiles) {
    const content = readFileSync(file, 'utf8');
    for (const document of splitDocuments(content)) {
      documents.push({ file, document });
    }
  }

  const overlay = readOverlayConfig();
  const runtimeBaseImages = readRuntimeBaseImages();
  const modes = [];

  for (const { file, document } of documents) {
    const kind = documentKind(document) ?? 'Manifest';
    const name = metadataName(document) ?? 'unknown';
    const context = `${kind} ${name} (${file.replace(`${repositoryRoot}/`, '')})`;
    const images = documentImages(document);
    const effective = images.map((image) => applyOverlay(image.value, overlay.images));
    for (const [index, image] of images.entries()) {
      const mode = validateImageReference(
        effective[index],
        `${context} image line ${image.line}`,
        overlay.releaseVersion,
      );
      if (mode) modes.push(mode);
    }
    validateDistrolessCommands(document, context, effective, runtimeBaseImages);
  }

  validatePinningModes(modes, 'The checked-in manifests');

  const gatewayDocument = documents.find(
    ({ document }) =>
      documentKind(document) === 'Deployment' && metadataName(document) === 'gateway',
  );
  const migrateDocument = documents.find(({ document }) => documentKind(document) === 'Job');
  if (gatewayDocument && migrateDocument) {
    const gatewayImage = applyOverlay(
      documentImages(gatewayDocument.document).at(0)?.value ?? '',
      overlay.images,
    );
    const migrateImage = applyOverlay(
      documentImages(migrateDocument.document).at(0)?.value ?? '',
      overlay.images,
    );
    if (gatewayImage !== migrateImage) {
      fail(
        `The migration job must run the same image as the Gateway ` +
          `("${migrateImage}" != "${gatewayImage}")`,
      );
    }
  }

  validateTerminationSettings(
    documents.map((entry) => entry.document),
    readConfigValues(documents.map((entry) => entry.document)),
  );

  if (overlay.releaseVersion) {
    note(`release version: ${overlay.releaseVersion}`);
  }
}

function validateRendered(file) {
  const content = readFileSync(file, 'utf8');
  const documents = splitDocuments(content);
  const runtimeBaseImages = readRuntimeBaseImages();
  const modes = [];
  for (const document of documents) {
    const kind = documentKind(document) ?? 'Manifest';
    const name = metadataName(document) ?? 'unknown';
    const context = `${kind} ${name}`;
    const releaseVersion = metadataLabel(document, VERSION_LABEL);
    const images = documentImages(document);
    for (const image of images) {
      const mode = validateImageReference(
        image.value,
        `${context} image line ${image.line}`,
        releaseVersion,
      );
      if (mode) {
        modes.push(mode);
        if (!releaseVersion) {
          fail(
            `${context}: the "${VERSION_LABEL}" label is missing, the release of the ` +
              'rendered manifests cannot be identified',
          );
        }
      }
    }
    validateDistrolessCommands(
      document,
      context,
      images.map((image) => image.value),
      runtimeBaseImages,
    );
  }
  validatePinningModes(modes, 'The rendered manifests');
}

function main() {
  const renderedIndex = process.argv.indexOf('--rendered');
  if (renderedIndex !== -1) {
    const renderedFile = process.argv[renderedIndex + 1];
    if (!renderedFile) {
      fail('--rendered requires the path of a rendered manifest');
    } else {
      validateRendered(renderedFile);
    }
  } else {
    validateSource();
  }

  for (const message of notes) {
    console.log(`note: ${message}`);
  }

  if (failures.length > 0) {
    console.error('Kubernetes release validation failed:');
    for (const message of failures) {
      console.error(`  - ${message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Kubernetes release validation passed.');
}

main();
