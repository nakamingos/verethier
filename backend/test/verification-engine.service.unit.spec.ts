import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { NftOwnershipService } from '../src/services/nft-ownership.service';
/**
 * VerificationEngine Unit Tests
 * 
 * Comprehensive unit test suite for the VerificationEngine class.
 * Tests all verification logic and error handling.
 * 
 * Coverage Goals:
 * - Verification flows
 * - Bulk verification operations
 * - Error handling and edge cases
 * - Input validation and sanitization
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { VerificationEngine, VerificationResult, BulkVerificationResult } from '../src/services/verification-engine.service';
import { DbService } from '../src/services/db.service';
import { DataService } from '../src/services/data.service';
import { UserAddressService } from '../src/services/user-address.service';
import { VerifierRole } from '../src/models/verifier-role.interface';

describe('VerificationEngine', () => {
  let service: VerificationEngine;
  let mockDbService: jest.Mocked<DbService>;
  let mockDataService: jest.Mocked<DataService>;
  let mockUserAddressService: jest.Mocked<UserAddressService>;
  let loggerSpy: jest.SpyInstance;

  const mockRule: VerifierRole = {
    id: 1,
    server_id: 'server123',
    server_name: 'Test Server',
    channel_id: 'channel123',
    channel_name: 'Test Channel',
    slug: 'test_collection',
    role_id: 'role123',
    role_name: 'Test Role',
    attribute_key: 'test_attribute',
    attribute_value: 'ALL',
    min_items: 1
  };

  const mockModernRule: VerifierRole = {
    id: 2,
    server_id: 'server123',
    server_name: 'Test Server',
    channel_id: 'channel123',
    channel_name: 'Test Channel',
    slug: 'cool-cats',
    role_id: 'role456',
    role_name: 'Cool Cats Holder',
    attribute_key: 'trait_type',
    attribute_value: 'Rare',
    min_items: 3
  };

  beforeEach(async () => {
    const mockDbServiceValue = {
      getRuleById: jest.fn(),
      getRoleMappings: jest.fn(),
    };

    const mockDataServiceValue = {
      checkAssetOwnershipWithCriteria: jest.fn(),
    };

    const mockUserAddressServiceValue = {
      getUserAddresses: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetOwnershipService,
        { provide: NftOwnershipService, useValue: { count: jest.fn() } },
        VerificationEngine,
        { provide: DbService, useValue: mockDbServiceValue },
        { provide: DataService, useValue: mockDataServiceValue },
        { provide: UserAddressService, useValue: mockUserAddressServiceValue },
      ],
    }).compile();

    service = module.get<VerificationEngine>(VerificationEngine);
    mockDbService = module.get(DbService);
    mockDataService = module.get(DataService);
    mockUserAddressService = module.get(UserAddressService);
    mockUserAddressService.getUserAddresses.mockResolvedValue([]);
    
    loggerSpy = jest.spyOn(Logger, 'debug').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (loggerSpy && loggerSpy.mockRestore) {
      loggerSpy.mockRestore();
    }
  });

  describe('verifyUser', () => {
    it('should successfully verify user with rule', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(5);

      const result = await service.verifyUser('user123', 'test_rule', 'address123');

      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        ['address123'],
        'test_collection',
        'test_attribute',
        'ALL',
        1
      );
      expect(result.isValid).toBe(true);
      expect(result.matchingAssetCount).toBe(5);
      expect(result.rule).toEqual(mockRule);
      expect(result.verificationDetails).toEqual({
        collection: 'test_collection',
        attributeKey: 'test_attribute',
        attributeValue: 'ALL',
        minItems: 1,
        foundAssets: 5
      });
    });

    it('should successfully verify user with modern rule', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        ['address123'],
        'cool-cats',
        'trait_type',
        'Rare',
        1
      );
      expect(result.isValid).toBe(true);
      expect(result.matchingAssetCount).toBe(3);
      expect(result.rule).toEqual(mockModernRule);
      expect(result.verificationDetails).toEqual({
        collection: 'cool-cats',
        attributeKey: 'trait_type',
        attributeValue: 'Rare',
        minItems: 3,
        foundAssets: 3
      });
    });

    it('should fail verification when user has insufficient assets', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(1); // Less than required 3

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(result.isValid).toBe(false);
      expect(result.matchingAssetCount).toBe(1);
      expect(result.verificationDetails?.foundAssets).toBe(1);
      expect(result.verificationDetails?.minItems).toBe(3);
    });

    it('should handle rule not found', async () => {
      mockDbService.getRuleById.mockResolvedValue(null);

      const result = await service.verifyUser('user123', 'nonexistent', 'address123');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Rule nonexistent not found');
      expect(result.userId).toBe('user123');
      expect(result.ruleId).toBe('nonexistent');
      expect(result.address).toBe('address123');
    });

    it('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection failed');
      mockDbService.getRuleById.mockRejectedValue(dbError);

      const result = await service.verifyUser('user123', 'rule123', 'address123');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Rule rule123 not found');
    });

    it('should handle data service errors in verification', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockRejectedValue(new Error('API error'));

      const result = await service.verifyUser('user123', 'test_rule', 'address123');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('API error');
    });

    it('should handle data service errors in modern verification', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockRejectedValue(new Error('Network timeout'));

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Network timeout');
    });

    it('should handle numeric rule IDs', async () => {
      const numericRule: VerifierRole = { ...mockModernRule, id: 42 };
      mockDbService.getRuleById.mockResolvedValue(numericRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(5);

      const result = await service.verifyUser('user123', 42, 'address123');

      expect(mockDbService.getRuleById).toHaveBeenCalledWith('42');
      expect(result.ruleId).toBe(42);
    });
  });

  describe('verifyUserBulk', () => {
    it('should verify multiple rules successfully', async () => {
      mockDbService.getRuleById
        .mockResolvedValueOnce(mockRule)
        .mockResolvedValueOnce(mockModernRule);
      
      mockDataService.checkAssetOwnershipWithCriteria
        .mockResolvedValueOnce(2) // First rule passes
        .mockResolvedValueOnce(1); // Second rule fails (needs 3)

      const result = await service.verifyUserBulk('user123', ['test_rule', 'modern_rule'], 'address123');

      expect(result.userId).toBe('user123');
      expect(result.address).toBe('address123');
      expect(result.totalRules).toBe(2);
      expect(result.validRules).toHaveLength(1);
      expect(result.invalidRules).toHaveLength(1);
      expect(result.results).toHaveLength(2);
      expect(result.matchingAssetCounts.get('test_rule')).toBe(2); // Use actual rule ID from test call
      expect(result.matchingAssetCounts.has('modern_rule')).toBe(false); // Failed verification
    });

    it('should handle empty rule list', async () => {
      const result = await service.verifyUserBulk('user123', [], 'address123');

      expect(result.totalRules).toBe(0);
      expect(result.validRules).toHaveLength(0);
      expect(result.invalidRules).toHaveLength(0);
      expect(result.results).toHaveLength(0);
    });

    it('should handle mixed success and failure', async () => {
      mockDbService.getRuleById
        .mockResolvedValueOnce(mockModernRule)
        .mockRejectedValueOnce(new Error('Rule not found'));
      
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(5);

      const result = await service.verifyUserBulk('user123', ['good_rule', 'bad_rule'], 'address123');

      expect(result.totalRules).toBe(2);
      expect(result.validRules).toHaveLength(1);
      expect(result.results[0].isValid).toBe(true);
      expect(result.results[1].isValid).toBe(false);
    });
  });

  describe('verifyUserForServer', () => {
    it('should verify user against all server rules', async () => {
      const serverRules = [
        { id: 'rule1', server_id: 'server123' },
        { id: 'rule2', server_id: 'server123' }
      ];

      mockDbService.getRoleMappings.mockResolvedValue(serverRules);
      mockDbService.getRuleById
        .mockResolvedValueOnce(mockRule)
        .mockResolvedValueOnce(mockModernRule);
      
      mockDataService.checkAssetOwnershipWithCriteria
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(3);

      const result = await service.verifyUserForServer('user123', 'server123', 'address123');

      expect(mockDbService.getRoleMappings).toHaveBeenCalledWith('server123');
      expect(result.totalRules).toBe(2);
      expect(result.validRules).toHaveLength(2);
    });

    it('should handle server with no rules', async () => {
      mockDbService.getRoleMappings.mockResolvedValue([]);

      const result = await service.verifyUserForServer('user123', 'server123', 'address123');

      expect(result.totalRules).toBe(0);
      expect(result.validRules).toHaveLength(0);
    });
  });

  describe('verification logic', () => {
    it('should pass verification with any assets', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(1);

      const result = await service.verifyUser('user123', 'test_rule', 'address123');

      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        ['address123'],
        'test_collection',
        'test_attribute', 
        'ALL',
        1
      );
      expect(result.isValid).toBe(true);
    });

    it('should fail verification with no assets', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(0);

      const result = await service.verifyUser('user123', 'test_rule', 'address123');

      expect(result.isValid).toBe(false);
      expect(result.matchingAssetCount).toBe(0);
    });
  });

  describe('modern verification logic', () => {
    it('should pass modern verification with exact required assets', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        ['address123'],
        'cool-cats',
        'trait_type',
        'Rare',
        1
      );
      expect(result.isValid).toBe(true);
    });

    it('should pass modern verification with more than required assets', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(5);

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(result.isValid).toBe(true);
      expect(result.matchingAssetCount).toBe(5);
    });

    it('should fail modern verification with insufficient assets', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(2);

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(result.isValid).toBe(false);
      expect(result.matchingAssetCount).toBe(2);
    });

    it('should handle null/undefined rule attributes with defaults', async () => {
      const ruleWithNulls: VerifierRole = {
        id: 6,
        server_id: 'server123',
        server_name: 'Test Server',
        channel_id: 'channel123',
        channel_name: 'Test Channel',
        slug: 'some-collection', // Make it modern type
        attribute_key: null,
        attribute_value: null,
        min_items: null,
        role_id: 'role123',
        role_name: 'Test Role'
      };

      mockDbService.getRuleById.mockResolvedValue(ruleWithNulls);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(1);

      const result = await service.verifyUser('user123', 'rule_with_nulls', 'address123');

      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        ['address123'],
        'some-collection',
        'ALL',
        'ALL',
        1
      );
      expect(result.isValid).toBe(true);
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle exceptions during verification', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Unexpected error');
    });

    it('should handle malformed rule data', async () => {
      const malformedRule = {
        // Missing required fields but cast as unknown first then to VerifierRole
        id: 5,
        server_id: 'server123'
      } as unknown as VerifierRole;

      mockDbService.getRuleById.mockResolvedValue(malformedRule);

      const result = await service.verifyUser('user123', 'malformed', 'address123');

      // Should still attempt verification with defaults
    });

    it('should handle empty strings in addresses', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(0);

      const result = await service.verifyUser('user123', 'modern_rule', '');

      expect(result.address).toBe('');
      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        [''],
        'cool-cats',
        'trait_type',
        'Rare',
        1
      );
    });

    it('should handle very large asset counts', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(999999);

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(result.isValid).toBe(true);
      expect(result.matchingAssetCount).toBe(999999);
    });

    it('should handle negative asset counts gracefully', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(-1);

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(result.isValid).toBe(false);
      expect(result.matchingAssetCount).toBe(-1);
    });
  });

  describe('logging and debugging', () => {
    it('should log verification start and result', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);

      await service.verifyUser('user123', 'modern_rule', 'address123');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Starting verification for user user123')
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Verification PASSED - found 3 assets across 1 wallet(s), needed 3')
      );
    });

    it('should log bulk verification progress', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);

      await service.verifyUserBulk('user123', ['rule1', 'rule2'], 'address123');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Starting bulk verification for user user123 with 2 rules')
      );
    });
  });

  describe('interface compliance', () => {
    it('should return VerificationResult with all required fields', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);

      const result = await service.verifyUser('user123', 'modern_rule', 'address123');

      // Check all required fields are present
      expect(result).toHaveProperty('isValid');
      expect(result).toHaveProperty('userId');
      expect(result).toHaveProperty('ruleId');
      expect(result).toHaveProperty('address');

      // Check optional fields when verification succeeds
      expect(result).toHaveProperty('rule');
      expect(result).toHaveProperty('matchingAssetCount');
      expect(result).toHaveProperty('verificationDetails');

      // Verify types
      expect(typeof result.isValid).toBe('boolean');
    });

    it('should return BulkVerificationResult with all required fields', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockModernRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);

      const result = await service.verifyUserBulk('user123', ['rule1'], 'address123');

      // Check all required fields are present
      expect(result).toHaveProperty('userId');
      expect(result).toHaveProperty('address');
      expect(result).toHaveProperty('totalRules');
      expect(result).toHaveProperty('validRules');
      expect(result).toHaveProperty('invalidRules');
      expect(result).toHaveProperty('matchingAssetCounts');
      expect(result).toHaveProperty('results');

      // Verify types
      expect(Array.isArray(result.validRules)).toBe(true);
      expect(Array.isArray(result.invalidRules)).toBe(true);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.matchingAssetCounts instanceof Map).toBe(true);
    });
  });
});
