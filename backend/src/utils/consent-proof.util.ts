import { createHash } from 'crypto';

/** Salt consent with the one-time nonce so the hash is not a community fingerprint. */
export const consentCommitment = (nonce: string, proof: string) =>
  '0x' + createHash('sha256').update(JSON.stringify([nonce, proof])).digest('hex');
