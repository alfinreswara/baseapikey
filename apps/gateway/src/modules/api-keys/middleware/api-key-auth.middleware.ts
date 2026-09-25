import { ApiKeyStatus, UserStatus } from '@baseapikey/database';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';

import { UnauthorizedError } from '../../auth/errors/auth.errors';
import type { IUserRepository } from '../../auth/repositories/user.repository';
import { PasswordService } from '../../auth/services/password.service';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { API_KEY_CONSTANTS } from '../api-keys.constants';
import {
  ApiKeyExpiredError,
  ApiKeyRevokedError,
  InvalidApiKeyError,
  MissingApiKeyError,
} from '../errors/api-key.errors';
import type { IApiKeyRepository } from '../repositories/api-key.repository';

export interface AuthenticatedApiKeyContext {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: unknown;
  createdAt: Date;
  expiresAt: Date | null;
  organizationId?: string | null | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: AuthenticatedApiKeyContext | undefined;
  }
}

/**
 * Extracts keyPrefix from raw API key string.
 * API Key format: `sk_live_<32_random_bytes_base64url>`
 * Returns `sk_live_` + first 8 characters of payload, or null if format is invalid.
 */
export function extractKeyPrefix(plaintextKey: string): string | null {
  if (!plaintextKey.startsWith(API_KEY_CONSTANTS.PREFIX)) {
    return null;
  }
  const payload = plaintextKey.substring(API_KEY_CONSTANTS.PREFIX.length);
  if (payload.length < 8) {
    return null;
  }
  return `${API_KEY_CONSTANTS.PREFIX}${payload.substring(0, 8)}`;
}

/**
 * Fastify preHandler middleware that authenticates API key from Authorization: Bearer header,
 * verifies Argon2id hash, checks revocation, expiration, and user status, and attaches request.user & request.apiKey.
 */
export function authenticateApiKey(
  apiKeyRepository: IApiKeyRepository,
  userRepository: IUserRepository,
  passwordService: PasswordService = new PasswordService(),
): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new MissingApiKeyError('Authorization header is required');
    }

    if (!authHeader.startsWith('Bearer ')) {
      throw new InvalidApiKeyError(
        'Invalid Authorization header format. Expected Bearer <api_key>',
      );
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new MissingApiKeyError('API key is missing in Authorization header');
    }

    const keyPrefix = extractKeyPrefix(token);
    if (!keyPrefix) {
      throw new InvalidApiKeyError('Invalid API key format');
    }

    const candidates = await apiKeyRepository.findByPrefix(keyPrefix);
    if (candidates.length === 0) {
      throw new InvalidApiKeyError('Invalid API key');
    }

    let authenticatedCandidate = null;

    for (const candidate of candidates) {
      const isValid = await passwordService.verify(token, candidate.keyHash);
      if (isValid) {
        authenticatedCandidate = candidate;
        break;
      }
    }

    if (!authenticatedCandidate) {
      throw new InvalidApiKeyError('Invalid API key');
    }

    if (
      authenticatedCandidate.status === ApiKeyStatus.REVOKED ||
      authenticatedCandidate.deletedAt !== null
    ) {
      throw new ApiKeyRevokedError('API key has been revoked');
    }

    if (
      authenticatedCandidate.expiresAt !== null &&
      authenticatedCandidate.expiresAt <= new Date()
    ) {
      throw new ApiKeyExpiredError('API key has expired');
    }

    const user = await userRepository.findById(authenticatedCandidate.userId);
    if (!user || user.status === UserStatus.SUSPENDED || user.status === UserStatus.DELETED) {
      throw new UnauthorizedError('User account associated with API key is inactive or suspended');
    }

    // Fire-and-forget async update of lastUsedAt
    void apiKeyRepository.updateLastUsedAt(authenticatedCandidate.id, new Date()).catch(() => {});

    // Attach request context (keyHash is explicitly NOT included)
    const apiKeyContext: AuthenticatedApiKeyContext = {
      id: authenticatedCandidate.id,
      name: authenticatedCandidate.name,
      keyPrefix: authenticatedCandidate.keyPrefix,
      permissions: authenticatedCandidate.permissions,
      createdAt: authenticatedCandidate.createdAt,
      expiresAt: authenticatedCandidate.expiresAt,
      organizationId: authenticatedCandidate.organizationId ?? null,
    };

    const userContext: AuthenticatedUser = {
      userId: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: 1,
    };

    request.apiKey = apiKeyContext;
    request.user = userContext;
  };
}

/**
 * Fastify preHandler guard enforcing that request.apiKey is present.
 */
export function requireApiKey(): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.apiKey) {
      throw new UnauthorizedError('Unauthorized access: authenticated API key context missing');
    }
  };
}

/**
 * Request context helper retrieving authenticated API key from request context.
 * Throws UnauthorizedError if missing.
 */
export function getRequestApiKey(request: FastifyRequest): AuthenticatedApiKeyContext {
  if (!request.apiKey) {
    throw new UnauthorizedError('No authenticated API key attached to request context');
  }
  return request.apiKey;
}
