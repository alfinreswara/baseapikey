import {
  AuditSeverity,
  OrganizationMemberStatus,
  OrganizationRole,
  prisma,
  User,
  UserRole,
  UserStatus,
} from '@baseapikey/database';

export interface CreateUserData {
  email: string;
  username: string;
  fullName: string;
  passwordHash: string;
  role?: UserRole | undefined;
  status?: UserStatus | undefined;
  emailVerified?: boolean | undefined;
}

export interface RecordAuditLogData {
  userId?: string | undefined;
  action: string;
  resource: string;
  resourceId?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  severity?: AuditSeverity | undefined;
}

export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByUsername(username: string): Promise<User | null>;
  create(data: CreateUserData): Promise<User>;
  updateLastLogin(userId: string, lastLoginAt: Date): Promise<User>;
  recordAuditLog(data: RecordAuditLogData): Promise<void>;
  getActiveOrganizationContext?(userId: string): Promise<{
    activeOrganizationId: string;
    organizationRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  } | null>;
}

export class PrismaUserRepository implements IUserRepository {
  async getActiveOrganizationContext(userId: string): Promise<{
    activeOrganizationId: string;
    organizationRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  } | null> {
    const preference = await this.db.userOrganizationPreference.findUnique({
      where: { userId },
      select: { activeOrganizationId: true },
    });
    if (!preference) return null;
    const membership = await this.db.organizationMember.findFirst({
      where: {
        userId,
        organizationId: preference.activeOrganizationId,
        status: OrganizationMemberStatus.ACTIVE,
      },
      select: { role: true },
    });
    return membership
      ? {
          activeOrganizationId: preference.activeOrganizationId,
          organizationRole: membership.role,
        }
      : null;
  }

  private get db() {
    return prisma;
  }

  async findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({
      where: { email },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.db.user.findUnique({
      where: { username },
    });
  }

  async create(data: CreateUserData): Promise<User> {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          username: data.username,
          fullName: data.fullName,
          passwordHash: data.passwordHash,
          role: data.role ?? UserRole.USER,
          status: data.status ?? UserStatus.ACTIVE,
          emailVerified: data.emailVerified ?? false,
        },
      });
      const organization = await tx.organization.create({
        data: {
          name: `${data.fullName.slice(0, 230)}'s Organization`,
          slug: `${data.username
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .slice(0, 40)}-${user.id}`,
          ownerId: user.id,
          billingEmail: data.email,
        },
      });
      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: OrganizationRole.OWNER,
          status: OrganizationMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      });
      await tx.billingAccount.create({ data: { organizationId: organization.id } });
      await tx.userOrganizationPreference.create({
        data: { userId: user.id, activeOrganizationId: organization.id },
      });
      return user;
    });
  }

  async updateLastLogin(userId: string, lastLoginAt: Date): Promise<User> {
    return this.db.user.update({
      where: { id: userId },
      data: { lastLoginAt },
    });
  }

  async recordAuditLog(data: RecordAuditLogData): Promise<void> {
    await this.db.auditLog.create({
      data: {
        userId: data.userId ?? null,
        action: data.action,
        resource: data.resource,
        resourceId: data.resourceId ?? null,
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        requestId: data.requestId ?? null,
        metadata: (data.metadata as object) ?? {},
        severity: data.severity ?? AuditSeverity.INFO,
      },
    });
  }
}
