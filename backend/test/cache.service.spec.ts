import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CacheService } from '@/services/cache.service';
import { boundedCacheOptions } from '../src/utils/bounded-cache.util';

/**
 * CacheService Unit Tests
 * 
 * Tests the caching functionality including:
 * - Basic get/set operations
 * - TTL (Time To Live) management
 * - Cache invalidation
 * - Key generation utilities
 * - Error handling for cache failures
 */
describe('CacheService', () => {
  let service: CacheService;
  let mockCacheManager: any;

  beforeEach(async () => {
    // Mock cache manager with all required methods
    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      reset: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Cache Operations', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should get cached data successfully', async () => {
      const testData = { userId: '123', roles: ['role1', 'role2'] };
      mockCacheManager.get.mockResolvedValue(testData);

      const result = await service.get('test-key');

      expect(result).toEqual(testData);
      expect(mockCacheManager.get).toHaveBeenCalledWith('test-key');
    });

    it('should return null for cache miss', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);

      const result = await service.get('non-existent-key');

      expect(result).toBeNull();
      expect(mockCacheManager.get).toHaveBeenCalledWith('non-existent-key');
    });

    it('should handle cache get errors gracefully', async () => {
      mockCacheManager.get.mockRejectedValue(new Error('Cache error'));

      const result = await service.get('error-key');

      expect(result).toBeNull();
      expect(mockCacheManager.get).toHaveBeenCalledWith('error-key');
    });

    it('should set cache data with TTL', async () => {
      const testData = { test: 'data' };
      mockCacheManager.set.mockResolvedValue(undefined);

      await service.set('test-key', testData, 300);

      expect(mockCacheManager.set).toHaveBeenCalledWith('test-key', testData, 300_000);
    });

    it('should set cache data without TTL', async () => {
      const testData = { test: 'data' };
      mockCacheManager.set.mockResolvedValue(undefined);

      await service.set('test-key', testData);

      expect(mockCacheManager.set).toHaveBeenCalledWith('test-key', testData, undefined);
    });

    it('should handle cache set errors gracefully', async () => {
      mockCacheManager.set.mockRejectedValue(new Error('Cache set error'));

      await expect(service.set('error-key', { test: 'data' })).resolves.not.toThrow();
      expect(mockCacheManager.set).toHaveBeenCalled();
    });
  });

  describe('Cache Deletion', () => {
    it('should delete single cache key', async () => {
      mockCacheManager.del.mockResolvedValue(undefined);

      await service.del('test-key');

      expect(mockCacheManager.del).toHaveBeenCalledWith('test-key');
    });

    it('should handle cache delete errors gracefully', async () => {
      mockCacheManager.del.mockRejectedValue(new Error('Cache delete error'));

      await expect(service.del('error-key')).resolves.not.toThrow();
      expect(mockCacheManager.del).toHaveBeenCalledWith('error-key');
    });
  });

  describe('Get or Set Pattern', () => {
    it('should return cached data if available', async () => {
      const cachedData = { cached: true };
      mockCacheManager.get.mockResolvedValue(cachedData);

      const fallbackFn = jest.fn();
      const result = await service.getOrSet('test-key', fallbackFn, 300);

      expect(result).toEqual(cachedData);
      expect(mockCacheManager.get).toHaveBeenCalledWith('test-key');
      expect(fallbackFn).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('should execute fallback and cache result if cache miss', async () => {
      const fallbackData = { fresh: true };
      mockCacheManager.get.mockResolvedValue(undefined);
      mockCacheManager.set.mockResolvedValue(undefined);
      
      const fallbackFn = jest.fn().mockResolvedValue(fallbackData);
      const result = await service.getOrSet('test-key', fallbackFn, 300);

      expect(result).toEqual(fallbackData);
      expect(mockCacheManager.get).toHaveBeenCalledWith('test-key');
      expect(fallbackFn).toHaveBeenCalled();
      expect(mockCacheManager.set).toHaveBeenCalledWith('test-key', fallbackData, 300_000);
    });

    it('should propagate fallback function errors', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      const fallbackError = new Error('Fallback failed');
      const fallbackFn = jest.fn().mockRejectedValue(fallbackError);

      await expect(service.getOrSet('test-key', fallbackFn, 300)).rejects.toThrow('Fallback failed');
      expect(fallbackFn).toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });
  });

  describe('Server Rules Caching', () => {
    it('should cache server rules with appropriate TTL', async () => {
      const rules = [{ 
        id: '1', 
        server_id: 'server-123',
        channel_id: 'channel-123', 
        role_id: 'role-123',
        slug: 'test-collection',
        attribute_key: 'trait',
        attribute_value: 'rare',
        min_items: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }];
      mockCacheManager.set.mockResolvedValue(undefined);

      await service.cacheServerRules('server-123', rules);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'rules:server:server-123',
        rules,
        300_000 // 5 minutes
      );
    });

    it('should get cached server rules', async () => {
      const rules = [{ id: '1', name: 'test-rule' }];
      mockCacheManager.get.mockResolvedValue(rules);

      const result = await service.getCachedServerRules('server-123');

      expect(result).toEqual(rules);
      expect(mockCacheManager.get).toHaveBeenCalledWith('rules:server:server-123');
    });

    it('should return null for non-existent server rules', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);

      const result = await service.getCachedServerRules('server-404');

      expect(result).toBeNull();
      expect(mockCacheManager.get).toHaveBeenCalledWith('rules:server:server-404');
    });
  });

  describe('User Assets Caching', () => {
    it('should cache user assets with appropriate TTL', async () => {
      const assets = [{ 
        hashId: 'hash-1', 
        slug: 'test-collection', 
        owner: '0x123ABC',
        prevOwner: '0x456DEF',
        attributes: { trait: 'rare' }
      }];
      mockCacheManager.set.mockResolvedValue(undefined);

      await service.cacheUserAssets('0x123ABC', assets);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'assets:0x123abc', // Should be lowercase
        assets,
        120_000 // 2 minutes
      );
    });

    it('should get cached user assets', async () => {
      const assets = [{ tokenId: '1', collection: 'test' }];
      mockCacheManager.get.mockResolvedValue(assets);

      const result = await service.getCachedUserAssets('0x123ABC');

      expect(result).toEqual(assets);
      expect(mockCacheManager.get).toHaveBeenCalledWith('assets:0x123abc'); // Should be lowercase
    });

    it('should handle address case insensitivity', async () => {
      const assets = [{ 
        hashId: 'hash-1', 
        slug: 'test-collection', 
        owner: '0x123ABC'
      }];
      mockCacheManager.set.mockResolvedValue(undefined);

      await service.cacheUserAssets('0x123ABC', assets);
      
      // Should use the same key regardless of case
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'assets:0x123abc',
        assets,
        120_000
      );
    });
  });

  describe('Slugs Caching', () => {
    it('should cache collection slugs with appropriate TTL', async () => {
      const slugs = ['collection1', 'collection2'];
      mockCacheManager.set.mockResolvedValue(undefined);

      await service.cacheSlugs(slugs);

      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'slugs:all',
        slugs,
        3_600_000 // 1 hour
      );
    });

    it('should get cached collection slugs', async () => {
      const slugs = ['collection1', 'collection2'];
      mockCacheManager.get.mockResolvedValue(slugs);

      const result = await service.getCachedSlugs();

      expect(result).toEqual(slugs);
      expect(mockCacheManager.get).toHaveBeenCalledWith('slugs:all');
    });
  });

  describe('Cache Invalidation', () => {
    it('should handle pattern invalidation', async () => {
      await expect(service.invalidatePattern('rules:*')).resolves.not.toThrow();
    });

    it('should handle pattern invalidation for rules', async () => {
      await expect(service.invalidatePattern('rules:server:123')).resolves.not.toThrow();
    });
  });

  describe('TTL Constants', () => {
    it('should expose TTL constants', () => {
      const ttl = CacheService.getTTL();
      
      expect(ttl).toHaveProperty('RULES', 300);
      expect(ttl).toHaveProperty('USER_ASSETS', 120);
      expect(ttl).toHaveProperty('GUILD_ROLES', 600);
      expect(ttl).toHaveProperty('SLUGS', 3600);
      expect(ttl).toHaveProperty('NONCES', 300);
    });
  });

  describe('Error Resilience', () => {
    it('should continue working when cache is unavailable', async () => {
      // Simulate cache service being down
      mockCacheManager.get.mockRejectedValue(new Error('Cache unavailable'));
      mockCacheManager.set.mockRejectedValue(new Error('Cache unavailable'));

      const getResult = await service.get('test-key');
      await service.set('test-key', { data: 'test' });

      expect(getResult).toBeNull();
      // Should not throw errors - graceful degradation
    });

    it('should handle concurrent cache operations', async () => {
      mockCacheManager.get.mockResolvedValue({ data: 'test' });
      mockCacheManager.set.mockResolvedValue(undefined);
      mockCacheManager.del.mockResolvedValue(undefined);

      // Simulate concurrent operations
      const operations = [
        service.get('key1'),
        service.set('key2', { data: 'test' }),
        service.get('key3'),
        service.del('key4'),
      ];

      await expect(Promise.all(operations)).resolves.not.toThrow();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle typical verification flow caching', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockCacheManager.set.mockResolvedValue(undefined);

      // Simulate a typical verification flow
      const serverId = 'server-123';
      const userAddress = '0xuser123';
      const rules = [{ 
        id: '1', 
        server_id: serverId,
        channel_id: 'channel-123', 
        role_id: 'role-123',
        slug: 'test-collection',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }];
      const assets = [{ 
        hashId: 'hash-1', 
        slug: 'test-collection', 
        owner: userAddress
      }];

      // Cache server rules
      await service.cacheServerRules(serverId, rules);
      
      // Cache user assets
      await service.cacheUserAssets(userAddress, assets);

      // Verify caching calls
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'rules:server:server-123',
        rules,
        300_000
      );
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'assets:0xuser123',
        assets,
        120_000
      );
    });

    it('should handle cache warming scenarios', async () => {
      const fallbackFn = jest.fn().mockResolvedValue(['slug1', 'slug2']);
      mockCacheManager.get.mockResolvedValue(undefined);
      mockCacheManager.set.mockResolvedValue(undefined);

      // Warm cache with getOrSet
      const result = await service.getOrSet('slugs:all', fallbackFn, 3600);

      expect(result).toEqual(['slug1', 'slug2']);
      expect(fallbackFn).toHaveBeenCalled();
      expect(mockCacheManager.set).toHaveBeenCalledWith('slugs:all', ['slug1', 'slug2'], 3_600_000);
    });
  });
  it('keeps an entry for seconds, not milliseconds, in a real cache store', async () => {
    const { createCache } = require('cache-manager');
    const real = new CacheService(createCache(boundedCacheOptions(10)));
    await real.set('key', 'value', 2);
    // With the lifetime passed through as 2 ms this entry would already be gone.
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(await real.get('key')).toBe('value');
  });
});
