import { Signer } from 'bip322-js';
import { address as bitcoinAddress } from 'bitcoinjs-lib';
import { NonceService } from '../src/services/nonce.service';
import { BitcoinSignatureService } from '../src/services/bitcoin-signature.service';
import { WalletService } from '../src/services/wallet.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { normalizeBitcoinAddress } from '../src/utils/wallet-address.util';
import { BitcoinChallengeDto, VerificationContextDto } from '../src/dtos/wallet-context.dto';
import { validate } from 'class-validator';
import vectors from './fixtures/bip322-taproot.json';

const vector = vectors.valid[0];

describe('Bitcoin wallet proof', () => {
  let nonces: NonceService;
  let signatures: BitcoinSignatureService;
  let db: { getRulesByChannel: jest.Mock; getRoleMappings: jest.Mock };
  beforeEach(() => {
    const entries = new Map();
    nonces = new NonceService({
      get: async key => entries.get(key), set: async (key, value) => { entries.set(key, value); },
      del: async key => { entries.delete(key); },
    } as any);
    db = { getRulesByChannel: jest.fn().mockResolvedValue([{ asset_type: 'ordinal' }]), getRoleMappings: jest.fn() };
    signatures = new BitcoinSignatureService(nonces, db as any);
    jest.replaceProperty(EnvironmentConfig, 'BASE_URL', 'https://verify.example.test');
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(vectors.valid)('accepts the independent BIP-322 Taproot vector for $address', test => {
    for (const signature of test.signatures) {
      const simple = signature.startsWith('smp') ? signature.slice(3) : signature;
      expect(() => signatures.verifyMessage(test.address, test.message, 'smp' + simple)).not.toThrow();
      expect(() => signatures.verifyMessage(test.address, test.message, simple)).not.toThrow();
    }
  });

  it.each(vectors.invalid)('rejects the independent vector: $description', test => {
    expect(() => signatures.verifyMessage(test.address, test.message, test.signature)).toThrow('Invalid Bitcoin signature');
  });

  it('validates checksum, network, case and Taproot address type', () => {
    expect(normalizeBitcoinAddress(vector.address.toUpperCase())).toBe(vector.address);
    const decoded = bitcoinAddress.fromBech32(vector.address);
    const testnet = bitcoinAddress.toBech32(decoded.data, decoded.version, 'tb');
    for (const bad of [testnet, '0x' + '1'.repeat(40), vector.address.slice(0, -1) + 'x', 'bC' + vector.address.slice(2), ' ' + vector.address]) {
      expect(() => normalizeBitcoinAddress(bad)).toThrow();
    }
  });

  async function proof() {
    const nonce = await nonces.createNonce('user', 'guild', 'message', 'channel');
    const challenge = await signatures.createChallenge('user', 'guild', nonce, vector.address);
    const signature = Signer.sign(vector.test_private_key, vector.address, challenge.message);
    const data = { address: vector.address, walletType: 'bitcoin' as const, userId: 'user', userTag: 'User', avatar: '',
      discordId: 'guild', discordName: 'Guild', discordIcon: '', nonce, expiry: challenge.expiry };
    return { data, signature, challenge };
  }

  it('builds the signed challenge from trusted nonce context and consumes it once', async () => {
    const { data, signature, challenge } = await proof();
    expect(data.nonce).toMatch(/^[0-9a-f]{64}$/);
    for (const value of ['https://verify.example.test', vector.address, 'Discord user: user', 'Discord server: guild', 'Discord channel: channel', data.nonce]) {
      expect(challenge.message).toContain(value);
    }
    expect((await signatures.verify(data, signature)).context.channelId).toBe('channel');
    await expect(signatures.verify(data, signature)).rejects.toThrow('Invalid or expired nonce');
  });

  it('allows only one concurrent submission to consume a Bitcoin proof', async () => {
    const { data, signature } = await proof();
    const results = await Promise.allSettled([signatures.verify(data, signature), signatures.verify(data, signature)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });

  it.each(['userId', 'discordId', 'expiry', 'address'])('rejects a proof with a changed %s', async field => {
    const { data, signature } = await proof();
    const changed = { ...data, [field]: field === 'expiry' ? data.expiry + 1 : field === 'address' ? vectors.valid[1].address : 'another' };
    await expect(signatures.verify(changed, signature)).rejects.toThrow();
    await expect(nonces.validateNonce('user', 'guild', data.nonce)).resolves.toBe(true);
  });

  it('does not consume the nonce for a bad signature', async () => {
    const { data } = await proof();
    await expect(signatures.verify(data, vector.signatures[0])).rejects.toThrow('Invalid Bitcoin signature');
    await expect(nonces.validateNonce('user', 'guild', data.nonce)).resolves.toBe(true);
  });

  it('rejects expired and replaced links and does not extend a nonce when preparing a challenge', async () => {
    const { data } = await proof();
    await nonces.createNonce('user', 'guild', 'message', 'channel');
    await expect(signatures.createChallenge('user', 'guild', data.nonce, vector.address)).rejects.toThrow('Invalid or expired nonce');
    const originalNow = Date.now();
    const current = await proof();
    jest.spyOn(Date, 'now').mockReturnValue(current.challenge.expiry * 1000 + 1);
    await expect(signatures.verify(current.data, current.signature)).rejects.toThrow('Invalid or expired nonce');
    expect(originalNow).toBeLessThan(current.challenge.expiry * 1000);
  });

  it('offers wallet families for the channel and rejects Bitcoin proof for an Ethereum-only channel', async () => {
    const nonce = await nonces.createNonce('user', 'guild', 'message', 'channel');
    db.getRulesByChannel.mockResolvedValue([{ asset_type: 'ordinal' }, { asset_type: 'nft' }]);
    expect((await signatures.getContext('user', 'guild', nonce)).walletTypes).toEqual(['evm', 'bitcoin']);
    db.getRulesByChannel.mockResolvedValue([{ asset_type: 'ethscription' }]);
    await expect(signatures.createChallenge('user', 'guild', nonce, vector.address)).rejects.toThrow('does not support Ordinals');
    expect(db.getRulesByChannel).toHaveBeenCalledWith('guild', 'channel');
  });

  it('resolves a short link to the saved Discord details and supports either wallet family', async () => {
    const display = { userTag: '🍕 User', avatar: 'https://example.test/avatar', discordName: '🍕 Comrades', discordIcon: '' };
    const nonce = await nonces.createNonce('user', 'guild', 'message', 'channel', display);
    for (const [asset_type, walletType] of [['ordinal', 'bitcoin'], ['nft', 'evm']]) {
      db.getRulesByChannel.mockResolvedValue([{ asset_type }]);
      const context = await signatures.getContext(undefined, undefined, nonce);
      expect(context.walletTypes).toEqual([walletType]);
      expect(context.data).toEqual({ ...display, address: '', userId: 'user', discordId: 'guild', nonce, expiry: context.expiry });
    }
    expect(db.getRulesByChannel).toHaveBeenCalledWith('guild', 'channel');
  });

  it('keeps legacy context requests working without saved display details', async () => {
    const nonce = await nonces.createNonce('user', 'guild', 'message', 'channel');
    const context = await signatures.getContext('user', 'guild', nonce);
    expect(context.walletTypes).toEqual(['bitcoin']);
    expect(context.data).toBeUndefined();
  });

  it('rejects invalid, replaced, consumed and expired short links before reading rules', async () => {
    await expect(signatures.getContext(undefined, undefined, 'unknown')).rejects.toThrow('Invalid or expired nonce');
    const replaced = await nonces.createNonce('user', 'guild', 'message', 'channel');
    const consumed = await nonces.createNonce('user', 'guild', 'message', 'channel');
    await expect(signatures.getContext(undefined, undefined, replaced)).rejects.toThrow('Invalid or expired nonce');
    await nonces.consumeNonce('user', 'guild', consumed);
    await expect(signatures.getContext(undefined, undefined, consumed)).rejects.toThrow('Invalid or expired nonce');
    const expired = await nonces.createNonce('user', 'guild', 'message', 'channel');
    const context = await nonces.getActiveNonce('user', 'guild', expired);
    jest.spyOn(Date, 'now').mockReturnValue(context.expiry * 1000);
    await expect(signatures.getContext(undefined, undefined, expired)).rejects.toThrow('Invalid or expired nonce');
    expect(db.getRulesByChannel).not.toHaveBeenCalled();
    expect(db.getRoleMappings).not.toHaveBeenCalled();
  });

  it.each([['other', 'guild'], ['user', 'other'], ['user', undefined], [undefined, 'guild']])(
    'rejects incorrect or incomplete IDs in a context request: %s, %s', async (userId, guildId) => {
      const nonce = await nonces.createNonce('user', 'guild', 'message', 'channel');
      await expect(signatures.getContext(userId, guildId, nonce)).rejects.toThrow('Invalid or expired nonce');
      expect(db.getRulesByChannel).not.toHaveBeenCalled();
    }
  );

  it('allows a nonce-only context DTO but keeps both Discord IDs required for Bitcoin challenges', async () => {
    expect(await validate(Object.assign(new VerificationContextDto(), { nonce: 'a'.repeat(64) }))).toHaveLength(0);
    const errors = await validate(Object.assign(new BitcoinChallengeDto(), { nonce: 'a'.repeat(64), address: vector.address }));
    expect(errors.map(error => error.property).sort()).toEqual(['discordId', 'userId']);
    expect((await validate(new VerificationContextDto())).map(error => error.property)).toContain('nonce');
  });

  it('links only the signed Bitcoin address and rechecks the previous Discord owner on transfer', async () => {
    const addresses = { addUserAddress: jest.fn().mockResolvedValue({ success: true, wasTransferred: true, previousUserId: 'previous' }) };
    const roles = { reverifyUser: jest.fn().mockResolvedValue({ verified: 0, revoked: 1 }) };
    const wallet = new WalletService(nonces, addresses as any, { getUser: jest.fn().mockResolvedValue({ username: 'User' }) } as any, roles as any, signatures);
    const { data, signature } = await proof();
    const result = await wallet.verifySignature(data, signature);
    expect(addresses.addUserAddress).toHaveBeenCalledWith('user', vector.address, 'User', 'bitcoin');
    expect(result.walletOwnershipTransferred).toBe(true);
    expect(result.nonceContext).toEqual({ messageId: 'message', channelId: 'channel' });
    expect(roles.reverifyUser).toHaveBeenCalledWith('previous');
    await expect(wallet.verifySignature(data, signature)).rejects.toThrow();
    expect(addresses.addUserAddress).toHaveBeenCalledTimes(1);
  });
});
