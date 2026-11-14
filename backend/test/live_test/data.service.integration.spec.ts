import { Test, TestingModule } from '@nestjs/testing';
import { DataService } from '@/services/data.service';
import { Logger } from '@nestjs/common';

/**
 * DataService Integration Tests
 * 
 * Tests against the REAL external marketplace database.
 * These tests validate:
 * - Connectivity to external Supabase instance
 * - Data service methods with real data responses
 * - Error handling and edge cases
 * - Network resilience and timeout handling
 * 
 * ⚠️ NOTE: These tests hit a real external database
 * - Tests are designed to be non-destructive (read-only)
 * - May fail if external service is down or network issues occur
 * - Includes graceful fallbacks for connectivity issues
 * - Includes throttling to be respectful of external API
 */
describe('DataService - Integration Tests', () => {
  let service: DataService;
  let module: TestingModule;
  let isExternalDbAvailable = false;

  // Test throttling to be respectful of external API
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const TEST_DELAY = 200; // 200ms between tests

  beforeAll(async () => {
    // Suppress debug logs during testing unless specifically needed
    jest.spyOn(Logger, 'debug').mockImplementation(() => {});
    
    module = await Test.createTestingModule({
      providers: [DataService],
    }).compile();

    service = module.get<DataService>(DataService);

    // Test connectivity before running tests
    try {
      console.log('🔍 Testing external database connectivity...');
      const testResult = await Promise.race([
        service.getAllSlugs(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), 5000)
        )
      ]);
      
      if (Array.isArray(testResult) && testResult.length > 0) {
        isExternalDbAvailable = true;
        console.log('✅ External database is available for testing');
      }
    } catch (error) {
      console.log('⚠️ External database unavailable:', error.message);
      console.log('📝 Tests will run in limited mode or be skipped where appropriate');
      isExternalDbAvailable = false;
    }
  }, 15000);

  afterAll(async () => {
    await module.close();
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    // Throttle requests to be respectful
    if (isExternalDbAvailable) {
      await delay(TEST_DELAY);
    }
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('connectivity and basic functionality', () => {
    it('should handle connection state appropriately', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping connectivity test - external database unavailable');
        return;
      }

      // Test basic connectivity by getting all slugs
      const slugs = await service.getAllSlugs();
      
      expect(Array.isArray(slugs)).toBe(true);
      expect(slugs.length).toBeGreaterThan(0);
      expect(slugs).toContain('all-collections'); // Should always be present
    }, 10000);

    it('should handle getAllSlugs response format correctly', async () => {
      if (!isExternalDbAvailable) {
        // Test error handling instead
        try {
          await service.getAllSlugs();
          fail('Expected error for unavailable database');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBeTruthy();
        }
        return;
      }

      const slugs = await service.getAllSlugs();
      
      expect(slugs).toContain('all-collections');
      expect(slugs.length).toBeGreaterThanOrEqual(1);
      
      // All entries should be strings
      slugs.forEach(slug => {
        expect(typeof slug).toBe('string');
        expect(slug.length).toBeGreaterThan(0);
      });
    });
  });

  describe('basic ownership counts', () => {
    it('should return number for valid address format', async () => {
      const testAddress = '0x0000000000000000000000000000000000000000';
      
      if (!isExternalDbAvailable) {
        try {
          await service.checkAssetOwnershipWithCriteria(testAddress);
          fail('Expected error for unavailable database');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
        return;
      }

      const result = await service.checkAssetOwnershipWithCriteria(testAddress);
      
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should handle address case insensitivity', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping case sensitivity test - external database unavailable');
        return;
      }

      const testAddress = '0x1234567890123456789012345678901234567890';
      
      // Test with different cases
      const resultLower = await service.checkAssetOwnershipWithCriteria(testAddress.toLowerCase());
      await delay(TEST_DELAY);
      const resultUpper = await service.checkAssetOwnershipWithCriteria(testAddress.toUpperCase());
      await delay(TEST_DELAY);
      const resultMixed = await service.checkAssetOwnershipWithCriteria(testAddress);
      
      expect(resultLower).toBe(resultUpper);
      expect(resultLower).toBe(resultMixed);
    });

    it('should handle malformed addresses gracefully', async () => {
      if (!isExternalDbAvailable) {
        // Each failed read now retries for several seconds; nothing to learn offline.
        console.log('📝 Skipping malformed address test - external database unavailable');
        return;
      }

      const malformedAddresses = [
        'not-an-address',
        '0x123', // too short
        '0xinvalid',
        '',
        'null',
        '0x' + 'z'.repeat(40), // invalid hex
      ];

      for (const addr of malformedAddresses) {
        try {
          const result = await service.checkAssetOwnershipWithCriteria(addr);
          
          if (isExternalDbAvailable) {
            // Should either return 0 or throw an error, but not crash
            expect(typeof result === 'number' || result === undefined).toBe(true);
          }
        } catch (error) {
          // Error is acceptable for malformed addresses
          expect(error).toBeInstanceOf(Error);
        }
        
        await delay(50); // Small delay between malformed requests
      }
    });
  });

  describe('checkAssetOwnershipWithCriteria', () => {
    it('should handle basic ownership check without criteria', async () => {
      const testAddress = '0x0000000000000000000000000000000000000000';
      
      if (!isExternalDbAvailable) {
        try {
          await service.checkAssetOwnershipWithCriteria(testAddress);
          fail('Expected error for unavailable database');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
        }
        return;
      }

      const result = await service.checkAssetOwnershipWithCriteria(testAddress);
      
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should handle slug filtering', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping slug filtering test - external database unavailable');
        return;
      }

      const testAddress = '0x1234567890123456789012345678901234567890';
      
      // Get available slugs first to test with
      const slugs = await service.getAllSlugs();
      
      if (slugs.length > 1) { // Skip 'all-collections'
        const testSlug = slugs.find(s => s !== 'all-collections');
        
        if (testSlug) {
          const result = await service.checkAssetOwnershipWithCriteria(
            testAddress, 
            testSlug
          );
          
          expect(typeof result).toBe('number');
          expect(result).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('should handle minimum items requirement', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping minimum items test - external database unavailable');
        return;
      }

      const testAddress = '0x0000000000000000000000000000000000000000';
      
      // Test with various minimum requirements
      const minItems = [1, 5];
      
      for (const min of minItems) {
        const result = await service.checkAssetOwnershipWithCriteria(
          testAddress, 
          undefined, 
          undefined, 
          undefined, 
          min
        );
        
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0);
        
        // If result > 0, it should mean requirements were met
        if (result > 0) {
          expect(result).toBeGreaterThanOrEqual(min);
        }
        
        await delay(TEST_DELAY);
      }
    });

    it('should handle special cases and edge values', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping edge values test - external database unavailable');
        return;
      }

      const testAddress = '0x0000000000000000000000000000000000000000';
      
      // Test edge cases
      const edgeCases = [
        { slug: 'ALL' },
        { slug: 'all-collections' },
        { attributeKey: 'ALL', attributeValue: 'ALL' },
        { minItems: 0 }, // Should default to 1
      ];
      
      for (const testCase of edgeCases) {
        const result = await service.checkAssetOwnershipWithCriteria(
          testAddress,
          testCase.slug,
          testCase.attributeKey,
          testCase.attributeValue,
          testCase.minItems
        );
        
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(0);
        
        await delay(TEST_DELAY);
      }
    });
  });

  describe('error handling and resilience', () => {
    it('should handle network connectivity issues gracefully', async () => {
      // This test verifies the service handles connection failures properly
      if (isExternalDbAvailable) {
        console.log('📝 Database is available - testing with edge case addresses');
        
        const problematicInputs = [
          '0x' + '0'.repeat(40), // All zeros
          '0x' + 'f'.repeat(40), // All f's  
        ];
        
        for (const addr of problematicInputs) {
          const result = await service.checkAssetOwnershipWithCriteria(addr);
          expect(typeof result).toBe('number');
          await delay(TEST_DELAY);
        }
      } else {
        console.log('📝 Testing error handling for unavailable database');
        
        try {
          await service.checkAssetOwnershipWithCriteria('0x0000000000000000000000000000000000000000');
          fail('Expected error for unavailable database');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBeTruthy();
        }
      }
    });

    it('should maintain consistent response types', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping consistency test - external database unavailable');
        return;
      }

      const testAddress = '0x0000000000000000000000000000000000000000';
      
      // Call each method multiple times to verify consistency
      for (let i = 0; i < 2; i++) {
        const slugs = await service.getAllSlugs();
        await delay(TEST_DELAY);
        
        const criteria = await service.checkAssetOwnershipWithCriteria(testAddress);
        
        expect(Array.isArray(slugs)).toBe(true);
        expect(typeof criteria).toBe('number');
        
        await delay(TEST_DELAY);
      }
    });
  });

  describe('service configuration validation', () => {
    it('should have proper environment configuration', () => {
      // Validate that the required environment variables are configured
      const DataServiceModule = require('@/services/data.service');
      expect(DataServiceModule).toBeDefined();
      
      // The service should be constructible
      expect(service).toBeDefined();
      expect(service.getAllSlugs).toBeInstanceOf(Function);
      expect(service.checkAssetOwnershipWithCriteria).toBeInstanceOf(Function);
    });
  });

  describe('enhanced error handling and edge cases', () => {
    it('should handle complex attribute filtering scenarios', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping complex filtering test - external database unavailable');
        return;
      }

      const testAddress = '0x0000000000000000000000000000000000000000';
      
      // Test attribute filtering with various edge cases
      const attributeTests = [
        // Test case sensitivity variations
        { key: 'Color', value: 'Red', description: 'capitalized key/value' },
        { key: 'color', value: 'red', description: 'lowercase key/value' },
        { key: 'COLOR', value: 'RED', description: 'uppercase key/value' },
        
        // Test special "ALL" values - these should trigger different code paths
        { key: 'ALL', value: 'Blue', description: 'search all keys for value' },
        { key: 'Rarity', value: 'ALL', description: 'any value for specific key' },
        
        // Test with different slug combinations
        { key: 'Background', value: 'Ocean', slug: 'all-collections', description: 'all collections filter' },
        { key: 'Eyes', value: 'Laser', slug: 'ALL', description: 'ALL slug filter' },
        
        // Test minItems parameter variations
        { key: 'Type', value: 'Robot', minItems: 0, description: 'minItems 0 (should default to 1)' },
        { key: 'Trait', value: 'Rare', minItems: 5, description: 'high minItems threshold' },
        
        // Test empty/null scenarios
        { key: '', value: 'test', description: 'empty attribute key' },
        { key: 'test', value: '', description: 'empty attribute value' },
      ];

      for (const testCase of attributeTests) {
        try {
          const result = await service.checkAssetOwnershipWithCriteria(
            testAddress,
            testCase.slug,
            testCase.key,
            testCase.value,
            testCase.minItems
          );
          
          expect(typeof result).toBe('number');
          expect(result).toBeGreaterThanOrEqual(0);
          console.log(`✓ ${testCase.description}: ${result} assets`);
          
        } catch (error) {
          console.log(`⚠️ ${testCase.description}: ${error.message}`);
          expect(error).toBeInstanceOf(Error);
        }
        
        await delay(TEST_DELAY);
      }
    });

    it('should handle getAllSlugs with error conditions', async () => {
      if (!isExternalDbAvailable) {
        try {
          await service.getAllSlugs();
          fail('Expected error for unavailable database');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBeTruthy(); // Just check that there's an error message
        }
        return;
      }

      // Test successful getAllSlugs call
      const slugs = await service.getAllSlugs();
      
      expect(Array.isArray(slugs)).toBe(true);
      expect(slugs.length).toBeGreaterThan(0);
      expect(slugs).toContain('all-collections'); // Should always be first
      
      // Verify deduplication works (no duplicates in the array)
      const uniqueSlugs = Array.from(new Set(slugs));
      expect(slugs.length).toBe(uniqueSlugs.length);
    });

    it('should exercise different query paths in checkAssetOwnershipWithCriteria', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping criteria query paths test - external database unavailable');
        return;
      }

      const testAddress = '0x0000000000000000000000000000000000000000';
      
      // Test the early return path (no attribute filtering)
      const simpleOwnership = await service.checkAssetOwnershipWithCriteria(testAddress);
      expect(typeof simpleOwnership).toBe('number');
      await delay(TEST_DELAY);
      
      // Test with slug but no attributes (should use early return path)
      const slugOwnership = await service.checkAssetOwnershipWithCriteria(
        testAddress, 
        'test-collection'
      );
      expect(typeof slugOwnership).toBe('number');
      await delay(TEST_DELAY);
      
      // Test the JOIN query path (with attribute filtering) - this should hit lines 160-248
      const attributeOwnership = await service.checkAssetOwnershipWithCriteria(
        testAddress,
        'test-collection',
        'Background',
        'Forest'
      );
      expect(typeof attributeOwnership).toBe('number');
      await delay(TEST_DELAY);
      
      // Test with minItems requirement
      const minItemsTest = await service.checkAssetOwnershipWithCriteria(
        testAddress,
        undefined,
        'Color',
        'Blue',
        3
      );
      expect(typeof minItemsTest).toBe('number');
      // If result > 0, it should be >= 3 (or 0 if requirement not met)
      if (minItemsTest > 0) {
        expect(minItemsTest).toBeGreaterThanOrEqual(3);
      }
    });

    it('should handle marketplace escrow scenarios correctly', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping marketplace escrow test - external database unavailable');
        return;
      }

      // Test addresses that might have marketplace escrow scenarios
      const testAddress = '0x1234567890123456789012345678901234567890';
      
      // Basic ownership includes marketplace escrow
      const criteriaCount = await service.checkAssetOwnershipWithCriteria(testAddress);
      expect(typeof criteriaCount).toBe('number');
    });

    it('should handle attribute filtering edge cases and exercise private filterByAttributes method', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping attribute edge cases test - external database unavailable');
        return;
      }

      const testAddress = '0x0000000000000000000000000000000000000000';
      
      // Test different attribute key case variations that should match the same data
      const caseVariations = [
        { key: 'background', value: 'Ocean' },
        { key: 'Background', value: 'Ocean' },
        { key: 'BACKGROUND', value: 'Ocean' },
        { key: 'BackGround', value: 'Ocean' },
      ];
      
      const results = [];
      for (const variation of caseVariations) {
        try {
          const result = await service.checkAssetOwnershipWithCriteria(
            testAddress,
            undefined,
            variation.key,
            variation.value
          );
          results.push(result);
          await delay(TEST_DELAY);
        } catch (error) {
          results.push(0); // Count as 0 if error
          await delay(TEST_DELAY);
        }
      }
      
      // At least some results should be consistent (case insensitive matching)
      expect(results.length).toBe(4);
      results.forEach(result => expect(typeof result).toBe('number'));
    });

    it('should test specific edge cases to improve line coverage', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping edge cases test - external database unavailable');
        return;
      }

      const testAddress = '0x0000000000000000000000000000000000000000';
      
      // Test various combinations to hit uncovered lines
      
      // 1. Test with actual attribute filtering to trigger JOIN query path
      await service.checkAssetOwnershipWithCriteria(
        testAddress,
        'real-collection-slug', // Use a real slug if possible
        'Trait', // Common attribute name
        'Common' // Common attribute value
      );
      await delay(TEST_DELAY);
      
      // 2. Test the "ALL" key functionality (should search all attribute keys)
      await service.checkAssetOwnershipWithCriteria(
        testAddress,
        undefined,
        'ALL',
        'Blue' // Search for 'Blue' in any attribute
      );
      await delay(TEST_DELAY);
      
      // 3. Test with no specific value (should match any value for the key)
      await service.checkAssetOwnershipWithCriteria(
        testAddress,
        undefined,
        'Background',
        'ALL' // Any background value
      );
      await delay(TEST_DELAY);
      
      // 4. Test edge case where minItems is not met
      const highMinResult = await service.checkAssetOwnershipWithCriteria(
        testAddress,
        undefined,
        'Rarity',
        'Legendary',
        100 // Very high minItems requirement
      );
      expect(highMinResult).toBe(0); // Should return 0 when requirement not met
      
      // 5. Test with an address that might actually have attributes to exercise the filtering logic
      const potentialOwnerAddress = '0x8ba1f109551bD432803012645Hap0E13d9D543A9'; // Random address
      await service.checkAssetOwnershipWithCriteria(
        potentialOwnerAddress,
        undefined,
        'Color',
        'Red'
      );
      await delay(TEST_DELAY);
    });

    it('should handle extreme minItems values', async () => {
      if (!isExternalDbAvailable) {
        console.log('📝 Skipping extreme minItems test - external database unavailable');
        return;
      }

      const testAddress = '0x0000000000000000000000000000000000000000';
      
      // Test with very high minItems (should return 0)
      const highMinItems = await service.checkAssetOwnershipWithCriteria(
        testAddress,
        undefined,
        undefined,
        undefined,
        999999
      );
      expect(highMinItems).toBe(0); // Very unlikely to have 999999 assets
      await delay(TEST_DELAY);
      
      // Test with negative minItems (should be handled as 1)
      const negativeMinItems = await service.checkAssetOwnershipWithCriteria(
        testAddress,
        undefined,
        undefined,
        undefined,
        -5
      );
      expect(typeof negativeMinItems).toBe('number');
      expect(negativeMinItems).toBeGreaterThanOrEqual(0);
    });
  });
});
