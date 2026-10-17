import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { CacheService } from '../src/services/cache.service';
import { NonceService } from '../src/services/nonce.service';

describe('verification links and autocomplete cache isolation', () => {
  let module: TestingModule;
  let nonces: NonceService;
  let autocomplete: CacheService;

  beforeEach(async () => {
    // Exercise the actual application wiring with real cache-manager stores.
    // Compilation alone does not start Discord, cron, or external API calls.
    module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    nonces = module.get(NonceService);
    autocomplete = module.get(CacheService);
  });
  afterEach(async () => { jest.restoreAllMocks(); await module.close(); });

  async function warmAutocomplete() {
    for (let index = 0; index < 250; index++) {
      await autocomplete.set(`attributes:keys:collection-${index}`, ['Crown'], 86400);
    }
    // Exercise real eviction in the general cache, not just unused entries.
    expect(await autocomplete.get('attributes:keys:collection-0')).toBeNull();
    expect(await autocomplete.get('attributes:keys:collection-249')).toEqual(['Crown']);
  }

  it('keeps a fresh verification link active while autocomplete fills and evicts its own entries', async () => {
    const nonce = await nonces.createNonce('member', 'server', 'message', 'channel', {
      userTag: 'Member', discordName: 'Server', avatar: '', discordIcon: '',
    });
    const original = await nonces.getActiveNonceByToken(nonce);
    await warmAutocomplete();
    expect(Date.now()).toBeLessThan(original.expiry * 1000);
    expect(await nonces.getActiveNonceByToken(nonce)).toEqual(original);
    expect(await nonces.validateNonce('member', 'server', nonce)).toBe(true);
  });

  it('still rejects replaced, consumed, mismatched, and genuinely expired links', async () => {
    const replaced = await nonces.createNonce('member', 'server', 'message', 'channel');
    const active = await nonces.createNonce('member', 'server', 'message', 'channel');
    const expiring = await nonces.createNonce('member', 'server', 'message', 'other-channel');
    const original = await nonces.getActiveNonceByToken(expiring);
    await warmAutocomplete();
    expect(await nonces.validateNonce('member', 'server', replaced)).toBe(false);
    expect(await nonces.validateNonce('different-member', 'server', active)).toBe(false);
    expect(await nonces.validateNonce('member', 'different-server', active)).toBe(false);
    await nonces.consumeNonce('member', 'server', active);
    await expect(nonces.consumeNonce('member', 'server', active)).rejects.toThrow('Invalid or expired nonce');
    jest.spyOn(Date, 'now').mockReturnValue(original.expiry * 1000);
    expect(await nonces.validateNonce('member', 'server', expiring)).toBe(false);
  });

  it('retains Bitcoin signing challenges and their original expiry during cache pressure', async () => {
    const nonce = await nonces.createNonce('member', 'server', 'message', 'channel');
    const original = await nonces.getActiveNonceByToken(nonce);
    const challenge = { address: 'bc1p-test', message: 'Exact signing challenge' };
    await nonces.saveBitcoinChallenge('member', 'server', nonce, challenge);
    await warmAutocomplete();
    const saved = await nonces.consumeNonce('member', 'server', nonce);
    expect(saved.bitcoinChallenge).toEqual(challenge);
    expect(saved.expiry).toBe(original.expiry);
    expect(await nonces.validateNonce('member', 'server', nonce)).toBe(false);
  });
});
