import { solanaCriteria, isSolanaRule } from '@/utils/solana-rule.util';
import { SolanaOwnershipService } from './solana-ownership.service';
import { EnvironmentConfig } from '@/config/environment.config';
import { NftRuleFields } from '@/models/verifier-role.interface';
import {
  normalizeCollectionSlug,
  normalizeCriteriaOption,
} from '@/utils/collection-input.util';
import { normalizeRuleLabel } from '@/utils/inscription-rule.util';
import { nftTrait } from '@/utils/nft-trait.util';
import { ordinalTrait } from '@/utils/ordinal-rule.util';
import { normalizeTraitFilter, TraitFilter } from '@/utils/trait-filter.util';
import { getNftNetworkId } from '@/utils/nft-network.util';
import { DataService } from './data.service';
import { NftOwnershipService } from './nft-ownership.service';
import { OrdinalsOwnershipService } from './ordinals-ownership.service';
import { EthscriptionsOwnershipService } from './ethscriptions-ownership.service';
import { Erc20OwnershipService } from './erc20-ownership.service';
import { validateEthscriptionCriteria } from './discord-commands/utils/rule-validation.util';

export interface RuleCreateInput {
  solana_criteria?: import('@/utils/solana-rule.util').SolanaCriteria;
  trait_filter?: TraitFilter | null;
  asset_type: string;
  slug?: string;
  attribute_key?: string;
  attribute_value?: string;
  min_items?: number;
  contract_address?: string;
  token_ids?: string;
  expected_token_standard?: 'erc721' | 'erc1155';
  collection_name?: string;
  network?: string;
  inscription_ids?: string;
  inscription_numbers?: string;
  label?: string;
  min_balance?: string;
}
export interface RuleProviders {
  solana?: SolanaOwnershipService;
  data: DataService;
  nfts: NftOwnershipService;
  ordinals?: OrdinalsOwnershipService;
  ethscriptions?: EthscriptionsOwnershipService;
  tokens?: Erc20OwnershipService;
}

/** Shared by slash commands and the dashboard. Provider validation stays authoritative. */
export async function prepareRuleCriteria(
  input: RuleCreateInput,
  services: RuleProviders,
) {
  let slug = normalizeCollectionSlug(input.slug) || 'ALL';
  if (slug === 'all') slug = 'ALL';
  let attributeKey = normalizeCriteriaOption(input.attribute_key);
  let attributeValue = normalizeCriteriaOption(input.attribute_value);
  let filter = input.trait_filter === undefined ? undefined : normalizeTraitFilter(input.trait_filter);
  if (filter !== undefined) {
    if (attributeKey !== 'ALL' || attributeValue !== 'ALL') throw new Error('Use trait_filter or the single attribute fields, not both.');
    attributeKey = filter?.conditions[0].key || 'ALL';
    attributeValue = filter?.conditions[0].value || 'ALL';
  }
  const traits = () => filter === undefined ? {} : { trait_filter: filter };
  const minItems = input.min_items ?? 1;
  if (!Number.isSafeInteger(minItems) || minItems < 1)
    throw new Error('Minimum items must be a positive whole number.');
  const selected =
    input.inscription_ids != null || input.inscription_numbers != null;
  if (input.label != null && !selected)
    throw new Error(
      'Use label with inscription_ids or inscription_numbers. Collection rules use slug.',
    );
  const evmOptions =
    !!input.contract_address ||
    input.token_ids != null ||
    input.collection_name != null ||
    input.network != null;
  let assetFields: NftRuleFields;
  if (isSolanaRule(input)) {
    if (!EnvironmentConfig.SOLANA_ENABLED || !services.solana) throw new Error('Solana is not enabled.');
    if (evmOptions || selected || input.slug != null || input.expected_token_standard !== undefined) throw new Error('Solana rules use Solana criteria, not EVM or inscription options.');
    const criteria=solanaCriteria(input.solana_criteria);
    if (input.asset_type === 'solana_token') {
      if (criteria.kind !== 'token' || input.min_items != null || !!filter || attributeKey !== 'ALL' || attributeValue !== 'ALL') throw new Error('Solana token rules use a mint and minimum balance.');
      const prepared=await services.solana.prepareToken(criteria.mint,input.min_balance);
      if (prepared.solana_criteria.kind !== 'token' || criteria.program !== prepared.solana_criteria.program) throw new Error('Solana mint program changed.');
      return {slug:null,attributeKey:'ALL',attributeValue:'ALL',minItems:null,assetFields:{asset_type:'solana_token' as const,...prepared,chain_id:null}};
    }
    if (criteria.kind === 'token' || input.min_balance != null) throw new Error('Solana NFT rules require an NFT scope.');
    if (criteria.kind === 'master_edition' && !EnvironmentConfig.SOLANA_EDITIONS_ENABLED) throw new Error('Solana print edition verification is not enabled.');
    if (criteria.formats.includes('compressed') && !EnvironmentConfig.SOLANA_COMPRESSED_ENABLED) throw new Error('Compressed Solana NFT verification is not enabled.');
    return {slug:null,attributeKey,attributeValue,minItems,assetFields:{asset_type:'solana_nft' as const,chain_id:null,solana_criteria:criteria,...traits()}};
  }
  if (input.solana_criteria !== undefined) throw new Error('Only Solana rules use Solana criteria.');
  if (input.asset_type === 'erc20') {
    if (!services.tokens)
      throw new Error('Token verification is not configured.');
    if (
      !input.contract_address ||
      slug !== 'ALL' ||
      attributeKey !== 'ALL' ||
      attributeValue !== 'ALL' ||
      input.token_ids != null ||
      input.collection_name != null ||
      selected ||
      input.min_items != null
      || input.expected_token_standard !== undefined
      || !!filter
    ) {
      throw new Error(
        'Token rules use contract_address, min_balance, and optional network. Leave collection, NFT, and inscription options empty.',
      );
    }
    if (!input.min_balance)
      throw new Error(
        'Enter min_balance as a positive token amount, such as 1000 or 0.5.',
      );
    assetFields = await services.tokens.prepareRule(
      input.contract_address,
      input.min_balance,
      getNftNetworkId(input.network || 'ethereum'),
    );
    return {
      slug: null,
      attributeKey: 'ALL',
      attributeValue: 'ALL',
      minItems: null,
      assetFields,
    };
  }
  if (input.expected_token_standard !== undefined && input.asset_type !== 'nft')
    throw new Error('Only NFT rules use an expected token standard.');
  if (input.min_balance != null)
    throw new Error('Only token rules use min_balance.');
  if (selected) {
    if (!['ordinal', 'ethscription'].includes(input.asset_type))
      throw new Error(
        'Use /setup add-ordinals-rule or /setup add-ethscription-rule for inscription_ids or inscription_numbers.',
      );
    if (
      input.slug != null ||
      attributeKey !== 'ALL' ||
      attributeValue !== 'ALL' ||
      evmOptions
      || !!filter
    ) {
      throw new Error(
        'Specific inscription rules use IDs or numbers with min_items. Leave slug, attributes, and NFT options empty.',
      );
    }
    const provider =
      input.asset_type === 'ordinal'
        ? services.ordinals
        : services.ethscriptions;
    if (!provider)
      throw new Error('Specific inscription verification is not configured.');
    assetFields = await provider.prepareInscriptionRule(
      input.inscription_ids ?? null,
      input.inscription_numbers ?? null,
      minItems,
    );
    assetFields.rule_label = normalizeRuleLabel(input.label);
    return {
      slug: null,
      attributeKey: 'ALL',
      attributeValue: 'ALL',
      minItems,
      assetFields,
    };
  }
  if (input.asset_type === 'ordinal') {
    if (evmOptions)
      throw new Error(
        'Ordinals rules use slug, optional attributes, and min_items. Leave NFT network and contract options empty.',
      );
    if (!services.ordinals)
      throw new Error('Ordinals verification is not configured.');
    const trait = ordinalTrait({
      ...traits(),
      attribute_key: attributeKey,
      attribute_value: attributeValue,
    });
    assetFields = await services.ordinals.prepareRule(slug);
    Object.assign(assetFields, traits());
    if (trait.enabled)
      assetFields.ordinal_trait_snapshot =
        await services.ordinals.prepareTraitSnapshot({
          ...assetFields,
          slug: (assetFields as any).slug,
          attribute_key: trait.key,
          attribute_value: trait.value,
        });
    return {
      slug: (assetFields as any).slug,
      attributeKey: trait.key,
      attributeValue: trait.value,
      minItems,
      assetFields,
    };
  }
  if (input.asset_type === 'nft') {
    if (!input.contract_address || slug !== 'ALL')
      throw new Error('NFT rules require contract_address. Leave slug empty.');
    const trait = nftTrait({
      ...traits(),
      attribute_key: attributeKey,
      attribute_value: attributeValue,
    });
    assetFields = await services.nfts.prepareRule(
      input.contract_address,
      input.token_ids ?? null,
      input.collection_name ?? null,
      getNftNetworkId(input.network || 'ethereum'),
    );
    if (input.expected_token_standard !== undefined && assetFields.token_standard !== input.expected_token_standard)
      throw new Error('The NFT contract standard differs from the collection lookup. Find the collection again or use explicit contract entry.');
    Object.assign(assetFields, traits());
    await services.nfts.validateTraits({
      ...assetFields,
      attribute_key: trait.key,
      attribute_value: trait.value,
    });
    return {
      slug: null,
      attributeKey: trait.key,
      attributeValue: trait.value,
      minItems,
      assetFields,
    };
  }
  if (input.asset_type !== 'ethscription' || evmOptions)
    throw new Error(
      'Use /setup add-nft-rule for network, contract_address, token_ids, or collection_name.',
    );
  if (filter) {
    const conditions = [];
    for (const condition of filter.conditions) {
      const checked = await validateEthscriptionCriteria(services.data, slug, condition.key, condition.value);
      if (!checked.isValid) throw new Error(checked.message);
      slug = checked.criteria.slug;
      conditions.push({ key: checked.criteria.attributeKey, value: checked.criteria.attributeValue });
    }
    filter = normalizeTraitFilter({ operator: filter.operator, conditions });
    attributeKey = filter.conditions[0].key; attributeValue = filter.conditions[0].value;
  }
  const validated = await validateEthscriptionCriteria(
    services.data,
    slug,
    attributeKey,
    attributeValue,
  );
  if (!validated.isValid) throw new Error(validated.message);
  if (validated.criteria)
    ({ slug, attributeKey, attributeValue } = validated.criteria);
  return {
    slug,
    attributeKey,
    attributeValue,
    minItems,
    assetFields: { asset_type: 'ethscription', ...traits() } as NftRuleFields,
  };
}
