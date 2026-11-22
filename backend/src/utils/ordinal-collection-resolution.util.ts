import { RuleInputError } from './rule-input-error';
import { ordinalCollectionId } from './ordinal-rule.util';
import { OrdinalCollectionNotFoundError } from './ordinal-collection-not-found.util';

/** Bounded spelling alternatives, never fuzzy changes to words or punctuation. */
export function ordinalCollectionSpellings(value: string): string[] {
  let exact: string;
  try { exact = ordinalCollectionId(value); }
  catch { throw new RuleInputError('Enter one Ordinals collection slug, such as pizza-comrades.'); }
  const words = exact.split(/[-_]+/);
  return [...new Set([exact, words.join('-'), words.join('_'), words.join('')])]
    .filter(slug => slug !== 'all' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(slug));
}

export async function resolveOrdinalCollection<T extends {id: string}>(
  value: string, lookup: (slug: string) => Promise<T>,
): Promise<T> {
  const [exact, ...alternatives] = ordinalCollectionSpellings(value);
  const probe = async (slug: string) => {
    const collection = await lookup(slug);
    if (collection.id !== slug) throw new Error('Collection lookup returned a different slug.');
    return collection;
  };
  let missing: OrdinalCollectionNotFoundError;
  try { return await probe(exact); }
  catch (error) {
    if (!(error instanceof OrdinalCollectionNotFoundError)) throw error;
    missing = error;
  }
  const matches = new Map<string, T>();
  for (const slug of alternatives) {
    try {
      const collection = await probe(slug);
      matches.set(collection.id, collection);
    } catch (error) {
      // An outage is not proof that an alternative is absent or unambiguous.
      if (!(error instanceof OrdinalCollectionNotFoundError)) throw error;
    }
  }
  if (matches.size === 1) return [...matches.values()][0];
  if (matches.size > 1) throw new RuleInputError(`Several collections match that spelling: ${[...matches.keys()].join(', ')}. Enter the exact collection slug.`);
  throw new RuleInputError(`${missing.message} Tried hyphens, underscores and no separators.`);
}
