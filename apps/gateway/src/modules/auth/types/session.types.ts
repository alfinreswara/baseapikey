export interface UserSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  deviceId: string | null;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}
