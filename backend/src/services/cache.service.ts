import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { AppLogger } from '@/utils/app-logger.util';
import { CacheableRule, CacheableAsset } from '@/types/common.types';

/**
 * Caching service for frequently accessed data
 * Provides smart caching with TTL management and cache invalidation
 */
@Injectable()
export class CacheService {
  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  /**
   * Cache time-to-live values (in seconds)
   */
  private static readonly TTL = {
    RULES: 300,        // 5 minutes - Rules don't change often
    USER_ASSETS: 120,  // 2 minutes - Asset ownership changes
    GUILD_ROLES: 600,  // 10 minutes - Discord roles are relatively stable
    SLUGS: 3600,       // 1 hour - Collection slugs rarely change
    NONCES: 300,       // 5 minutes - Nonce expiry time
    // Autocomplete cache TTLs (24-hour refresh cycle)
    ATTRIBUTE_KEYS: 86400,      // 24 hours - Attribute keys are stable
    ATTRIBUTE_VALUES: 86400,    // 24 hours - Values change infrequently
    AUTOCOMPLETE_DATA: 86400,   // 24 hours - Full autocomplete dataset
  } as const;

  /**
   * Get cached data with automatic type inference
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.cacheManager.get<T>(key);
      if (cached) {
        // Log cache operations only in development
        if (process.env.NODE_ENV === 'development') {
          AppLogger.debug(`Cache hit: ${key}`);
        }
      }
      return cached || null;
    } catch (error) {
      AppLogger.error(`Cache get error for key ${key}:`, error.message);
      return null;
    }
  }

  /**
   * Set cached data with a TTL in seconds. The cache store takes
   * milliseconds, so the value is converted here, in one place.
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      await this.cacheManager.set(key, value, ttl === undefined ? undefined : ttl * 1000);
      // Log cache operations only in development
      if (process.env.NODE_ENV === 'development') {
        AppLogger.debug(`Cache set: ${key} (TTL: ${ttl || 'default'}s)`);
      }
    } catch (error) {
      AppLogger.error(`Cache set error for key ${key}:`, error.message);
    }
  }

  /**
   * Delete cached data
   */
  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
      AppLogger.debug(`Cache deleted: ${key}`);
    } catch (error) {
      AppLogger.error(`Cache delete error for key ${key}:`, error.message);
    }
  }

  /**
   * Get or set cached data with fallback function
   */
  async getOrSet<T>(
    key: string,
    fallbackFn: () => Promise<T>,
    ttl: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    AppLogger.debug(`Cache miss: ${key}, executing fallback`);
    const startTime = Date.now();
    
    try {
      const result = await fallbackFn();
      await this.set(key, result, ttl);
      
      AppLogger.logWithTiming(`Cache fallback for ${key}`, startTime);
      return result;
    } catch (error) {
      AppLogger.error(`Cache fallback error for key ${key}:`, error.message);
      throw error;
    }
  }

  /**
   * Cache verification rules for a server
   */
  async cacheServerRules(serverId: string, rules: CacheableRule[]): Promise<void> {
    const key = `rules:server:${serverId}`;
    await this.set(key, rules, CacheService.TTL.RULES);
  }

  /**
   * Get cached verification rules for a server
   */
  async getCachedServerRules(serverId: string): Promise<CacheableRule[] | null> {
    const key = `rules:server:${serverId}`;
    return this.get<CacheableRule[]>(key);
  }

  /**
   * Cache user assets
   */
  async cacheUserAssets(address: string, assets: CacheableAsset[]): Promise<void> {
    const key = `assets:${address.toLowerCase()}`;
    await this.set(key, assets, CacheService.TTL.USER_ASSETS);
  }

  /**
   * Get cached user assets
   */
  async getCachedUserAssets(address: string): Promise<CacheableAsset[] | null> {
    const key = `assets:${address.toLowerCase()}`;
    return this.get<CacheableAsset[]>(key);
  }

  /**
   * Cache collection slugs
   */
  async cacheSlugs(slugs: string[]): Promise<void> {
    const key = 'slugs:all';
    await this.set(key, slugs, CacheService.TTL.SLUGS);
  }

  /**
   * Get cached collection slugs
   */
  async getCachedSlugs(): Promise<string[] | null> {
    const key = 'slugs:all';
    return this.get<string[]>(key);
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    // Note: This is a simplified implementation
    // For production, consider using Redis with pattern-based deletion
    AppLogger.debug(`Cache invalidation requested for pattern: ${pattern}`);
    
    // For now, we'll just clear specific known keys
    if (pattern.includes('rules')) {
      // Clear all rules cache - implement more sophisticated pattern matching if needed
      AppLogger.debug('Clearing rules cache due to pattern match');
    }
  }

  /**
   * Get TTL constants for external use
   */
  static getTTL() {
    return CacheService.TTL;
  }

  /**
   * Cache all attribute keys for all collections
   * This creates a comprehensive cache for instant autocomplete
   */
  async cacheAllCollectionData(dataSvc: any): Promise<void> {
    AppLogger.log('🔥 Starting comprehensive autocomplete cache warming...');
    const startTime = Date.now();

    try {
      // Step 1: Get and cache all slugs
      const allSlugs = await this.getOrSet(
        'slugs:all',
        () => dataSvc.getAllSlugs(),
        CacheService.TTL.SLUGS
      ) as string[];

      AppLogger.debug(`Caching data for ${allSlugs.length} collections`);

      // Step 2: Cache attribute keys for ALL collections
      const keyPromises = allSlugs
        .filter(slug => slug !== 'all-collections')
        .map(async (slug, index) => {
          try {
            // Add small delay to avoid overwhelming the API
            if (index > 0 && index % 10 === 0) {
              await this.delay(100); // 100ms delay every 10 requests
            }

            const keys = await this.getOrSet(
              `attributes:keys:${slug}`,
              () => dataSvc.getAttributeKeys(slug),
              CacheService.TTL.ATTRIBUTE_KEYS
            ) as string[];

            AppLogger.debug(`✅ Cached ${keys.length} attribute keys for ${slug}`);
            return { slug, success: true, keyCount: keys.length };
            
          } catch (error) {
            AppLogger.warn(`❌ Failed to cache keys for ${slug}:`, error.message);
            return { slug, success: false, error: error.message };
          }
        });

      const keyResults = await Promise.allSettled(keyPromises);
      const successfulKeys = keyResults.filter(r => 
        r.status === 'fulfilled' && r.value.success
      ).length;

      AppLogger.log(`✅ Cached attribute keys for ${successfulKeys}/${allSlugs.length} collections`);

      // Step 3: Cache the most common attribute values
      // We'll only cache values for attributes that appear frequently across collections
      await this.cacheCommonAttributeValues(allSlugs, dataSvc);

      AppLogger.logWithTiming('Comprehensive autocomplete cache warming completed', startTime);
      
      // Store cache completion timestamp
      await this.set('cache:last_full_update', new Date(), CacheService.TTL.AUTOCOMPLETE_DATA);
      
    } catch (error) {
      AppLogger.error('Comprehensive cache warming failed:', error);
      throw error;
    }
  }

  /**
   * Cache attribute values for the most common attributes across collections
   */
  private async cacheCommonAttributeValues(allSlugs: string[], dataSvc: any): Promise<void> {
    AppLogger.debug('Caching common attribute values...');
    
    // Common attribute names that appear in most NFT collections
    const commonAttributes = [
      'Background', 'Eyes', 'Clothes', 'Hat', 'Mouth', 'Trait', 'Type', 
      'Body', 'Skin', 'Hair', 'Accessories', 'Earring', 'Face'
    ];

    const valuePromises = [];
    let totalValueCaches = 0;

    for (const slug of allSlugs.slice(0, 50)) { // Limit to first 50 collections for values
      // Get the cached keys for this collection
      const cachedKeys = await this.get<string[]>(`attributes:keys:${slug}`);
      if (!cachedKeys) continue;

      // Find which common attributes this collection has
      const matchingAttributes = cachedKeys.filter(key => 
        commonAttributes.some(common => 
          key.toLowerCase().includes(common.toLowerCase())
        )
      );

      // Cache values for matching attributes
      for (const attributeKey of matchingAttributes.slice(0, 5)) { // Max 5 per collection
        valuePromises.push(
          this.cacheAttributeValuesForKey(slug, attributeKey, dataSvc)
            .then(() => totalValueCaches++)
            .catch(error => 
              AppLogger.warn(`Failed to cache values for ${slug}:${attributeKey}:`, error.message)
            )
        );
      }
    }

    await Promise.allSettled(valuePromises);
    AppLogger.debug(`✅ Cached attribute values for ${totalValueCaches} attribute combinations`);
  }

  /**
   * Cache attribute values for a specific collection + attribute
   */
  private async cacheAttributeValuesForKey(slug: string, attributeKey: string, dataSvc: any): Promise<void> {
    const cacheKey = `attributes:values:${slug}:${attributeKey}`;
    await this.getOrSet(
      cacheKey,
      () => dataSvc.getAttributeValuesForAutocomplete(attributeKey, slug),
      CacheService.TTL.ATTRIBUTE_VALUES
    );
  }

  /**
   * Get cached attribute keys with fallback
   */
  async getAttributeKeys(slug: string, dataSvc: any): Promise<string[]> {
    return this.getOrSet(
      `attributes:keys:${slug}`,
      () => dataSvc.getAttributeKeys(slug),
      CacheService.TTL.ATTRIBUTE_KEYS
    ) as Promise<string[]>;
  }

  /**
   * Get cached attribute values with fallback
   */
  async getAttributeValues(slug: string, attributeKey: string, dataSvc: any): Promise<string[]> {
    return this.getOrSet(
      `attributes:values:${slug}:${attributeKey}`,
      () => dataSvc.getAttributeValuesForAutocomplete(attributeKey, slug),
      CacheService.TTL.ATTRIBUTE_VALUES
    ) as Promise<string[]>;
  }

  /**
   * Get ALL cached attribute values (not limited to rarest 25) for manual entry support
   * This allows users to type any valid attribute value, even if it's not in the top autocomplete results
   */
  async getAllAttributeValues(slug: string, attributeKey: string, dataSvc: any): Promise<string[]> {
    return this.getOrSet(
      `attributes:all_values:${slug}:${attributeKey}`,
      () => dataSvc.getAllAttributeValues(attributeKey, slug),
      CacheService.TTL.ATTRIBUTE_VALUES
    ) as Promise<string[]>;
  }

  /**
   * Check if comprehensive cache is available and fresh
   */
  async isComprehensiveCacheFresh(): Promise<boolean> {
    const lastUpdate = await this.get<Date>('cache:last_full_update');
    if (!lastUpdate) return false;
    
    const age = Date.now() - new Date(lastUpdate).getTime();
    return age < (CacheService.TTL.AUTOCOMPLETE_DATA * 1000);
  }

  /**
   * Get cache statistics for monitoring
   */
  async getCacheStats(): Promise<any> {
    const slugs = await this.getCachedSlugs();
    const lastUpdate = await this.get<Date>('cache:last_full_update');
    
    return {
      totalCollections: slugs?.length || 0,
      lastFullUpdate: lastUpdate,
      isFresh: await this.isComprehensiveCacheFresh(),
      cacheAge: lastUpdate ? Date.now() - new Date(lastUpdate).getTime() : null
    };
  }

  /**
   * Small delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Batch get multiple cache keys in parallel for better performance
   * @param keys - Array of cache keys to retrieve
   * @returns Map of keys to cached values (undefined for cache misses)
   */
  async batchGet<T>(keys: string[]): Promise<Map<string, T | undefined>> {
    if (keys.length === 0) {
      return new Map();
    }

    const batchPromises = keys.map(async key => {
      try {
        const value = await this.get<T>(key);
        return { key, value };
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          AppLogger.debug(`Cache batch get error for key ${key}:`, error);
        }
        return { key, value: undefined };
      }
    });

    const results = await Promise.all(batchPromises);
    const resultMap = new Map<string, T | undefined>();
    
    results.forEach(({ key, value }) => {
      resultMap.set(key, value);
    });

    return resultMap;
  }

  /**
   * Batch set multiple cache entries in parallel for better performance
   * @param entries - Array of objects with key, value, and optional ttl
   */
  async batchSet<T>(entries: Array<{ key: string; value: T; ttl?: number }>): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const setPromises = entries.map(async ({ key, value, ttl }) => {
      try {
        await this.set(key, value, ttl);
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          AppLogger.debug(`Cache batch set error for key ${key}:`, error);
        }
      }
    });

    await Promise.all(setPromises);
  }

  /**
   * Warm up cache with frequently accessed data in parallel
   * @param warmupEntries - Array of functions that return cache entries
   */
  async warmupCache(warmupEntries: Array<() => Promise<{ key: string; value: any; ttl?: number }>>): Promise<void> {
    if (warmupEntries.length === 0) {
      return;
    }

    if (process.env.NODE_ENV === 'development') {
      AppLogger.debug(`🔥 Warming up cache with ${warmupEntries.length} entries`);
    }

    const warmupPromises = warmupEntries.map(async entryFn => {
      try {
        const { key, value, ttl } = await entryFn();
        await this.set(key, value, ttl);
        return true;
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          AppLogger.debug('Cache warmup error:', error);
        }
        return false;
      }
    });

    const results = await Promise.all(warmupPromises);
    const successCount = results.filter(success => success).length;
    
    if (process.env.NODE_ENV === 'development') {
      AppLogger.debug(`🔥 Cache warmup completed: ${successCount}/${warmupEntries.length} entries cached`);
    }
  }
}
