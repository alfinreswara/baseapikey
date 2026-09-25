import { AuditSeverity, prisma, type User } from '@baseapikey/database';

export interface AccountAuditData {
  userId: string;
  action: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  severity?: AuditSeverity | undefined;
}

export interface UpdateAccountProfileData {
  fullName?: string | undefined;
  avatarUrl?: string | null | undefined;
}

export interface IAccountRepository {
  findById(userId: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  updateProfile(userId: string, data: UpdateAccountProfileData): Promise<User>;
  updatePassword(userId: string, passwordHash: string): Promise<User>;
  markEmailVerified(userId: string): Promise<User>;
  recordAudit(data: AccountAuditData): Promise<void>;
}

export class PrismaAccountRepository implements IAccountRepository {
  async findById(userId: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id: userId } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
  }

  async updateProfile(userId: string, data: UpdateAccountProfileData): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
      },
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<User> {
    return prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async markEmailVerified(userId: string): Promise<User> {
    return prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
  }

  async recordAudit(data: AccountAuditData): Promise<void> {
    await prisma.auditLog.create({
      data: {
        userId: data.userId,
        action: data.action,
        resource: 'User',
        resourceId: data.userId,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        requestId: data.requestId ?? null,
        metadata: (data.metadata as object) ?? {},
        severity: data.severity ?? AuditSeverity.INFO,
      },
    });
  }
}
