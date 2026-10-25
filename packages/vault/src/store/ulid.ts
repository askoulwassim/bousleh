import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 10 characters of millisecond time, then 16 of randomness (Crockford base32). */
export function ulid(time: number, random: Uint8Array = randomBytes(10)): string {
  if (random.length !== 10) throw new Error('ulid needs 10 random bytes');
  let t = Math.floor(time);
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD.charAt(t % 32) + timePart;
    t = Math.floor(t / 32);
  }
  let r = 0n;
  for (const byte of random) r = (r << 8n) | BigInt(byte);
  let randomPart = '';
  for (let i = 0; i < 16; i++) {
    randomPart = CROCKFORD.charAt(Number(r & 31n)) + randomPart;
    r >>= 5n;
  }
  return timePart + randomPart;
}

/** `<prefix>_<ULID>`. */
export function newId(prefix: string, now: Date): string {
  return `${prefix}_${ulid(now.getTime())}`;
}
