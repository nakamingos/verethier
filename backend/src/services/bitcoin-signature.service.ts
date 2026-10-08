import { Injectable } from '@nestjs/common';
import { Verifier } from 'bip322-js';
import { EnvironmentConfig } from '@/config/environment.config';
import { DecodedData } from '@/models/app.interface';
import { normalizeBitcoinAddress, WalletType } from '@/utils/wallet-address.util';
import { DbService } from './db.service';
import { NonceData, NonceService } from './nonce.service';

@Injectable()
export class BitcoinSignatureService {
  constructor(private readonly nonceSvc: NonceService, private readonly dbSvc: DbService) {}

  async getContext(userId: string | undefined, guildId: string | undefined, nonce: string): Promise<{ walletTypes: WalletType[]; expiry: number; data?: DecodedData }> {
    const context = userId !== undefined || guildId !== undefined
      ? await this.nonceSvc.getActiveNonce(userId, guildId, nonce)
      : await this.nonceSvc.getActiveNonceByToken(nonce);
    const rules = context.channelId
      ? await this.dbSvc.getRulesByChannel(context.guildId, context.channelId)
      : await this.dbSvc.getRoleMappings(context.guildId);
    if (!rules.length) throw new Error('No verification rules found for this channel.');
    const walletTypes: WalletType[] = [];
    if (rules.some(rule => rule.asset_type !== 'ordinal')) walletTypes.push('evm');
    if (rules.some(rule => rule.asset_type === 'ordinal')) walletTypes.push('bitcoin');
    return {
      walletTypes,
      expiry: context.expiry,
      ...(context.verificationData ? { data: {
        ...context.verificationData,
        address: '',
        userId: context.userId,
        discordId: context.guildId,
        nonce: context.nonce,
        expiry: context.expiry,
      } } : {}),
    };
  }

  async createChallenge(userId: string, guildId: string, nonce: string, address: string) {
    const { walletTypes, expiry } = await this.getContext(userId, guildId, nonce);
    if (!walletTypes.includes('bitcoin')) throw new Error('This verification channel does not support Ordinals.');
    const context = await this.nonceSvc.getActiveNonce(userId, guildId, nonce);
    const normalizedAddress = normalizeBitcoinAddress(address);
    let domain: string;
    try {
      const url = new URL(EnvironmentConfig.BASE_URL);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
      domain = url.origin;
    } catch { throw new Error('Bitcoin verification is not configured. Set BASE_URL on the backend.'); }
    const message = [
      'Verethier wallet verification', '',
      `Domain: ${domain}`, 'Wallet: Bitcoin mainnet · Ordinals', `Address: ${normalizedAddress}`,
      `Discord user: ${context.userId}`, `Discord server: ${context.guildId}`,
      `Discord channel: ${context.channelId || 'server'}`, `Nonce: ${context.nonce}`,
      `Expires at: ${new Date(expiry * 1000).toISOString()}`, '',
      'Sign this message to verify your collection for eligible Discord roles.',
    ].join('\n');
    await this.nonceSvc.saveBitcoinChallenge(userId, guildId, nonce, { address: normalizedAddress, message });
    return { address: normalizedAddress, message, expiry };
  }

  async verify(data: DecodedData, signature: string): Promise<{ address: string; context: NonceData }> {
    const context = await this.nonceSvc.getActiveNonce(data.userId, data.discordId, data.nonce);
    const address = normalizeBitcoinAddress(data.address);
    const challenge = context.bitcoinChallenge;
    if (!challenge || challenge.address !== address || context.expiry !== data.expiry) throw new Error('Invalid Bitcoin verification challenge.');
    this.verifyMessage(address, challenge.message, signature);
    // Consume before linking the address, including concurrent submissions of the same proof.
    const consumed = await this.nonceSvc.consumeNonce(data.userId, data.discordId, data.nonce);
    if (consumed.bitcoinChallenge?.message !== challenge.message || consumed.bitcoinChallenge?.address !== address) {
      throw new Error('Invalid Bitcoin verification challenge.');
    }
    return { address, context: consumed };
  }

  verifyMessage(address: string, message: string, signature: string): void {
    try {
      normalizeBitcoinAddress(address);
      const simple = signature.startsWith('smp') ? signature.slice(3) : signature;
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(simple) || simple.length > 100) throw new Error();
      const bytes = Buffer.from(simple, 'base64');
      // This release accepts a simple, single-key Taproot witness, never legacy or script-path proofs.
      if (bytes.toString('base64') !== simple || bytes[0] !== 1 || ![64, 65].includes(bytes[1])
        || bytes.length !== bytes[1] + 2 || (bytes[1] === 65 && bytes[66] !== 1)) throw new Error();
      if (!Verifier.verifySignature(address.toLowerCase(), message, simple, true)) throw new Error();
    } catch { throw new Error('Invalid Bitcoin signature. Please sign again with your Xverse Ordinals address.'); }
  }
}
