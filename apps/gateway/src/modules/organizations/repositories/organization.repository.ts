import {
  AuditSeverity,
  OrganizationMemberStatus,
  OrganizationPlan,
  OrganizationRole,
  prisma,
} from '@baseapikey/database';

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  billingEmail: string | null;
  plan: OrganizationPlan;
  spendingLimitCents: number | null;
  isActive: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface OrganizationMembershipRecord {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  status: OrganizationMemberStatus;
  joinedAt: Date | null;
  createdAt: Date;
  user: {
    email: string;
    username: string;
    fullName: string;
    avatarUrl: string | null;
  };
  organization?: OrganizationRecord | undefined;
}

export interface OrganizationAuditData {
  organizationId: string;
  userId: string;
  action: string;
  resourceId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
  severity?: AuditSeverity | undefined;
}

export interface IOrganizationRepository {
  listForUser(userId: string): Promise<OrganizationMembershipRecord[]>;
  getActiveOrganizationId?(userId: string): Promise<string | null>;
  findById(organizationId: string): Promise<OrganizationRecord | null>;
  findMembership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembershipRecord | null>;
  createOrganization(data: {
    ownerId: string;
    name: string;
    slug: string;
    billingEmail?: string | undefined;
  }): Promise<OrganizationRecord>;
  updateOrganization(
    organizationId: string,
    data: {
      name?: string | undefined;
      billingEmail?: string | null | undefined;
      spendingLimitCents?: number | null | undefined;
      plan?: OrganizationPlan | undefined;
      metadata?: Record<string, unknown> | undefined;
    },
  ): Promise<OrganizationRecord>;
  setActiveOrganization(userId: string, organizationId: string): Promise<void>;
  findUserByEmail(email: string): Promise<{ id: string; email: string } | null>;
  listMembers(
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<OrganizationMembershipRecord[]>;
  addMember(data: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
    invitedById: string;
  }): Promise<OrganizationMembershipRecord>;
  updateMemberRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<OrganizationMembershipRecord>;
  removeMember(organizationId: string, userId: string): Promise<void>;
  countOwners(organizationId: string): Promise<number>;
  recordAudit(data: OrganizationAuditData): Promise<void>;
  createInvitation?(data: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }): Promise<{ id: string; email: string; role: OrganizationRole; expiresAt: Date }>;
  acceptInvitation?(data: {
    tokenHash: string;
    userId: string;
    email: string;
  }): Promise<{ organizationId: string; role: OrganizationRole } | null>;
}

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  ownerId: true,
  billingEmail: true,
  plan: true,
  spendingLimitCents: true,
  isActive: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const membershipInclude = {
  user: {
    select: { email: true, username: true, fullName: true, avatarUrl: true },
  },
} as const;

export class PrismaOrganizationRepository implements IOrganizationRepository {
  async getActiveOrganizationId(userId: string): Promise<string | null> {
    const preference = await prisma.userOrganizationPreference.findUnique({
      where: { userId },
      select: { activeOrganizationId: true },
    });
    return preference?.activeOrganizationId ?? null;
  }

  async createInvitation(data: {
    organizationId: string;
    email: string;
    role: OrganizationRole;
    tokenHash: string;
    invitedById: string;
    expiresAt: Date;
  }): Promise<{ id: string; email: string; role: OrganizationRole; expiresAt: Date }> {
    return prisma.organizationInvitation.upsert({
      where: {
        organizationId_email: {
          organizationId: data.organizationId,
          email: data.email.toLowerCase(),
        },
      },
      create: { ...data, email: data.email.toLowerCase() },
      update: {
        role: data.role,
        tokenHash: data.tokenHash,
        invitedById: data.invitedById,
        expiresAt: data.expiresAt,
        acceptedAt: null,
        revokedAt: null,
      },
      select: { id: true, email: true, role: true, expiresAt: true },
    });
  }

  async acceptInvitation(data: {
    tokenHash: string;
    userId: string;
    email: string;
  }): Promise<{ organizationId: string; role: OrganizationRole } | null> {
    return prisma.$transaction(async (tx) => {
      const invitation = await tx.organizationInvitation.findFirst({
        where: {
          tokenHash: data.tokenHash,
          email: data.email.toLowerCase(),
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (!invitation) return null;
      await tx.organizationMember.upsert({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId: data.userId,
          },
        },
        create: {
          organizationId: invitation.organizationId,
          userId: data.userId,
          role: invitation.role,
          status: OrganizationMemberStatus.ACTIVE,
          invitedById: invitation.invitedById,
          joinedAt: new Date(),
        },
        update: {
          role: invitation.role,
          status: OrganizationMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      });
      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return { organizationId: invitation.organizationId, role: invitation.role };
    });
  }

  async listForUser(userId: string): Promise<OrganizationMembershipRecord[]> {
    return prisma.organizationMember.findMany({
      where: {
        userId,
        status: OrganizationMemberStatus.ACTIVE,
        organization: { isActive: true, deletedAt: null },
      },
      include: {
        ...membershipInclude,
        organization: { select: organizationSelect },
      },
      orderBy: { organization: { name: 'asc' } },
    });
  }

  async findById(organizationId: string): Promise<OrganizationRecord | null> {
    return prisma.organization.findFirst({
      where: { id: organizationId, isActive: true, deletedAt: null },
      select: organizationSelect,
    });
  }

  async findMembership(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMembershipRecord | null> {
    return prisma.organizationMember.findFirst({
      where: { organizationId, userId, status: OrganizationMemberStatus.ACTIVE },
      include: membershipInclude,
    });
  }

  async createOrganization(data: {
    ownerId: string;
    name: string;
    slug: string;
    billingEmail?: string | undefined;
  }): Promise<OrganizationRecord> {
    return prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: data.name,
          slug: data.slug,
          ownerId: data.ownerId,
          billingEmail: data.billingEmail ?? null,
        },
        select: organizationSelect,
      });
      await tx.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: data.ownerId,
          role: OrganizationRole.OWNER,
          status: OrganizationMemberStatus.ACTIVE,
          joinedAt: new Date(),
        },
      });
      await tx.billingAccount.create({ data: { organizationId: organization.id } });
      const preference = await tx.userOrganizationPreference.findUnique({
        where: { userId: data.ownerId },
        select: { userId: true },
      });
      if (!preference) {
        await tx.userOrganizationPreference.create({
          data: { userId: data.ownerId, activeOrganizationId: organization.id },
        });
      }
      return organization;
    });
  }

  async updateOrganization(
    organizationId: string,
    data: {
      name?: string | undefined;
      billingEmail?: string | null | undefined;
      spendingLimitCents?: number | null | undefined;
      plan?: OrganizationPlan | undefined;
      metadata?: Record<string, unknown> | undefined;
    },
  ): Promise<OrganizationRecord> {
    return prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.billingEmail !== undefined ? { billingEmail: data.billingEmail } : {}),
        ...(data.spendingLimitCents !== undefined
          ? { spendingLimitCents: data.spendingLimitCents }
          : {}),
        ...(data.plan !== undefined ? { plan: data.plan } : {}),
        ...(data.metadata !== undefined ? { metadata: data.metadata as object } : {}),
      },
      select: organizationSelect,
    });
  }

  async setActiveOrganization(userId: string, organizationId: string): Promise<void> {
    await prisma.userOrganizationPreference.upsert({
      where: { userId },
      create: { userId, activeOrganizationId: organizationId },
      update: { activeOrganizationId: organizationId },
    });
  }

  async findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, email: true },
    });
  }

  async listMembers(
    organizationId: string,
    limit: number,
    cursor?: string,
  ): Promise<OrganizationMembershipRecord[]> {
    return prisma.organizationMember.findMany({
      where: { organizationId },
      include: membershipInclude,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async addMember(data: {
    organizationId: string;
    userId: string;
    role: OrganizationRole;
    invitedById: string;
  }): Promise<OrganizationMembershipRecord> {
    return prisma.organizationMember.create({
      data: {
        ...data,
        status: OrganizationMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
      include: membershipInclude,
    });
  }

  async updateMemberRole(
    organizationId: string,
    userId: string,
    role: OrganizationRole,
  ): Promise<OrganizationMembershipRecord> {
    return prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId } },
      data: { role },
      include: membershipInclude,
    });
  }

  async removeMember(organizationId: string, userId: string): Promise<void> {
    await prisma.$transaction([
      prisma.organizationMember.delete({
        where: { organizationId_userId: { organizationId, userId } },
      }),
      prisma.userOrganizationPreference.deleteMany({
        where: { userId, activeOrganizationId: organizationId },
      }),
    ]);
  }

  async countOwners(organizationId: string): Promise<number> {
    return prisma.organizationMember.count({
      where: {
        organizationId,
        role: OrganizationRole.OWNER,
        status: OrganizationMemberStatus.ACTIVE,
      },
    });
  }

  async recordAudit(data: OrganizationAuditData): Promise<void> {
    await prisma.auditLog.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        action: data.action,
        resource: 'Organization',
        resourceId: data.resourceId ?? data.organizationId,
        metadata: (data.metadata as object) ?? {},
        ipAddress: data.ipAddress ?? null,
        userAgent: data.userAgent ?? null,
        requestId: data.requestId ?? null,
        severity: data.severity ?? AuditSeverity.INFO,
      },
    });
  }
}
