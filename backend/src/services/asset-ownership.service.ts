import { Erc20OwnershipService } from './erc20-ownership.service';
import { Injectable, Optional } from '@nestjs/common';
import { VerifierRole } from '@/models/verifier-role.interface';
import { DataService } from './data.service';
import { NftCheckContext, NftOwnershipService } from './nft-ownership.service';
import { OrdinalsOwnershipService } from './ordinals-ownership.service';
import { inscriptionCriteria } from '@/utils/inscription-rule.util';
import { EthscriptionsOwnershipService } from './ethscriptions-ownership.service';

@Injectable()
export class AssetOwnershipService {
  constructor(private readonly dataSvc: DataService, private readonly nftSvc: NftOwnershipService,
    @Optional() private readonly ordinalsSvc?: OrdinalsOwnershipService,
    @Optional() private readonly ethscriptionsSvc?: EthscriptionsOwnershipService,
    @Optional() private readonly tokensSvc?: Erc20OwnershipService) {}

  checkDetails(rule: VerifierRole, addresses: string[], context: NftCheckContext) {
    if (rule.asset_type === 'ordinal') return this.ordinalsSvc?.checkDetails(rule, addresses.filter(address => /^bc1p/i.test(address)), context);
  }

  async matchingAssets(rule: VerifierRole, addresses: string[], context: NftCheckContext): Promise<Map<string, bigint>> {
    if (rule.asset_type === 'ordinal') {
      if (!this.ordinalsSvc) throw new Error('Ordinals verification is not configured.');
      return this.ordinalsSvc.matchingAssets(rule, addresses.filter(address => /^bc1p/i.test(address)), context);
    }
    const evm = addresses.filter(address => !/^bc1p/i.test(address));
    if (!evm.length) return new Map();
    if (rule.asset_type === 'nft') return this.nftSvc.matchingAssets(rule, evm, context);
    const criteria = inscriptionCriteria(rule);
    if (criteria && !this.ethscriptionsSvc) throw new Error('Ethscriptions verification is not configured.');
    const ids = criteria ? await this.ethscriptionsSvc.matchingIds(evm, criteria, context)
      : await this.dataSvc.matchingAssetIdsWithCriteria(evm, rule.slug || 'ALL', rule.attribute_key || 'ALL', rule.attribute_value || 'ALL');
    return new Map(ids.map(id => [id.toLowerCase(), 1n]));
  }

  async count(rule: VerifierRole, addresses: string[], context?: NftCheckContext): Promise<bigint> {
    if (rule.asset_type === 'ordinal') {
      if (!this.ordinalsSvc) throw new Error('Ordinals verification is not configured.');
      return this.ordinalsSvc.count(rule, addresses.filter(address => /^bc1p/i.test(address)), context);
    }
    const evmAddresses = addresses.filter(address => !/^bc1p/i.test(address));
    if (!evmAddresses.length) return BigInt(0);
    if (rule.asset_type === 'erc20') {
      if (!this.tokensSvc) throw new Error('Token verification is not configured.');
      return this.tokensSvc.count(rule, evmAddresses, context);
    }
    if (rule.asset_type === 'nft') return this.nftSvc.count(rule, evmAddresses, context);
    const criteria = inscriptionCriteria(rule);
    if (criteria) {
      if (!this.ethscriptionsSvc) throw new Error('Specific Ethscription verification is not configured.');
      const wallets = [...new Set(evmAddresses.map(address => address.toLowerCase()))].sort();
      const run = context || { checks: new Map() };
      const key = JSON.stringify(['ethscription', criteria, wallets]);
      if (!run.checks.has(key)) run.checks.set(key, this.ethscriptionsSvc.countSelection(wallets, criteria, run));
      return run.checks.get(key);
    }
    const count = await this.dataSvc.checkAssetOwnershipWithCriteria(
      [...new Set(evmAddresses.map(address => address.toLowerCase()))],
      rule.slug || 'ALL', rule.attribute_key || 'ALL', rule.attribute_value || 'ALL', 1,
    );
    return BigInt(count);
  }
}

/** Assets from separate protocols/chains/contracts cannot overlap. */
export function collectibleDomain(rule: VerifierRole): string {
  if (rule.asset_type === 'nft') return `nft:${rule.chain_id}:${rule.contract_address?.toLowerCase()}`;
  return rule.asset_type || 'ethscription';
}
