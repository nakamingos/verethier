import { RuleInputError } from './rule-input-error';

/** Only a confirmed missing collection permits trying another spelling. */
export class OrdinalCollectionNotFoundError extends RuleInputError {
  constructor(provider: 'ord.net' | 'Xverse') {
    super(`This collection was not found on ${provider}. Check its collection slug.`);
  }
}
