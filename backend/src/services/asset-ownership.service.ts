import { Injectable } from '@nestjs/common';
import { VerifierRole } from '@/models/verifier-role.interface';
import { DataService } from './data.service';
import { NftCheckContext, NftOwnershipService } from './nft-ownership.service';

@Injectable()
export class AssetOwnershipService {
  constructor(private readonly dataSvc: DataService, private readonly nftSvc: NftOwnershipService) {}

  async count(rule: VerifierRole, addresses: string[], context?: NftCheckContext): Promise<bigint> {
    if (rule.asset_type === 'nft') return this.nftSvc.count(rule, addresses, context);
    const count = await this.dataSvc.checkAssetOwnershipWithCriteria(
      [...new Set(addresses.map(address => address.toLowerCase()))],
      rule.slug || 'ALL', rule.attribute_key || 'ALL', rule.attribute_value || 'ALL', 1,
    );
    return BigInt(count);
  }
}
