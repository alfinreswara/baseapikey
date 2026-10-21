/**
 * Helpers for the image references of the release.
 *
 * An image reference has no scheme, for example
 * `ghcr.io/owner/baseapikey-gateway:scan-abc` or `localhost:5000/baseapikey-gateway`.
 * A host is never compared with a substring: a substring can appear anywhere
 * in the value, and a reference can carry a path or a tag that contains the
 * name of a registry. The reference is parsed and its host is compared.
 */

/** The registry of the published images. */
export const PUBLIC_REGISTRY = 'ghcr.io';

/**
 * The host of an image reference, for example `ghcr.io` or `localhost`.
 *
 * The tag of a reference is separated by a colon, the port of a registry is
 * separated by a colon as well. The tag is the part after the last colon that
 * is not part of the path, it is removed before the host is parsed.
 */
export function registryHost(reference) {
  if (typeof reference !== 'string' || reference.length === 0) {
    return '';
  }
  const withoutTag = reference.replace(/:[^/]+$/, '');
  try {
    return new URL(`https://${withoutTag}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** True when the reference points at the public registry of the release. */
export function isPublicRegistry(reference) {
  return registryHost(reference) === PUBLIC_REGISTRY;
}

/**
 * True when the reference points at the host of the runner. The registry of
 * the runner is not reachable from another host.
 */
export function isLocalRegistry(reference) {
  const host = registryHost(reference);
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
