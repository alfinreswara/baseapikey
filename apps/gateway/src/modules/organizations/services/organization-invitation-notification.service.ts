export interface OrganizationInvitationNotification {
  email: string;
  organizationName: string;
  role: string;
  token: string;
  expiresAt: Date;
}

export interface IOrganizationInvitationNotificationService {
  send(notification: OrganizationInvitationNotification): Promise<void>;
}

export class NoopOrganizationInvitationNotificationService implements IOrganizationInvitationNotificationService {
  async send(_notification: OrganizationInvitationNotification): Promise<void> {}
}

export class WebhookOrganizationInvitationNotificationService implements IOrganizationInvitationNotificationService {
  constructor(
    private readonly webhookUrl: string,
    private readonly webhookSecret: string,
    private readonly dashboardUrl: string,
    private readonly timeoutMs = 5_000,
  ) {}

  async send(notification: OrganizationInvitationNotification): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.webhookSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'organization_invitation',
          email: notification.email,
          organizationName: notification.organizationName,
          role: notification.role,
          token: notification.token,
          acceptUrl: `${this.dashboardUrl.replace(/\/$/, '')}/invitations/${notification.token}`,
          expiresAt: notification.expiresAt.toISOString(),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Invitation webhook returned HTTP ${response.status}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
