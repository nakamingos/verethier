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
    @Optional() private readonly ethscriptionsSvc?: EthscriptionsOwnershipService) {}

  checkDetails(rule: VerifierRole, addresses: string[], context: NftCheckContext) {
    if (rule.asset_type === 'ordinal') return this.ordinalsSvc?.checkDetails(rule, addresses.filter(address => /^bc1p/i.test(address)), context);
  }

  async count(rule: VerifierRole, addresses: string[], context?: NftCheckContext): Promise<bigint> {
    if (rule.asset_type === 'ordinal') {
      if (!this.ordinalsSvc) throw new Error('Ordinals verification is not configured.');
      return this.ordinalsSvc.count(rule, addresses.filter(address => /^bc1p/i.test(address)), context);
    }
    const evmAddresses = addresses.filter(address => !/^bc1p/i.test(address));
    if (!evmAddresses.length) return BigInt(0);
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
