import { Injectable, Optional } from '@nestjs/common';
import { VerifierRole } from '@/models/verifier-role.interface';
import { DataService } from './data.service';
import { NftCheckContext, NftOwnershipService } from './nft-ownership.service';
import { OrdinalsOwnershipService } from './ordinals-ownership.service';

@Injectable()
export class AssetOwnershipService {
  constructor(private readonly dataSvc: DataService, private readonly nftSvc: NftOwnershipService,
    @Optional() private readonly ordinalsSvc?: OrdinalsOwnershipService) {}

  async count(rule: VerifierRole, addresses: string[], context?: NftCheckContext): Promise<bigint> {
    if (rule.asset_type === 'ordinal') {
      if (!this.ordinalsSvc) throw new Error('Ordinals verification is not configured.');
      return this.ordinalsSvc.count(rule, addresses.filter(address => /^bc1p/i.test(address)), context);
    }
    const evmAddresses = addresses.filter(address => !/^bc1p/i.test(address));
    if (!evmAddresses.length) return BigInt(0);
    if (rule.asset_type === 'nft') return this.nftSvc.count(rule, evmAddresses, context);
    const count = await this.dataSvc.checkAssetOwnershipWithCriteria(
      [...new Set(evmAddresses.map(address => address.toLowerCase()))],
      rule.slug || 'ALL', rule.attribute_key || 'ALL', rule.attribute_value || 'ALL', 1,
    );
    return BigInt(count);
  }
}
