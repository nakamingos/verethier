import { normalizeCollectionSlug, normalizeCriteriaOption } from '../src/utils/collection-input.util';
import { ordinalCollectionId } from '../src/utils/ordinal-rule.util';
import { validateEthscriptionCriteria } from '../src/services/discord-commands/utils/rule-validation.util';

describe('collection and trait input normalization', () => {
  it.each(['Pizza Comrades', ' PIZZA-COMRADES ', ' pizza   comrades ', 'pizza\tcomrades'])('normalizes %j to the same validated Ordinals slug', input => {
    expect(normalizeCollectionSlug(input)).toBe('pizza-comrades');
    expect(ordinalCollectionId(input)).toBe('pizza-comrades');
  });
  it.each(['one,two', 'https://example.org/collection', 'pizza/comrades', 'ALL'])('does not invent a valid Ordinals collection from %j', input => {
    expect(() => ordinalCollectionId(input)).toThrow('one Ordinals collection slug');
  });
  it('preserves trait capitalization, punctuation, and internal spaces while recognizing the ALL option', () => {
    expect(normalizeCriteriaOption(' Cosmic  Oven-Lord ')).toBe('Cosmic  Oven-Lord');
    expect(normalizeCriteriaOption(' all ')).toBe('ALL');
  });
  it('resolves manually typed Ethscriptions collection and traits to their stored spelling', async () => {
    const data = {
      getAllSlugs: jest.fn().mockResolvedValue(['Pizza-Comrades']),
      getAttributeKeys: jest.fn().mockResolvedValue(['EyeColor']),
      getAllAttributeValues: jest.fn().mockResolvedValue(['Gold Crown']),
    };
    const result = await validateEthscriptionCriteria(data as any, ' PIZZA   COMRADES ', ' eyecolor ', ' gold crown ');
    expect(result).toEqual({ isValid: true, message: '', criteria: {slug: 'Pizza-Comrades', attributeKey: 'EyeColor', attributeValue: 'Gold Crown'} });
    expect(data.getAttributeKeys).toHaveBeenCalledWith('Pizza-Comrades');
    expect(data.getAllAttributeValues).toHaveBeenCalledWith('EyeColor', 'Pizza-Comrades');
  });
  it('still rejects nonexistent normalized slugs and does not turn trait spaces into hyphens', async () => {
    const data = { getAllSlugs: async () => ['pizza-comrades'], getAttributeKeys: async () => ['Category'], getAllAttributeValues: async () => ['Gold Crown'] };
    expect((await validateEthscriptionCriteria(data as any, 'Fake Collection', 'ALL', 'ALL')).isValid).toBe(false);
    expect((await validateEthscriptionCriteria(data as any, 'pizza comrades', 'category', 'gold-crown')).isValid).toBe(false);
  });
});
