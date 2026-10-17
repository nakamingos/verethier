import { NftRuleFields } from '@/models/verifier-role.interface';
import {
  normalizeCollectionSlug,
  normalizeCriteriaOption,
} from '@/utils/collection-input.util';
import { normalizeRuleLabel } from '@/utils/inscription-rule.util';
import { nftTrait } from '@/utils/nft-trait.util';
import { ordinalTrait } from '@/utils/ordinal-rule.util';
import { getNftNetworkId } from '@/utils/nft-network.util';
import { DataService } from './data.service';
import { NftOwnershipService } from './nft-ownership.service';
import { OrdinalsOwnershipService } from './ordinals-ownership.service';
import { EthscriptionsOwnershipService } from './ethscriptions-ownership.service';
import { Erc20OwnershipService } from './erc20-ownership.service';
import { validateEthscriptionCriteria } from './discord-commands/utils/rule-validation.util';

export interface RuleCreateInput {
  asset_type: string;
  slug?: string;
  attribute_key?: string;
  attribute_value?: string;
  min_items?: number;
  contract_address?: string;
  token_ids?: string;
  collection_name?: string;
  network?: string;
  inscription_ids?: string;
  inscription_numbers?: string;
  label?: string;
  min_balance?: string;
}
export interface RuleProviders {
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
      attribute_key: attributeKey,
      attribute_value: attributeValue,
    });
    assetFields = await services.ordinals.prepareRule(slug);
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
      attribute_key: attributeKey,
      attribute_value: attributeValue,
    });
    assetFields = await services.nfts.prepareRule(
      input.contract_address,
      input.token_ids ?? null,
      input.collection_name ?? null,
      getNftNetworkId(input.network || 'ethereum'),
    );
    if (
      assetFields.token_standard === 'erc721' &&
      assetFields.token_ids &&
      minItems !== 1
    )
      throw new Error('A specific ERC-721 token rule requires min_items:1.');
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
    assetFields: { asset_type: 'ethscription' } as NftRuleFields,
  };
}
