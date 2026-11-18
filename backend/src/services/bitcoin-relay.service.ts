import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BoundedMap } from '@/utils/bounded-cache.util';
import { normalizeBitcoinProofAddress } from '@/utils/wallet-address.util';
import { BitcoinSignatureService } from './bitcoin-signature.service';

interface Relay { address: string; message: string; expires: number; signature?: string }

/** Bouncer's own Bitcoin challenges; the relay never carries other text. */
const BOUNCER_MESSAGE = /^Bouncer (?:wallet verification|saved-wallet link)\n/;
const TTL_MS = 15 * 60 * 1000;

/**
 * Carries a signature from a wallet app back to the page that asked for it.
 * Freewallet signs a `counterparty:` link and posts the result to the link's
 * callback; the page then submits it like a pasted signature, so verification
 * and linking still run through their usual checks.
 */
@Injectable()
export class BitcoinRelayService {
  private readonly relays = new BoundedMap<string, Relay>(2000);

  constructor(private readonly bitcoin: BitcoinSignatureService) {}

  create(address: string, message: string): { id: string; expiresAt: string } {
    const normalized = normalizeBitcoinProofAddress(address);
    if (!BOUNCER_MESSAGE.test(message) || !message.includes(`Address: ${normalized}\n`) || message.length > 2000)
      throw new Error('Request a new Bouncer message first.');
    const id = randomBytes(24).toString('base64url');
    const expires = Date.now() + TTL_MS;
    this.relays.set(id, { address: normalized, message, expires });
    return { id, expiresAt: new Date(expires).toISOString() };
  }

  /** Accepts the wallet's signature only if it signs the relay's message for its address. */
  deliver(id: string, address: string | undefined, signature: string | undefined): void {
    const relay = this.active(id);
    if (!relay || typeof signature !== 'string') throw new Error('Unknown or expired request.');
    if (address !== undefined && normalizeBitcoinProofAddress(address) !== relay.address)
      throw new Error('The signature is for a different address.');
    const value = signature.trim();
    this.bitcoin.verifyMessage(relay.address, relay.message, value);
    relay.signature = value;
  }

  /** The delivered signature, `null` while waiting, or `undefined` once unknown or expired. */
  read(id: string): string | null | undefined {
    const relay = this.active(id);
    return relay ? relay.signature ?? null : undefined;
  }

  private active(id: string): Relay | undefined {
    const relay = this.relays.get(id);
    if (relay && relay.expires <= Date.now()) this.relays.delete(id);
    return relay && relay.expires > Date.now() ? relay : undefined;
  }
}
