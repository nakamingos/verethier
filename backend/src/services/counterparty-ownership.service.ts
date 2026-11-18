import { Injectable } from '@nestjs/common';
import { NftRuleFields } from '@/models/verifier-role.interface';
import { COUNTERPARTY_ASSET, COUNTERPARTY_MAX_QUANTITY, counterpartyCriteria, CounterpartyCriteria } from '@/utils/counterparty-rule.util';
import { parseTokenBalance } from '@/utils/erc20-rule.util';
import { isBitcoinAddress, normalizeBitcoinProofAddress } from '@/utils/wallet-address.util';
import { NftCheckContext } from './nft-ownership.service';
import { StampsOwnershipService } from './stamps-ownership.service';

const UNAVAILABLE = 'Counterparty ownership is temporarily unavailable. Please try again.';

/** Raw input from the Control Room or Discord before assets are resolved. */
export interface CounterpartyRuleInput { asset?: string; assets?: string[]; issuer?: string; parent?: string }

/**
 * Counterparty asset rules on Bitcoin. Balances come from the same confirmed
 * Counterparty inventory as Bitcoin Stamps, so a check reads each wallet once.
 */
@Injectable()
export class CounterpartyOwnershipService {
  constructor(private readonly xcp: StampsOwnershipService) {}

  /** Validates the scope against Counterparty and returns the rule's stored fields. */
  async prepareRule(input: unknown, minBalance?: string): Promise<NftRuleFields> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose a Counterparty asset, asset list, issuer or parent asset.');
    const raw = input as CounterpartyRuleInput;
    await this.xcp.checkCounterpartyHealth();
    if (raw.asset !== undefined) {
      const asset = await this.resolve(raw.asset);
      if (minBalance === undefined) throw new Error('Enter a minimum balance.');
      const decimals = asset.divisible ? 8 : 0;
      const minimum = parseTokenBalance(minBalance, decimals);
      if (BigInt(minimum) > COUNTERPARTY_MAX_QUANTITY) throw new Error('That minimum is larger than any Counterparty balance can be.');
      return {
        asset_type: 'counterparty', chain_id: null, counterparty_criteria: counterpartyCriteria({ asset: asset.asset }),
        min_balance: minimum, token_decimals: decimals, token_symbol: asset.longname || asset.asset,
      };
    }
    if (minBalance !== undefined) throw new Error('Only single-asset Counterparty rules use a minimum balance; use min_items for the others.');
    let criteria: CounterpartyCriteria;
    if (raw.assets !== undefined) {
      if (!Array.isArray(raw.assets) || !raw.assets.length || raw.assets.length > 100) throw new Error('Enter 1–100 Counterparty asset names.');
      const assets: string[] = [];
      for (const name of raw.assets) {
        const asset = await this.resolve(name);
        if (asset.divisible) throw new Error(`${asset.longname || asset.asset} is divisible. Asset lists count indivisible assets; use a single-asset rule with a minimum balance instead.`);
        assets.push(asset.asset);
      }
      criteria = counterpartyCriteria({ assets });
    } else if (raw.issuer !== undefined) {
      criteria = counterpartyCriteria({ issuer: raw.issuer });
    } else {
      const parent = await this.resolve(String(raw.parent ?? ''));
      if (parent.longname) throw new Error('Choose a top-level named asset as the parent.');
      criteria = counterpartyCriteria({ parent: parent.asset });
    }
    return { asset_type: 'counterparty', chain_id: null, counterparty_criteria: criteria };
  }

  private async resolve(name: unknown) {
    const text = typeof name === 'string' ? name.trim() : '';
    // Asset names are upper case; subasset long names keep their child's case.
    const lookup = text.includes('.') ? text.replace(/^[^.]*/, parent => parent.toUpperCase()) : text.toUpperCase();
    if (!lookup || lookup.length > 270 || !(COUNTERPARTY_ASSET.test(lookup) || /^[B-Z][A-Z]{3,11}\.[A-Za-z0-9.\-_@!]{1,250}$/.test(lookup)))
      throw new Error(`${text || 'That'} isn't a valid Counterparty asset name.`);
    const asset = await this.xcp.asset(lookup);
    if (!asset) throw new Error(`Counterparty asset ${text} was not found.`);
    return asset;
  }

  async count(rule: NftRuleFields, wallets: string[], context?: NftCheckContext): Promise<bigint> {
    const run = context || { checks: new Map() };
    const criteria = counterpartyCriteria(rule.counterparty_criteria);
    if ('asset' in criteria) {
      let total = 0n;
      await this.eachWallet(wallets, run, holdings => {
        const quantity = holdings.balances.get(criteria.asset) || 0n;
        if (quantity && holdings.divisible.get(criteria.asset) !== (rule.token_decimals === 8)) throw new Error(UNAVAILABLE);
        total += quantity;
      });
      return total;
    }
    let total = 0n;
    for (const copies of (await this.matchingAssets(rule, wallets, run)).values()) total += copies;
    return total;
  }

  /** Copies of matching indivisible assets, keyed by asset like Stamps so overlapping rules count once. */
  async matchingAssets(rule: NftRuleFields, wallets: string[], context: NftCheckContext): Promise<Map<string, bigint>> {
    const criteria = counterpartyCriteria(rule.counterparty_criteria);
    if ('asset' in criteria) throw new Error('Single-asset Counterparty rules use a minimum balance.');
    const listed = 'assets' in criteria ? new Set(criteria.assets) : undefined;
    const owned = new Map<string, bigint>();
    await this.eachWallet(wallets, context, holdings => {
      for (const [asset, quantity] of holdings.balances) {
        if (holdings.divisible.get(asset) !== false) continue;
        const info = holdings.info.get(asset);
        const matches = listed ? listed.has(asset)
          : 'issuer' in criteria ? info?.issuer === criteria.issuer
          : 'parent' in criteria && !!info?.longname && info.longname.startsWith(criteria.parent + '.');
        if (matches) owned.set(asset, (owned.get(asset) || 0n) + quantity);
      }
    });
    return owned;
  }

  private async eachWallet(wallets: string[], context: NftCheckContext, visit: (holdings: Awaited<ReturnType<StampsOwnershipService['holdings']>>) => void) {
    const addresses = [...new Set(wallets.filter(isBitcoinAddress).map(normalizeBitcoinProofAddress))].sort();
    if (!addresses.length) return;
    context.counterpartyHealth ||= this.xcp.checkCounterpartyHealth();
    await context.counterpartyHealth;
    let height: number | undefined;
    const outputs = new Set<string>();
    for (const wallet of addresses) {
      const holdings = await this.xcp.holdings(wallet, context);
      // Stacked wallets must describe the same confirmed block, and an output counts once.
      if (height !== undefined && height !== holdings.height) throw new Error(UNAVAILABLE);
      height = holdings.height;
      for (const output of holdings.outputs) {
        if (outputs.has(output)) throw new Error(UNAVAILABLE);
        outputs.add(output);
      }
      visit(holdings);
    }
  }
}
