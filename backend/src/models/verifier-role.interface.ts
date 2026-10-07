export type AssetCount = number | string;

export interface NftRuleFields {
  asset_type?: 'ethscription' | 'nft';
  chain_id?: number;
  contract_address?: string | null;
  token_standard?: 'erc721' | 'erc1155' | null;
  token_ids?: string[] | null;
  collection_name?: string | null;
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
  attribute_key: string | null;
  attribute_value: string | null;
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
