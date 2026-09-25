import { hashPassword, verifyPassword } from '../utils/argon2.util';

export class PasswordService {
  async hash(plainText: string): Promise<string> {
    return hashPassword(plainText);
  }

  async verify(plainText: string, hash: string): Promise<boolean> {
    return verifyPassword(hash, plainText);
  }
}

export const passwordService = new PasswordService();
