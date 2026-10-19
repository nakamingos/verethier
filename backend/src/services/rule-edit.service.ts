import { normalizeCollectionSlug, normalizeCriteriaOption } from '@/utils/collection-input.util';
import { Injectable } from '@nestjs/common';
import { VerifierRole } from '@/models/verifier-role.interface';
import { inscriptionCriteria, normalizeRuleLabel, parseInscriptionCriteria } from '@/utils/inscription-rule.util';
import { nftTrait } from '@/utils/nft-trait.util';
import { ordinalCollectionId, ordinalTrait, ordinalTraitHash, usableOrdinalTraitSnapshot } from '@/utils/ordinal-rule.util';
import { parseTokenBalance } from '@/utils/erc20-rule.util';
import { ruleEditFields, ruleCriteriaKey } from '@/utils/rule-edit.util';
import { normalizeTraitFilter, ruleTraits } from '@/utils/trait-filter.util';
import { DataService } from './data.service';
import { NftOwnershipService } from './nft-ownership.service';
import { OrdinalsOwnershipService } from './ordinals-ownership.service';
import { EthscriptionsOwnershipService } from './ethscriptions-ownership.service';
import { validateEthscriptionCriteria } from './discord-commands/utils/rule-validation.util';

@Injectable()
export class RuleEditService {
  constructor(private readonly data: DataService, private readonly nfts: NftOwnershipService,
    private readonly ordinals: OrdinalsOwnershipService, private readonly ethscriptions: EthscriptionsOwnershipService) { }

  async prepare(before: VerifierRole, inputs: Record<string, string>): Promise<VerifierRole> {
    const allowed = new Set(ruleEditFields(before).map(field => field.key));
    if (!before.inscription_criteria && before.asset_type !== 'erc20') allowed.add('trait_filter');
    if (Object.keys(inputs).some(key => !allowed.has(key))) throw new Error('This field cannot be edited for this rule.');
    const candidate = { ...before };
    if (before.asset_type === 'erc20') {
      candidate.min_balance = parseTokenBalance(inputs.min_balance, before.token_decimals);
      return candidate;
    }
    const minimum = inputs.min_items?.trim();
    if (!/^\d+$/.test(minimum || '') || !Number.isSafeInteger(Number(minimum)) || Number(minimum) < 1) {
      throw new Error('Minimum items must be a positive whole number.');
    }
    candidate.min_items = Number(minimum);
    const criteria = inscriptionCriteria(before);
    if (criteria) {
      const selection = inputs.selection?.trim();
      candidate.rule_label = normalizeRuleLabel(inputs.label ?? before.rule_label);
      const parsed = parseInscriptionCriteria(criteria.kind === 'ids' ? selection : null, criteria.kind === 'numbers' ? selection : null, before.asset_type === 'ordinal' ? 'ordinal' : 'ethscription');
      if (candidate.min_items === before.min_items && JSON.stringify(parsed) === JSON.stringify(criteria)) return candidate;
      const prepared = before.asset_type === 'ordinal'
        ? await this.ordinals.prepareInscriptionRule(criteria.kind === 'ids' ? selection : null, criteria.kind === 'numbers' ? selection : null, candidate.min_items)
        : await this.ethscriptions.prepareInscriptionRule(criteria.kind === 'ids' ? selection : null, criteria.kind === 'numbers' ? selection : null, candidate.min_items);
      candidate.inscription_criteria = prepared.inscription_criteria;
      return candidate;
    }
    candidate.attribute_key = normalizeCriteriaOption(inputs.attribute_key);
    candidate.attribute_value = normalizeCriteriaOption(inputs.attribute_value);
    if (inputs.trait_filter !== undefined) {
      if (inputs.attribute_key !== undefined || inputs.attribute_value !== undefined) throw new Error('Use the trait editor or single attribute fields, not both.');
      try { candidate.trait_filter = normalizeTraitFilter(JSON.parse(inputs.trait_filter)); }
      catch (error) { throw new Error(`Invalid trait conditions: ${error.message}`); }
      candidate.attribute_key = candidate.trait_filter?.conditions[0].key || 'ALL';
      candidate.attribute_value = candidate.trait_filter?.conditions[0].value || 'ALL';
    } else {
      if ((ruleTraits(before)?.conditions.length || 0) > 1) throw new Error('Edit multi-trait conditions in the Control Room; single fields cannot replace them.');
      if (before.trait_filter !== undefined) candidate.trait_filter = ruleTraits({ attribute_key: candidate.attribute_key, attribute_value: candidate.attribute_value });
    }
    if (before.asset_type === 'nft') {
      const trait = nftTrait(candidate);
      const prepared = await this.nfts.prepareRule(before.contract_address, inputs.token_ids?.trim() || null, before.collection_name, before.chain_id);
      if (prepared.token_standard !== before.token_standard) throw new Error('The NFT contract standard changed. Recreate this rule after checking the contract.');
      if (prepared.token_standard === 'erc721' && prepared.token_ids && candidate.min_items !== 1) throw new Error('A specific ERC-721 token rule requires min_items:1.');
      candidate.token_ids = prepared.token_ids;
      candidate.attribute_key = trait.key; candidate.attribute_value = trait.value;
      await this.nfts.validateTraits(candidate);
      return candidate;
    }
    candidate.slug = normalizeCollectionSlug(inputs.slug) || 'ALL';
    if (before.asset_type === 'ordinal') {
      const trait = ordinalTrait(candidate);
      candidate.slug = ordinalCollectionId(candidate.slug);
      if (candidate.slug !== before.slug) {
        const prepared = await this.ordinals.prepareRule(candidate.slug);
        candidate.slug = prepared.slug; candidate.collection_name = prepared.collection_name;
      }
      candidate.attribute_key = trait.key; candidate.attribute_value = trait.value;
      if (!trait.enabled) candidate.ordinal_trait_snapshot = null;
      else if (ordinalTraitHash(before) !== ordinalTraitHash(candidate) || !usableOrdinalTraitSnapshot(before)) {
        candidate.ordinal_trait_snapshot = await this.ordinals.prepareTraitSnapshot({ ...candidate, slug: candidate.slug });
      }
      return candidate;
    }
    const filter = ruleTraits(candidate);
    if (candidate.trait_filter !== undefined && filter) {
      const conditions = [];
      for (const condition of filter.conditions) {
        const checked = await validateEthscriptionCriteria(this.data, candidate.slug, condition.key, condition.value);
        if (!checked.isValid) throw new Error(checked.message);
        candidate.slug = checked.criteria.slug;
        conditions.push({ key: checked.criteria.attributeKey, value: checked.criteria.attributeValue });
      }
      candidate.trait_filter = normalizeTraitFilter({ operator: filter.operator, conditions });
    }
    const validated = await validateEthscriptionCriteria(this.data, candidate.slug, candidate.attribute_key, candidate.attribute_value);
    if (!validated.isValid) throw new Error(validated.message);
    if (validated.criteria) {
      candidate.slug = validated.criteria.slug;
      candidate.attribute_key = validated.criteria.attributeKey;
      candidate.attribute_value = validated.criteria.attributeValue;
    }
    return candidate;
  }

  duplicates(candidate: VerifierRole, rules: VerifierRole[]): { exact?: VerifierRole; shared: VerifierRole[] } {
    const others = rules.filter(rule => rule.id !== candidate.id);
    return {
      exact: others.find(rule => ruleCriteriaKey(rule) === ruleCriteriaKey(candidate)),
      shared: others.filter(rule => rule.role_id !== candidate.role_id && ruleCriteriaKey(rule, false) === ruleCriteriaKey(candidate, false))
    };
  }
}
