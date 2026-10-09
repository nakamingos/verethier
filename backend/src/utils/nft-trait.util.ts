import { NftRuleFields } from '@/models/verifier-role.interface';

export type NftAttributes = Array<{ trait_type: string; value: string }>;
export interface NftMetadataRow {
  chain_id: number;
  contract_address: string;
  token_id: string;
  attributes: NftAttributes;
  fetched_at: string;
}

export function nftTrait(rule: Pick<NftRuleFields, 'attribute_key' | 'attribute_value'>) {
  const key = (rule.attribute_key ?? 'ALL').trim();
  const value = (rule.attribute_value ?? 'ALL').trim();
  if (!key || !value || key.length > 100 || value.length > 100) throw new Error('NFT attribute keys and values must be 1–100 characters.');
  if (key === 'ALL' && value !== 'ALL') throw new Error('Select an attribute_key before setting attribute_value.');
  return { key, value, enabled: key !== 'ALL' };
}

export function matchesNftTrait(attributes: NftAttributes, rule: NftRuleFields): boolean {
  const { key, value } = nftTrait(rule);
  return attributes.some(attribute => attribute.trait_type.toLowerCase() === key.toLowerCase()
    && (value === 'ALL' || attribute.value.toLowerCase() === value.toLowerCase()));
}

export function nftTokenId(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value)) throw new Error('Invalid NFT token ID.');
  const id = BigInt(value);
  if (id >= 1n << 256n) throw new Error('Invalid NFT token ID.');
  return id.toString();
}

export function parseNftAttributes(value: unknown): NftAttributes {
  if (!Array.isArray(value)) throw new Error('NFT metadata does not contain a readable attributes list.');
  return value.flatMap(attribute => {
    if (!attribute || !['string', 'number', 'boolean'].includes(typeof attribute.value)
      || (typeof attribute.value === 'number' && !Number.isFinite(attribute.value))) {
      throw new Error('NFT metadata contains an unreadable attribute.');
    }
    // OpenSea permits display-only attributes without a trait_type.
    if (attribute.trait_type == null || attribute.trait_type === '') return [];
    if (typeof attribute.trait_type !== 'string' || !attribute.trait_type.trim()) throw new Error('NFT metadata contains an unreadable attribute.');
    return [{ trait_type: attribute.trait_type.trim(), value: String(attribute.value).trim() }];
  });
}

export function parseInlineNftAttributes(uri: string | null): NftAttributes | null {
  if (!uri || !/^data:application\/json(?:;|,)/i.test(uri)) return null;
  if (uri.length > 4 * 1024 * 1024) throw new Error('NFT inline metadata is too large.');
  const comma = uri.indexOf(',');
  if (comma < 0) throw new Error('NFT inline metadata is unreadable.');
  const header = uri.slice(0, comma);
  const payload = decodeURIComponent(uri.slice(comma + 1));
  let json = payload;
  if (/;base64(?:;|$)/i.test(header)) {
    const encoded = payload.replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('NFT inline metadata is unreadable.');
    json = Buffer.from(encoded, 'base64').toString('utf8');
  }
  return parseNftAttributes(JSON.parse(json)?.attributes);
}
