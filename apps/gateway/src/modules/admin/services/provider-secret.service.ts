import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { ProviderEncryptionNotConfiguredError } from '../errors/admin.errors';

export class ProviderSecretService {
  private readonly key: Buffer | null;

  constructor(encodedKey?: string) {
    if (!encodedKey) {
      this.key = null;
      return;
    }
    const decoded = Buffer.from(encodedKey, 'base64');
    this.key = decoded.length === 32 ? decoded : null;
  }

  encrypt(value: string): string {
    if (!this.key) throw new ProviderEncryptionNotConfiguredError();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decrypt(value: string): string {
    if (!this.key) throw new ProviderEncryptionNotConfiguredError();
    const [version, ivValue, tagValue, ciphertextValue] = value.split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
      throw new Error('Provider credential ciphertext is invalid');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
