import { CounterpartyOwnershipService } from '../src/services/counterparty-ownership.service';
import { StampHoldings } from '../src/services/stamps-ownership.service';
import { counterpartyCriteria, counterpartyRuleLabel, isTokenAmountRule } from '../src/utils/counterparty-rule.util';
import { collectibleDomain } from '../src/services/asset-ownership.service';
import { walletCheckNetwork, walletMatchesRule } from '../src/utils/wallet-check.util';
import { checkFamily } from '../src/utils/check-priority.util';

const walletA = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const walletB = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const issuer = '1GQhaWqejcGJ4GhQar7SjcCfadxvf5DNBD';

function holdings(rows: Array<[string, bigint, boolean, string | null, string | null]>, height = 900000, outputs: string[] = []): StampHoldings {
  return {
    balances: new Map(rows.map(([asset, quantity]) => [asset, quantity])),
    divisible: new Map(rows.map(([asset, , divisible]) => [asset, divisible])),
    info: new Map(rows.map(([asset, , , owner, longname]) => [asset, { issuer: owner, longname }])),
    height, outputs: new Set(outputs),
  };
}

describe('Counterparty rules', () => {
  let xcp: { checkCounterpartyHealth: jest.Mock; holdings: jest.Mock; asset: jest.Mock };
  let service: CounterpartyOwnershipService;
  const inventories = new Map<string, StampHoldings>();
  beforeEach(() => {
    inventories.clear();
    inventories.set(walletA, holdings([
      ['PEPECASH', 150_000_000_000n, true, issuer, null],
      ['RAREPEPE', 2n, false, issuer, null],
      ['A1000000000000000001', 1n, false, '1Other111111111111111111111114T1Anm', 'PEPE.kek'],
      ['OTHERCARD', 1n, false, '1BfLUnm55dPm94nzYSYVnBZXNMvQDUCS77', null],
    ]));
    inventories.set(walletB, holdings([
      ['PEPECASH', 50_000_000_000n, true, issuer, null],
      ['RAREPEPE', 1n, false, issuer, null],
    ]));
    xcp = {
      checkCounterpartyHealth: jest.fn().mockResolvedValue(undefined),
      holdings: jest.fn(async (wallet: string) => inventories.get(wallet)),
      asset: jest.fn(async (name: string) => ({
        PEPECASH: { asset: 'PEPECASH', longname: null, issuer, divisible: true },
        RAREPEPE: { asset: 'RAREPEPE', longname: null, issuer, divisible: false },
        PEPE: { asset: 'PEPE', longname: null, issuer, divisible: false },
        'PEPE.kek': { asset: 'A1000000000000000001', longname: 'PEPE.kek', issuer, divisible: false },
      } as any)[name] ?? null),
    };
    service = new CounterpartyOwnershipService(xcp as any);
  });

  describe('rule preparation', () => {
    it('stores a single asset with its divisibility and a raw-unit minimum', async () => {
      await expect(service.prepareRule({ asset: 'pepecash' }, '1000.5')).resolves.toEqual({
        asset_type: 'counterparty', chain_id: null, counterparty_criteria: { asset: 'PEPECASH' },
        min_balance: '100050000000', token_decimals: 8, token_symbol: 'PEPECASH',
      });
      await expect(service.prepareRule({ asset: 'RAREPEPE' }, '1')).resolves.toMatchObject({ min_balance: '1', token_decimals: 0 });
      await expect(service.prepareRule({ asset: 'RAREPEPE' }, '1.5')).rejects.toThrow('at most 0 decimal places');
      await expect(service.prepareRule({ asset: 'PEPECASH' })).rejects.toThrow('minimum balance');
      await expect(service.prepareRule({ asset: 'RAREPEPE' }, '9223372036854775808')).rejects.toThrow('larger than any');
    });

    it('resolves listed assets, including subasset long names, and rejects divisible ones', async () => {
      await expect(service.prepareRule({ assets: ['RAREPEPE', 'PEPE.kek', 'RAREPEPE'] })).resolves.toMatchObject({
        counterparty_criteria: { assets: ['A1000000000000000001', 'RAREPEPE'] },
      });
      await expect(service.prepareRule({ assets: ['PEPECASH'] })).rejects.toThrow('is divisible');
      await expect(service.prepareRule({ assets: ['NOPENOPE'] })).rejects.toThrow('was not found');
      await expect(service.prepareRule({ assets: ['bad name!'] })).rejects.toThrow("isn't a valid");
    });

    it('validates issuer and parent scopes', async () => {
      await expect(service.prepareRule({ issuer })).resolves.toMatchObject({ counterparty_criteria: { issuer } });
      await expect(service.prepareRule({ issuer: 'not-an-address' })).rejects.toThrow();
      await expect(service.prepareRule({ parent: 'pepe' })).resolves.toMatchObject({ counterparty_criteria: { parent: 'PEPE' } });
      await expect(service.prepareRule({ parent: 'PEPE.kek' })).rejects.toThrow('top-level');
      await expect(service.prepareRule({ issuer }, '5')).rejects.toThrow('min_items');
    });
  });

  describe('ownership', () => {
    const rule = (criteria: any, extra: any = {}) => ({ asset_type: 'counterparty' as const, counterparty_criteria: criteria, ...extra });

    it('sums a single asset across stacked wallets in raw units', async () => {
      expect(await service.count(rule({ asset: 'PEPECASH' }, { token_decimals: 8, min_balance: '1' }), [walletA, walletB])).toBe(200_000_000_000n);
      expect(await service.count(rule({ asset: 'RAREPEPE' }, { token_decimals: 0, min_balance: '1' }), [walletA, walletB])).toBe(3n);
      expect(xcp.holdings).toHaveBeenCalledTimes(4);
    });

    it('fails unavailable when divisibility no longer matches the rule', async () => {
      await expect(service.count(rule({ asset: 'PEPECASH' }, { token_decimals: 0, min_balance: '1' }), [walletA])).rejects.toThrow('temporarily unavailable');
    });

    it('counts indivisible copies for lists, issuers and parents', async () => {
      expect([...(await service.matchingAssets(rule({ assets: ['RAREPEPE', 'OTHERCARD'] }), [walletA, walletB], { checks: new Map() }))])
        .toEqual([['RAREPEPE', 3n], ['OTHERCARD', 1n]]);
      // Divisible PEPECASH shares the issuer but is not a collectible copy.
      expect(await service.count(rule({ issuer }), [walletA, walletB])).toBe(3n);
      expect([...(await service.matchingAssets(rule({ parent: 'PEPE' }), [walletA], { checks: new Map() }))]).toEqual([['A1000000000000000001', 1n]]);
      expect(await service.count(rule({ parent: 'PEPES' }), [walletA])).toBe(0n);
    });

    it('rejects inventories from different blocks or a repeated output', async () => {
      inventories.set(walletB, holdings([], 900001));
      await expect(service.count(rule({ issuer }), [walletA, walletB])).rejects.toThrow('temporarily unavailable');
      inventories.set(walletA, holdings([], 900000, ['a'.repeat(64) + ':0']));
      inventories.set(walletB, holdings([], 900000, ['a'.repeat(64) + ':0']));
      await expect(service.count(rule({ issuer }), [walletA, walletB])).rejects.toThrow('temporarily unavailable');
    });

    it('ignores non-Bitcoin wallets and skips the provider when none remain', async () => {
      expect(await service.count(rule({ issuer }), ['0x' + '1'.repeat(40)])).toBe(0n);
      expect(xcp.checkCounterpartyHealth).not.toHaveBeenCalled();
    });
  });

  it('parses criteria strictly and labels each scope', () => {
    expect(() => counterpartyCriteria({ asset: 'PEPECASH', parent: 'PEPE' })).toThrow('one Counterparty scope');
    expect(() => counterpartyCriteria({ asset: 'AAAA' })).toThrow();
    expect(() => counterpartyCriteria({ assets: [] })).toThrow();
    expect(counterpartyCriteria({ assets: ['RAREPEPE', 'BBBB', 'RAREPEPE'] })).toEqual({ assets: ['BBBB', 'RAREPEPE'] });
    expect(counterpartyRuleLabel({ counterparty_criteria: { asset: 'PEPECASH' }, token_symbol: 'PEPECASH' })).toBe('Counterparty: PEPECASH');
    expect(counterpartyRuleLabel({ counterparty_criteria: { assets: ['B', 'C', 'D', 'E'].map(x => x.repeat(4)) } })).toBe('Counterparty: 4 assets');
    expect(counterpartyRuleLabel({ counterparty_criteria: { parent: 'PEPE' } })).toBe('Counterparty: PEPE.* subassets');
  });

  it('treats single-asset rules as token amounts and the others as collectibles sharing the Stamps domain', () => {
    expect(isTokenAmountRule({ asset_type: 'counterparty', counterparty_criteria: { asset: 'PEPECASH' } })).toBe(true);
    expect(isTokenAmountRule({ asset_type: 'counterparty', counterparty_criteria: { issuer } })).toBe(false);
    expect(collectibleDomain({ asset_type: 'counterparty' } as any)).toBe(collectibleDomain({ asset_type: 'stamp' } as any));
    expect(walletCheckNetwork({ asset_type: 'counterparty' })).toBe('bitcoin');
    expect(walletMatchesRule({ asset_type: 'counterparty' }, walletB)).toBe(true);
    expect(checkFamily({ asset_type: 'counterparty' })).toBe('stamps');
  });
});
