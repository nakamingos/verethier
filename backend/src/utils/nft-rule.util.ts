import { AssetCount, NftRuleFields } from '@/models/verifier-role.interface';
import { nftNetworkLabel } from './nft-network.util';
import { nftTrait } from './nft-trait.util';

export const NFT_BATCH_SIZE = 100;
export const NFT_MAX_IDS = 1000;
const MAX_TOKEN_ID = (BigInt(1) << BigInt(256)) - BigInt(1);

export function parseTokenIds(input?: string | null): string[] {
  const values = new Set<string>();
  for (const item of (input || '0-99').split(',')) {
    const match = item.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Token IDs must be numbers, a comma-separated list, or a range such as 0-99.');
    const start = BigInt(match[1]);
    const end = match[2] === undefined ? start : BigInt(match[2]);
    if (end < start || end > MAX_TOKEN_ID || end - start >= BigInt(NFT_MAX_IDS)) {
      throw new Error(`Use valid token IDs and at most ${NFT_MAX_IDS} IDs per rule.`);
    }
    for (let id = start; id <= end; id++) {
      values.add(id.toString());
      if (values.size > NFT_MAX_IDS) throw new Error(`Use at most ${NFT_MAX_IDS} IDs per rule.`);
    }
  }
  return [...values].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

export function serializeAssetCount(count: bigint): AssetCount {
  return count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : count.toString();
}

export function nftRuleLabel(rule: Partial<NftRuleFields>): string {
  return rule.collection_name || (rule.contract_address
    ? `${rule.contract_address.slice(0, 6)}…${rule.contract_address.slice(-4)}`
    : 'NFT collection');
}

export function nftRuleScope(rule: Partial<NftRuleFields>): string {
  const ids = rule.token_ids;
  let scope = '';
  if (ids?.length) {
    const sequential = ids.every((id, index) => BigInt(id) === BigInt(ids[0]) + BigInt(index));
    scope = sequential && ids.length > 1
      ? ` · IDs ${ids[0]}–${ids[ids.length - 1]}`
      : ` · IDs ${ids.length <= 8 ? ids.join(', ') : `${ids.slice(0, 5).join(', ')}, … (${ids.length} IDs)`}`;
  }
  const trait = nftTrait(rule);
  const attribute = trait.enabled ? ` · ${trait.key}${trait.value === 'ALL' ? ' (any value)' : `=${trait.value}`}` : '';
  return `${nftRuleLabel(rule)} · ${nftNetworkLabel(rule.chain_id)} · ${rule.token_standard === 'erc1155' ? 'ERC-1155' : 'ERC-721'}${scope}${attribute}`;
}

export function nftRuleCriteria(rule: Partial<NftRuleFields> & { min_items?: number | null }): string {
  return `${nftRuleScope(rule)} · min ${rule.min_items || 1}`;
}
