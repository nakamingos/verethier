import { InscriptionCriteria } from './inscription-criteria.interface';
import { OrdinalTraitSnapshot } from './ordinal-collection.interface';
import { TraitFilter } from '@/utils/trait-filter.util';

export type AssetCount = number | string;

export interface NftRuleFields {
  trait_filter?: TraitFilter | null;
  asset_type?: 'ethscription' | 'nft' | 'ordinal' | 'erc20';
  min_balance?: string | null;
  token_decimals?: number | null;
  token_symbol?: string | null;
  chain_id?: number | null;
  contract_address?: string | null;
  token_standard?: 'erc721' | 'erc1155' | null;
  token_ids?: string[] | null;
  collection_name?: string | null;
  attribute_key?: string | null;
  attribute_value?: string | null;
  ordinal_trait_snapshot?: OrdinalTraitSnapshot | null;
  inscription_criteria?: InscriptionCriteria | null;
  rule_label?: string | null;
}

export interface VerifierRole extends NftRuleFields {
  id: number;
  server_id: string;
  server_name: string;
  channel_id: string;
  channel_name: string;
  slug: string | null;
  role_id: string;
  role_name: string | null;
  min_items: number | null;
  // message_id removed - using channel-based verification
  // ...other fields as needed
}

export interface VerifierUserRole {
  id: string;
  user_id: string;
  server_id: string;
  role_id: string;
  rule_id: string | null;
  address: string;
  user_name: string | null;
  server_name: string | null;
  role_name: string | null;
  status: 'active' | 'expired' | 'revoked';
  verified_at: string;
  last_checked: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}
