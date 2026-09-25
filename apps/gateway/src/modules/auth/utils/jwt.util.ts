import jwt, { Secret, SignOptions, VerifyOptions } from 'jsonwebtoken';

import { AUTH_CONSTANTS } from '../constants/auth.constants';
import { InvalidTokenError, TokenExpiredError } from '../errors/auth.errors';
import type { JwtPayload } from '../types/auth.types';

export function signJwt<T extends object>(
  payload: T,
  secret: Secret,
  expiresIn?: string | number,
  options?: SignOptions,
): string {
  const opts: SignOptions = {
    algorithm: AUTH_CONSTANTS.ALGORITHM,
    issuer: AUTH_CONSTANTS.ISSUER,
    audience: AUTH_CONSTANTS.AUDIENCE,
    ...options,
  };
  if (expiresIn !== undefined && !('exp' in payload)) {
    Object.assign(opts, { expiresIn });
  }
  return jwt.sign(payload, secret, opts);
}

export function verifyJwt<T extends JwtPayload = JwtPayload>(
  token: string,
  secret: Secret,
  options?: VerifyOptions,
): T {
  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: [AUTH_CONSTANTS.ALGORITHM],
      issuer: AUTH_CONSTANTS.ISSUER,
      audience: AUTH_CONSTANTS.AUDIENCE,
      ...options,
    });
    return decoded as T;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw new TokenExpiredError();
    }
    if (error instanceof Error && error.name === 'JsonWebTokenError') {
      throw new InvalidTokenError(error.message);
    }
    throw new InvalidTokenError();
  }
}
