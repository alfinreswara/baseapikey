import * as argon2 from 'argon2';

import { AUTH_CONSTANTS } from '../constants/auth.constants';

export async function hashPassword(plainText: string): Promise<string> {
  return argon2.hash(plainText, AUTH_CONSTANTS.ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plainText: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plainText);
  } catch {
    return false;
  }
}
