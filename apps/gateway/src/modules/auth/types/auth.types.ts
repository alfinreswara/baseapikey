export type TokenType = 'access' | 'refresh';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  apiVersion?: string | undefined;
  tokenVersion?: number | undefined;
  sessionId?: string | undefined;
  activeOrganizationId?: string | undefined;
  organizationRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | undefined;
  type: TokenType;
  jti?: string | undefined;
  iat?: number | undefined;
  exp?: number | undefined;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tokenType: string;
}

export interface AuthConfig {
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessExpiresIn: string;
  jwtRefreshExpiresIn: string;
}

export interface LoginMetadata {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export interface AuthenticatedUser {
  userId: string;
  email: string;
  username?: string | undefined;
  role: string;
  sessionId?: string | undefined;
  tokenVersion: number;
  activeOrganizationId?: string | undefined;
  organizationRole?: 'OWNER' | 'ADMIN' | 'MEMBER' | undefined;
}
