import { AUTH_CONSTANTS } from '../constants/auth.constants';
import type { AuthConfig, JwtPayload, TokenPair, TokenType } from '../types/auth.types';
import { signJwt, verifyJwt } from '../utils/jwt.util';

export interface GenerateTokenOptions {
  userId: string;
  email: string;
  role: string;
  sessionId?: string | undefined;
  apiVersion?: string | undefined;
  tokenVersion?: number | undefined;
  activeOrganizationId?: string | undefined;
  organizationRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | undefined;
}

export class JwtService {
  constructor(private readonly config: AuthConfig) {}

  generateAccessToken(
    userIdOrOptions: string | GenerateTokenOptions,
    email?: string,
    role?: string,
    sessionId?: string,
  ): string {
    const opts: GenerateTokenOptions =
      typeof userIdOrOptions === 'string'
        ? {
            userId: userIdOrOptions,
            email: email!,
            role: role!,
            sessionId,
          }
        : userIdOrOptions;

    const payload: JwtPayload = {
      sub: opts.userId,
      email: opts.email,
      role: opts.role,
      apiVersion: opts.apiVersion ?? 'v1',
      tokenVersion: opts.tokenVersion ?? 1,
      sessionId: opts.sessionId,
      activeOrganizationId: opts.activeOrganizationId,
      organizationRole: opts.organizationRole,
      type: 'access',
    };
    return signJwt(payload, this.config.jwtAccessSecret, this.config.jwtAccessExpiresIn);
  }

  generateRefreshToken(
    userIdOrOptions: string | GenerateTokenOptions,
    email?: string,
    role?: string,
    sessionId?: string,
  ): string {
    const opts: GenerateTokenOptions =
      typeof userIdOrOptions === 'string'
        ? {
            userId: userIdOrOptions,
            email: email!,
            role: role!,
            sessionId,
          }
        : userIdOrOptions;

    const payload: JwtPayload = {
      sub: opts.userId,
      email: opts.email,
      role: opts.role,
      apiVersion: opts.apiVersion ?? 'v1',
      tokenVersion: opts.tokenVersion ?? 1,
      sessionId: opts.sessionId,
      activeOrganizationId: opts.activeOrganizationId,
      organizationRole: opts.organizationRole,
      type: 'refresh',
    };
    return signJwt(payload, this.config.jwtRefreshSecret, this.config.jwtRefreshExpiresIn);
  }

  generateTokenPair(
    userIdOrOptions: string | GenerateTokenOptions,
    email?: string,
    role?: string,
    sessionId?: string,
  ): TokenPair {
    const opts: GenerateTokenOptions =
      typeof userIdOrOptions === 'string'
        ? {
            userId: userIdOrOptions,
            email: email!,
            role: role!,
            sessionId,
          }
        : userIdOrOptions;

    const accessToken = this.generateAccessToken(opts);
    const refreshToken = this.generateRefreshToken(opts);

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.jwtAccessExpiresIn,
      tokenType: AUTH_CONSTANTS.TOKEN_TYPE,
    };
  }

  verifyToken(token: string, type: TokenType = 'access'): JwtPayload {
    const secret = type === 'access' ? this.config.jwtAccessSecret : this.config.jwtRefreshSecret;
    const payload = verifyJwt(token, secret);

    if (payload.type !== type) {
      throw new Error(`Invalid token type. Expected ${type}, got ${payload.type}`);
    }

    return payload;
  }
}
