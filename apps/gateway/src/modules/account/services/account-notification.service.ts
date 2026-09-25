import type { AccountTokenPurpose } from './account-token.store';

export interface AccountNotification {
  purpose: AccountTokenPurpose;
  email: string;
  token: string;
  expiresAt: Date;
}

export interface IAccountNotificationService {
  send(notification: AccountNotification): Promise<void>;
}

export class NoopAccountNotificationService implements IAccountNotificationService {
  async send(_notification: AccountNotification): Promise<void> {}
}

export class WebhookAccountNotificationService implements IAccountNotificationService {
  constructor(
    private readonly webhookUrl: string,
    private readonly webhookSecret: string,
    private readonly timeoutMs = 5_000,
  ) {
    if (!webhookUrl.startsWith('https://') && process.env['NODE_ENV'] === 'production') {
      throw new Error('Account email webhook must use HTTPS in production');
    }
  }

  async send(notification: AccountNotification): Promise<void> {
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
          type: notification.purpose,
          email: notification.email,
          token: notification.token,
          expiresAt: notification.expiresAt.toISOString(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Account email webhook returned HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
