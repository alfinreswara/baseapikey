import { randomBytes } from 'node:crypto';

export function generateUuidV7(): string {
  const value = randomBytes(16);
  const timestamp = BigInt(Date.now());

  value[0] = Number((timestamp >> 40n) & 0xffn);
  value[1] = Number((timestamp >> 32n) & 0xffn);
  value[2] = Number((timestamp >> 24n) & 0xffn);
  value[3] = Number((timestamp >> 16n) & 0xffn);
  value[4] = Number((timestamp >> 8n) & 0xffn);
  value[5] = Number(timestamp & 0xffn);

  value[6] = (value[6]! & 0x0f) | 0x70;
  value[8] = (value[8]! & 0x3f) | 0x80;

  const hex = value.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
