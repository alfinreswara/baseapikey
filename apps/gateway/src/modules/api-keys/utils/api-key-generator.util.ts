import { randomBytes } from 'node:crypto';

import { API_KEY_CONSTANTS } from '../api-keys.constants';

export interface GeneratedApiKey {
  plaintextKey: string;
  keyPrefix: string;
}

/**
 * Generates a cryptographically secure random API Key.
 * Key format: `sk_live_<32_random_bytes_base64url>`
 */
export function generateApiKey(prefix = API_KEY_CONSTANTS.PREFIX): GeneratedApiKey {
  const bytes = randomBytes(API_KEY_CONSTANTS.RANDOM_BYTES_COUNT);
  const randomPayload = bytes.toString('base64url');
  const plaintextKey = `${prefix}${randomPayload}`;
  // Extract key prefix (prefix + first 8 chars of random payload) for display identification
  const keyPrefix = `${prefix}${randomPayload.substring(0, 8)}`;

  return {
    plaintextKey,
    keyPrefix,
  };
}
