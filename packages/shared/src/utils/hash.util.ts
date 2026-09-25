import { createHash } from 'node:crypto';

export function hashSha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}
