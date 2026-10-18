import { Injectable, Logger } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { EnvironmentConfig } from '@/config/environment.config';
import { AppLogger } from '@/utils/app-logger.util';
import { CONSTANTS } from '@/constants';
import type { NftCheckContext } from './nft-ownership.service';
import type { EthscriptionAsset } from '@/models/ethscription-ownership.interface';

// Validate environment on service load
EnvironmentConfig.validate();

const supabase = createClient(
  EnvironmentConfig.DATA_SUPABASE_URL!, 
  EnvironmentConfig.DATA_SUPABASE_ANON_KEY!
);

/**
 * DataService
 * 
 * Handles all data operations related to asset ownership verification.
 * Connects to the data Supabase instance to query ethscriptions and metadata.
 * 
 * Key responsibilities:
 * - Check asset ownership for verification
 * - Query assets with specific attributes and criteria
 * - Support slug-based and attribute-based filtering
 * - Handle marketplace escrow scenarios
 */
@Injectable()
export class DataService {
  private readonly logger = new Logger(DataService.name);

  async checkSetupHealth(traits: boolean): Promise<void> {
    const result = await supabase.from('ethscriptions').select('hashId').limit(1).abortSignal(AbortSignal.timeout(6000));
    if (result.error) throw new Error('Ethscriptions data unavailable.');
    if (traits) {
      const attributes = await supabase.from('attributes_new').select('sha').limit(1).abortSignal(AbortSignal.timeout(6000));
      if (attributes.error) throw new Error('Ethscriptions traits unavailable.');
    }
  }

  private hasAttributeCriteria(attributeKey?: string, attributeValue?: string): boolean {
    return (
      (!!attributeKey && attributeKey !== 'ALL') ||
      (!!attributeValue && attributeValue !== 'ALL')
    );
  }
  
  /**
   * Checks basic asset ownership for an address.
   * Includes assets in marketplace escrow (owned by market but previously owned by address).
   * 
   * @param address - The wallet address to check ownership for
   * @returns Promise<number> - Count of assets owned by the address
   */
  async checkAssetOwnership(address: string): Promise<any> {
    address = address.toLowerCase();
    const marketAddress = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a'.toLowerCase();

    let query = supabase
      .from('ethscriptions')
      .select('hashId, owner, prevOwner')
      .or(`owner.eq.${address},and(owner.eq.${marketAddress},prevOwner.eq.${address})`);

    const { data, error } = await query;
      
    if (error) {
      throw new Error(error.message);
    }
    return data.length;
  }

  /**
   * Gets unique slugs of assets owned by an address.
   * 
   * @param address - The wallet address to check
   * @returns Promise<string[]> - Array of unique slug names owned
   */
  async getOwnedSlugs(address: string): Promise<string[]> {
    const { data, error } = await supabase
      .from('ethscriptions')
      .select('slug')
      .eq('owner', address.toLowerCase());
    if (error) throw new Error(error.message);
    return Array.from(new Set((data || []).map(r => r.slug)));
  }

  /**
   * Gets detailed asset information including metadata attributes.
   * Combines ethscriptions data with metadata for comprehensive asset details.
   * 
   * @param address - The wallet address to get assets for
   * @returns Promise<AssetWithAttrs[]> - Array of assets with their attributes
   */
  async getDetailedAssets(address: string): Promise<AssetWithAttrs[]> {
    // Step 1: Get ethscriptions owned by the address
    const { data: ethscriptions, error } = await supabase
      .from('ethscriptions')
      .select('hashId, slug, sha')
      .eq('owner', address.toLowerCase());

    if (error) {
      throw new Error(`Failed to fetch ethscriptions: ${error.message}`);
    }

    if (!ethscriptions || ethscriptions.length === 0) {
      return [];
    }

    // Step 2: Get attributes for these ethscriptions using their sha values (optimized)
    const ethscriptionShas: string[] = [];
    ethscriptions.forEach(e => {
      if (e.sha) ethscriptionShas.push(e.sha);
    });
    const { data: attributes, error: attrError } = await supabase
      .from('attributes_new')
      .select('sha, values')
      .in('sha', ethscriptionShas);

    if (attrError) {
      throw new Error(`Failed to fetch attributes: ${attrError.message}`);
    }

    // Step 3: Combine the data
    return ethscriptions.map(ethscription => {
      const attr = attributes?.find(a => a.sha === ethscription.sha);
      return {
        slug: ethscription.slug,
        attributes: (attr?.values as Record<string, string | number>) || {},
      };
    });
  }

  async getAllSlugs(): Promise<string[]> {
    const { data, error } = await supabase
      .from('collections')
      .select('slug');
    if (error) throw new Error(error.message);
    
    // More efficient unique slug extraction
    const uniqueSlugs: string[] = [];
    const seenSlugs = new Set<string>();
    
    data?.forEach(r => {
      if (r.slug && !seenSlugs.has(r.slug)) {
        seenSlugs.add(r.slug);
        uniqueSlugs.push(r.slug);
      }
    });
    
    return ['all-collections', ...uniqueSlugs];
  }

  async getCollectionNames(
    slugs: string[]
  ): Promise<Record<string, { name?: string; singleName?: string }>> {
    const uniqueSlugs = Array.from(new Set(
      slugs
        .map(slug => slug?.trim())
        .filter((slug): slug is string => !!slug && slug !== 'ALL' && slug !== 'all-collections')
    ));

    if (uniqueSlugs.length === 0) {
      return {};
    }

    const { data, error } = await supabase
      .from('collections')
      .select('slug, name, singleName')
      .in('slug', uniqueSlugs);

    if (error) throw new Error(error.message);

    const collectionNames: Record<string, { name?: string; singleName?: string }> = {};
    data?.forEach(record => {
      if (!record.slug) return;

      collectionNames[record.slug] = {
        name: typeof record.name === 'string' && record.name.trim().length > 0
          ? record.name.trim()
          : undefined,
        singleName: typeof record.singleName === 'string' && record.singleName.trim().length > 0
          ? record.singleName.trim()
          : undefined,
      };
    });

    return collectionNames;
  }

  /**
   * Get all unique attribute keys for a specific collection slug
   * @param slug - Collection slug to filter by (optional)
   * @returns Array of unique attribute keys
   */
  async getAttributeKeys(slug?: string): Promise<string[]> {
    try {
      // If no slug specified or it's 'ALL', get a small sample of attributes
      if (!slug || slug === 'ALL' || slug === 'all-collections') {
        const { data, error } = await supabase
          .from('attributes_new')
          .select('values')
          .limit(CONSTANTS.LIMITS.ATTRIBUTE_SAMPLE_SIZE);
        
        if (error) throw new Error(error.message);
        
        const allKeys = new Set<string>();
        (data || []).forEach(item => {
          if (item.values && typeof item.values === 'object') {
            Object.keys(item.values).forEach(key => allKeys.add(key));
          }
        });
        
        return Array.from(allKeys).sort().slice(0, CONSTANTS.LIMITS.AUTOCOMPLETE_RESULTS);
      }

      // For specific slug, get first 200 items (sufficient for ~12 attribute keys)
      const { data, error } = await supabase
        .from('attributes_new')
        .select('values')
        .eq('slug', slug)
        .limit(CONSTANTS.LIMITS.ATTRIBUTE_PAGINATION);

      if (error) {
        throw new Error(error.message);
      }

      const allKeys = new Set<string>();
      (data || []).forEach(item => {
        if (item.values && typeof item.values === 'object') {
          Object.keys(item.values).forEach(key => {
            if (key && key.trim() !== '') {
              allKeys.add(key);
            }
          });
        }
      });

      const finalKeys = Array.from(allKeys).sort();
      return Array.from(allKeys).sort().slice(0, CONSTANTS.LIMITS.AUTOCOMPLETE_RESULTS); // Discord limit
    } catch (error) {
      this.logger.error('Error getting attribute keys:', error);
      return ['ALL'];
    }
  }

  /**
   * Get all unique attribute values for a specific attribute key and collection slug
   * Returns the rarest values first (lowest frequency) to prioritize rare traits
   * @param attributeKey - Attribute key to get values for
   * @param slug - Collection slug to filter by (optional)
   * @returns Array of unique attribute values sorted by rarity (rarest first)
   */
  async getAttributeValues(attributeKey: string, slug?: string): Promise<string[]> {
    try {
      if (!attributeKey || attributeKey === 'ALL') {
        return [];
      }

      let data;
      
      // If no slug specified or it's 'ALL', get a small sample
      if (!slug || slug === 'ALL' || slug === 'all-collections') {
        const { data: attributeData, error } = await supabase
          .from('attributes_new')
          .select('values')
          .limit(50); // Limit to prevent large responses
        
        if (error) throw new Error(error.message);
        data = attributeData;
      } else {
        // For specific slug, use pagination to get ALL records to ensure accurate counts
        // This is important for correct rarity calculations and occurrence counts
        const allData = [];
        let page = 0;
        const pageSize = 2000; // Balanced page size for performance
        const maxPages = 5; // Allow up to 10k records to capture full collections

        AppLogger.debug(`📊 [DataService] Starting full pagination for slug: "${slug}"`, 'DataService');

        while (page < maxPages) {
          const offset = page * pageSize;
          
          AppLogger.debug(`📄 [DataService] Fetching page ${page + 1}, offset: ${offset}`, 'DataService');
          
          const { data: pageData, error } = await supabase
            .from('attributes_new')
            .select('values')
            .eq('slug', slug)
            .range(offset, offset + pageSize - 1);

          if (error) {
            AppLogger.error(`❌ [DataService] Error on page ${page + 1}:`, error.message, 'DataService');
            throw new Error(error.message);
          }

          AppLogger.debug(`📄 [DataService] Page ${page + 1} returned ${pageData?.length || 0} records`, 'DataService');

          if (!pageData || pageData.length === 0) {
            AppLogger.debug(`📄 [DataService] No more data, stopping at page ${page + 1}`, 'DataService');
            break;
          }

          allData.push(...pageData);

          // If we got less than pageSize records, we've reached the end
          if (pageData.length < pageSize) {
            AppLogger.debug(`📄 [DataService] Reached end of data (got ${pageData.length} < ${pageSize})`, 'DataService');
            break;
          }

          page++;
        }

        AppLogger.debug(`📊 [DataService] Pagination complete: ${page + 1} pages, ${allData.length} total records`, 'DataService');
        data = allData;
      }

      // Track frequency of each attribute value
      const valueFrequency = new Map<string, number>();
      
      (data || []).forEach(item => {
        const attributes = item.values;
        if (!attributes || typeof attributes !== 'object') return;
        const key = Object.keys(attributes).find(key => key.toLowerCase() === attributeKey.toLowerCase());
        const value = key === undefined ? null : attributes[key];
        if (value !== null && value !== undefined) {
          const text = value.toString();
          valueFrequency.set(text, (valueFrequency.get(text) || 0) + 1);
        }
      });

      // Convert to array and sort by frequency (ascending = rarest first)
      // Return both value and frequency for display purposes
      const sortedByRarity = Array.from(valueFrequency.entries())
        .sort((a, b) => a[1] - b[1]) // Sort by frequency (ascending)
        .slice(0, 25); // Take top 25 rarest

      // Take the top 25 rarest values (no need to reserve slot for 'ALL')
      if (sortedByRarity.length > 0) {
        return sortedByRarity.map(([value, count]) => `${value} (${count}×)`);
      } else {
        return [];
      }
    } catch (error) {
      this.logger.error('Error getting attribute values:', error);
      return [];
    }
  }

  /**
   * Get attribute values for autocomplete without occurrence counts
   * This method returns clean values for Discord autocomplete to avoid display issues
   * 
   * @param attributeKey - The attribute key to search for
   * @param slug - Collection slug to filter by (optional)
   * @returns Array of clean attribute values sorted by rarity (rarest first)
   */
  async getAttributeValuesForAutocomplete(attributeKey: string, slug?: string): Promise<string[]> {
    try {
      if (!attributeKey || attributeKey === 'ALL') {
        return [];
      }

      // Get the full values with counts
      const valuesWithCounts = await this.getAttributeValues(attributeKey, slug);
      
      // Extract clean values without occurrence counts
      const cleanValues = valuesWithCounts.map(value => {
        const match = value.match(/^(.+?)\s*\((\d+)×\)$/);
        if (match) {
          return match[1].trim(); // Return just the clean value
        }
        return value; // Fallback for values without count format
      });

      return cleanValues;
    } catch (error) {
      this.logger.error('Error getting attribute values for autocomplete:', error);
      return [];
    }
  }

  /**
   * Get ALL attribute values for a collection + attribute (not limited to rarest 25)
   * Used for autocomplete filtering to allow manual entry of any valid value
   * 
   * @param attributeKey - The attribute key to search for
   * @param slug - Collection slug to filter by
   * @returns Array of ALL unique attribute values (no rarity filtering)
   */
  async getAllAttributeValues(attributeKey: string, slug: string): Promise<string[]> {
    try {
      AppLogger.debug(`Getting ALL attribute values for ${slug}:${attributeKey}`);
      
      if (!attributeKey || attributeKey === 'ALL') {
        return [];
      }

      // Use the same table and pagination logic as getAttributeValues but without rarity filtering
      const allData = [];
      let page = 0;
      const pageSize = 2000;
      const maxPages = 5;

      while (page < maxPages) {
        const offset = page * pageSize;
        
        let query = supabase
          .from('attributes_new')
          .select('values');

        // Handle specific slug vs all collections
        if (slug && slug !== 'ALL' && slug !== 'all-collections') {
          query = query.eq('slug', slug);
        }
        // For 'ALL' case, don't add slug filter to get data from all collections

        const { data: pageData, error } = await query.range(offset, offset + pageSize - 1);

        if (error) {
          AppLogger.error(`Error fetching ALL attribute values for ${slug}:${attributeKey}:`, error.message);
          return [];
        }

        if (!pageData || pageData.length === 0) {
          break;
        }

        allData.push(...pageData);

        if (pageData.length < pageSize) {
          break;
        }

        page++;
      }

      // Extract all unique values without frequency counting
      const allUniqueValues = new Set<string>();
      
      allData.forEach(item => {
        const attributes = item.values;
        if (!attributes || typeof attributes !== 'object') return;
        const key = Object.keys(attributes).find(key => key.toLowerCase() === attributeKey.toLowerCase());
        const value = key === undefined ? null : attributes[key];
        if (value !== null && value !== undefined) {
          const text = value.toString().trim();
          if (text) allUniqueValues.add(text);
        }
      });

      // Convert to sorted array
      const result = Array.from(allUniqueValues).sort();
      
      AppLogger.debug(`Found ${result.length} total unique values for ${slug}:${attributeKey}`);
      return result;

    } catch (error) {
      AppLogger.error(`Failed to get ALL attribute values for ${slug}:${attributeKey}:`, error);
      return [];
    }
  }

  /**
   * Check asset ownership with specific criteria (slug, attributes, minimum count)
   * 
   * @param address - Wallet address to check
   * @param slug - Collection slug to filter by (optional) 
   * @param attributeKey - Attribute key to filter by (optional)
   * @param attributeValue - Attribute value to filter by (optional)
   * @param minItems - Minimum required assets (minimum 1, even if 0 is passed)
   * @returns Number of matching assets, or 0 if requirements not met
   */
  async checkAssetOwnershipWithCriteria(address: string | string[], slug?: string, attributeKey?: string, attributeValue?: string, minItems = 1, context?: NftCheckContext): Promise<number> {
    const ids = await this.matchingAssetIdsWithCriteria(address, slug, attributeKey, attributeValue, 1, context);
    return ids.length >= minItems ? ids.length : 0;
  }

  async matchingAssetIdsWithCriteria(
    address: string | string[],
    slug?: string,
    attributeKey?: string,
    attributeValue?: string,
    minItems: number = 1,
    context?: NftCheckContext
  ): Promise<string[]> {
    if (slug?.includes(',')) throw new Error('Use one collection per rule.');
    const wallets = [...new Set((Array.isArray(address) ? address : [address]).map(wallet => wallet.toLowerCase()))].sort();
    if (!wallets.length) return [];
    const inventories: Map<string, Promise<EthscriptionAsset[]>> = context
      ? (context.ethscriptionAssets ||= new Map()) : new Map();
    const key = JSON.stringify(wallets);
    // Cache the promise before awaiting it, so parallel rules share one read.
    // A failed read stays failed for this run rather than becoming an empty wallet.
    if (!inventories.has(key)) inventories.set(key, this.readEthscriptionAssets(wallets));
    const assets = await inventories.get(key);
    const collection = slug?.trim();
    const scoped = collection && collection !== 'ALL' && collection !== 'all-collections'
      ? assets.filter(asset => asset.slug === collection) : assets;
    const matching: EthscriptionAsset[] = this.hasAttributeCriteria(attributeKey, attributeValue)
      ? this.filterByAttributes(scoped, attributeKey || 'ALL', attributeValue) : scoped;
    return [...new Set(matching.map(asset => asset.hashId.toLowerCase()))];
  }

  private async readEthscriptionAssets(wallets: string[]): Promise<EthscriptionAsset[]> {
    const startedAt = Date.now();
    const market = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a';
    const pageSize = 500;
    const assets: EthscriptionAsset[] = [];
    const ownership = wallets.map(wallet =>
      `owner.eq.${wallet},and(owner.eq.${market},prevOwner.eq.${wallet})`
    ).join(',');
    let pages = 0;
    try {
      for (let offset = 0; ; offset += pageSize) {
        // A left join retains assets without metadata for collection/count rules.
        const { data, error } = await supabase.from('ethscriptions')
          .select('hashId, slug, attributes_new(values)')
          .or(ownership)
          .order('hashId', { ascending: true })
          .range(offset, offset + pageSize - 1);
        pages++;
        if (error) throw new Error(`Failed to fetch ethscriptions: ${error.message}`);
        if (!Array.isArray(data)) throw new Error('Failed to fetch ethscriptions.');
        assets.push(...data as unknown as EthscriptionAsset[]);
        if (data.length < pageSize) return assets;
      }
    } finally {
      this.logger.log(`Ethscriptions holdings: ${Date.now() - startedAt}ms; wallets=${wallets.length}; assets=${assets.length}; pages=${pages}`);
    }
  }

  /**
   * Batch check asset ownership for multiple criteria - optimized for performance
   * @param address - Wallet address to check
   * @param criteriaList - Array of criteria objects with slug, attributeKey, attributeValue, minItems
   * @returns Map of criteria indexes to matching asset counts
   */
  async batchCheckAssetOwnership(
    address: string,
    criteriaList: Array<{
      slug?: string;
      attributeKey?: string;
      attributeValue?: string;
      minItems?: number;
    }>
  ): Promise<Map<number, number>> {
    if (criteriaList.length === 0) {
      return new Map();
    }

    const normalizedAddress = address.toLowerCase();
    const marketAddress = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a';
    const results = new Map<number, number>();

    Logger.log(`🚀 BATCH CHECK - Checking ${criteriaList.length} criteria for address: ${normalizedAddress}`);

    // Separate criteria into simple and attribute-filtered groups
    const simpleCriteria: Array<{ index: number; criteria: any }> = [];
    const attributeCriteria: Array<{ index: number; criteria: any }> = [];

    criteriaList.forEach((criteria, index) => {
      const hasAttributeFilter = this.hasAttributeCriteria(criteria.attributeKey, criteria.attributeValue);
      if (!hasAttributeFilter) {
        simpleCriteria.push({ index, criteria });
      } else {
        attributeCriteria.push({ index, criteria });
      }
    });

    // Process simple criteria in batch
    if (simpleCriteria.length > 0) {
      // Extract unique slugs efficiently
      const slugSet = new Set<string>();
      simpleCriteria.forEach(({ criteria }) => {
        if (criteria.slug && criteria.slug !== 'ALL' && criteria.slug !== 'all-collections') {
          slugSet.add(criteria.slug);
        }
      });
      const slugs = Array.from(slugSet);
      
      if (slugs.length === 0) {
        // No slug filtering - get all assets
        const { data, error } = await supabase
          .from('ethscriptions')
          .select('hashId, slug')
          .or(`owner.eq.${normalizedAddress},and(owner.eq.${marketAddress},prevOwner.eq.${normalizedAddress})`);

        if (error) throw new Error(error.message);

        simpleCriteria.forEach(({ index, criteria }) => {
          const count = data?.length || 0;
          results.set(index, count >= (criteria.minItems || 1) ? count : 0);
        });
      } else {
        // Batch query for all relevant slugs
        const { data, error } = await supabase
          .from('ethscriptions')
          .select('hashId, slug')
          .or(`owner.eq.${normalizedAddress},and(owner.eq.${marketAddress},prevOwner.eq.${normalizedAddress})`)
          .in('slug', slugs);

        if (error) throw new Error(error.message);

        // Group by slug for efficient counting
        const assetsBySlug = new Map<string, number>();
        data?.forEach(asset => {
          assetsBySlug.set(asset.slug, (assetsBySlug.get(asset.slug) || 0) + 1);
        });

        simpleCriteria.forEach(({ index, criteria }) => {
          const count = assetsBySlug.get(criteria.slug!) || 0;
          results.set(index, count >= (criteria.minItems || 1) ? count : 0);
        });
      }
    }

    // Process attribute criteria individually (these require complex filtering)
    if (attributeCriteria.length > 0) {
      const attributePromises = attributeCriteria.map(async ({ index, criteria }) => {
        const count = await this.checkAssetOwnershipWithCriteria(
          address,
          criteria.slug,
          criteria.attributeKey,
          criteria.attributeValue,
          criteria.minItems
        );
        return { index, count };
      });

      const attributeResults = await Promise.all(attributePromises);
      attributeResults.forEach(({ index, count }) => {
        results.set(index, count);
      });
    }

    Logger.log(`🚀 BATCH CHECK - Completed ${criteriaList.length} checks with ${results.size} results`);
    return results;
  }

  /**
   * Filter ethscriptions by attribute key/value with optimized logic
   * @private
   */
  private filterByAttributes(ethscriptions: any[], attributeKey: string, attributeValue?: string): any[] {
    return ethscriptions.filter(item => {
      const attributes = item.attributes_new?.values;
      if (!attributes || typeof attributes !== 'object') return false;
      return Object.entries(attributes).some(([key, value]) =>
        (attributeKey === 'ALL' || key.toLowerCase() === attributeKey.toLowerCase())
        && (!attributeValue || attributeValue === 'ALL'
          || (value !== null && value !== undefined && String(value).toLowerCase() === attributeValue.toLowerCase())));
    });
  }
}

export type AssetWithAttrs = {
  slug: string;
  attributes: Record<string, string | number>;
};
