import { VerificationEngine } from '../src/services/verification-engine.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { NftOwnershipService } from '../src/services/nft-ownership.service';
/**
 * DynamicRoleService Unit Tests
 * 
 * Comprehensive unit test suite for the DynamicRoleService class.
 * Tests scheduled re-verification, manual verification, and role management.
 * 
 * Coverage Goals:
 * - Scheduled re-verification logic
 * - Manual re-verification operations
 * - Role revocation and status updates
 * - Error handling and edge cases
 * - Rate limiting and batch processing
 * - Statistics and monitoring
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { DbService } from '../src/services/db.service';
import { DataService } from '../src/services/data.service';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { DiscordService } from '../src/services/discord.service';
import { UserAddressService } from '../src/services/user-address.service';

describe('DynamicRoleService', () => {
  let service: DynamicRoleService;
  let module: TestingModule;
  let mockDbService: jest.Mocked<DbService>;
  let mockDataService: jest.Mocked<DataService>;
  let mockDiscordVerificationService: jest.Mocked<DiscordVerificationService>;
  let mockDiscordService: jest.Mocked<DiscordService>;
  let mockUserAddressService: jest.Mocked<UserAddressService>;
  let loggerSpy: jest.SpyInstance;

  const mockActiveAssignment = {
    id: 'assignment123',
    user_id: 'user123',
    user_name: 'TestUser',
    server_id: 'server123',
    role_id: 'role123',
    role_name: 'Test Role',
    rule_id: 'rule123',
    address: 'address123',
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
    last_checked: '2024-01-01T00:00:00Z'
  };

  const mockRule = {
    id: 'rule123',
    server_id: 'server123',
    slug: 'cool-cats',
    attribute_key: 'trait_type',
    attribute_value: 'Rare',
    min_items: 2
  };

  beforeEach(async () => {
    const mockDbServiceValue = {
      getActiveRoleAssignments: jest.fn(),
      getRuleById: jest.fn(),
      getRoleMappings: jest.fn().mockImplementation(async () => {
        const rule = await mockDbServiceValue.getRuleById('rule123');
        return rule ? [{ ...rule, role_id: 'role123' }] : [];
      }),
      saveRoleCheckDetails: jest.fn(),
      updateRoleAssignmentStatus: jest.fn(),
      updateLastVerified: jest.fn(),
      getUserActiveAssignments: jest.fn(),
      getRuleActiveAssignments: jest.fn(),
      countActiveAssignments: jest.fn(),
      countRevokedAssignments: jest.fn(),
      countExpiringSoonAssignments: jest.fn(),
      getLastReverificationTime: jest.fn(),
    };

    const mockDataServiceValue = {
      checkAssetOwnershipWithCriteria: jest.fn(),
    };

    const mockDiscordVerificationServiceValue = {
      removeUserRole: jest.fn(),
    };

    const mockDiscordServiceValue = {
      // Add any methods if needed
    };

    const mockUserAddressServiceValue = {
      getUserAddresses: jest.fn().mockResolvedValue(['address123']),
    };

    module = await Test.createTestingModule({
      providers: [
        VerificationEngine,
        AssetOwnershipService,
        { provide: NftOwnershipService, useValue: { count: jest.fn() } },
        DynamicRoleService,
        { provide: DbService, useValue: mockDbServiceValue },
        { provide: DataService, useValue: mockDataServiceValue },
        { provide: DiscordVerificationService, useValue: mockDiscordVerificationServiceValue },
        { provide: DiscordService, useValue: mockDiscordServiceValue },
        { provide: UserAddressService, useValue: mockUserAddressServiceValue }
      ],
    }).compile();

    service = module.get<DynamicRoleService>(DynamicRoleService);
    mockDbService = module.get(DbService);
    mockDataService = module.get(DataService);
    mockDiscordVerificationService = module.get(DiscordVerificationService);
    mockDiscordService = module.get(DiscordService);
    mockUserAddressService = module.get(UserAddressService);
    
    loggerSpy = jest.spyOn(Logger, 'log').mockImplementation();
    jest.spyOn(Logger, 'debug').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
    jest.spyOn(Logger, 'warn').mockImplementation();

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (loggerSpy && loggerSpy.mockRestore) {
      loggerSpy.mockRestore();
    }
  });

  describe('performScheduledReverification', () => {
    it('should successfully re-verify all active assignments', async () => {
      const mockAssignments = [
        { ...mockActiveAssignment, id: 'assign1' },
        { ...mockActiveAssignment, id: 'assign2' }
      ];

      mockDbService.getActiveRoleAssignments.mockResolvedValue(mockAssignments);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3); // Qualifies
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDbService.getActiveRoleAssignments).toHaveBeenCalled();
      expect(mockDbService.getRuleById).toHaveBeenCalledTimes(2);
      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledTimes(2);
      expect(mockDbService.updateLastVerified).toHaveBeenCalledTimes(2);
      expect(loggerSpy).toHaveBeenCalledWith('🔄 Starting scheduled role re-verification');
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('2 verified, 0 revoked, 0 errors'));
    });

    it('should revoke roles when users no longer qualify', async () => {
      const mockAssignments = [mockActiveAssignment];

      mockDbService.getActiveRoleAssignments.mockResolvedValue(mockAssignments);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(1); // Below required 2
      mockDiscordVerificationService.removeUserRole.mockResolvedValue(undefined);
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDiscordVerificationService.removeUserRole).toHaveBeenCalledWith(
        'user123',
        'server123',
        'role123'
      );
      expect(mockDbService.updateRoleAssignmentStatus).toHaveBeenCalledWith('assignment123', 'revoked');
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('0 verified, 1 revoked, 0 errors'));
    });

    it('should handle missing rules gracefully', async () => {
      const mockAssignments = [mockActiveAssignment];

      mockDbService.getActiveRoleAssignments.mockResolvedValue(mockAssignments);
      mockDbService.getRuleById.mockResolvedValue(null);
      mockDiscordVerificationService.removeUserRole.mockResolvedValue(undefined);
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDiscordVerificationService.removeUserRole).toHaveBeenCalled();
      expect(mockDbService.updateRoleAssignmentStatus).toHaveBeenCalledWith('assignment123', 'revoked');
    });

    it('should handle individual assignment errors without stopping', async () => {
      const mockAssignments = [
        { ...mockActiveAssignment, id: 'assign1' },
        { ...mockActiveAssignment, id: 'assign2' }
      ];

      mockDbService.getActiveRoleAssignments.mockResolvedValue(mockAssignments);
      mockDbService.getRuleById
        .mockResolvedValueOnce(mockRule)
        .mockRejectedValueOnce(new Error('Database error'));
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDbService.updateLastVerified).toHaveBeenCalledTimes(1); // Failed checks do not advance success timestamps
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('1 verified, 0 revoked, 1 errors'));
    });

    it('should handle empty assignments list', async () => {
      mockDbService.getActiveRoleAssignments.mockResolvedValue([]);

      await service.performScheduledReverification();

      expect(loggerSpy).toHaveBeenCalledWith('Found 0 active role assignments to verify');
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('0 verified, 0 revoked, 0 errors'));
    });

    it('should handle top-level errors gracefully', async () => {
      mockDbService.getActiveRoleAssignments.mockRejectedValue(new Error('Database connection failed'));

      await service.performScheduledReverification();

      expect(Logger.error).toHaveBeenCalledWith(
        'Failed to perform scheduled re-verification:',
        expect.any(Error)
      );
    });

    it('should process assignments in batches', async () => {
      // Create more than 10 assignments to test batching
      const mockAssignments = Array.from({ length: 15 }, (_, i) => ({
        ...mockActiveAssignment,
        id: `assign${i}`
      }));

      mockDbService.getActiveRoleAssignments.mockResolvedValue(mockAssignments);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDbService.getRuleById).toHaveBeenCalledTimes(15);
      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledTimes(15);
    });
  });

  describe('reverifyUser', () => {
    it('should manually re-verify user across all servers', async () => {
      const userAssignments = [
        { ...mockActiveAssignment, id: 'assign1' },
        { ...mockActiveAssignment, id: 'assign2' }
      ];

      mockDbService.getUserActiveAssignments.mockResolvedValue(userAssignments);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      const result = await service.reverifyUser('user123');

      expect(result.verified).toBe(2);
      expect(result.revoked).toBe(0);
      expect(mockDbService.getUserActiveAssignments).toHaveBeenCalledWith('user123');
      expect(loggerSpy).toHaveBeenCalledWith('🔍 Manual re-verification for user user123');
    });

    it('should revoke roles when user no longer qualifies', async () => {
      const userAssignments = [mockActiveAssignment];

      mockDbService.getUserActiveAssignments.mockResolvedValue(userAssignments);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(1); // Below required 2
      mockDiscordVerificationService.removeUserRole.mockResolvedValue(undefined);
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      const result = await service.reverifyUser('user123');

      expect(result.verified).toBe(0);
      expect(result.revoked).toBe(1);
    });

    it('should handle errors during manual re-verification', async () => {
      const userAssignments = [mockActiveAssignment];

      mockDbService.getUserActiveAssignments.mockResolvedValue(userAssignments);
      mockDbService.getRuleById.mockRejectedValue(new Error('Rule fetch failed'));

      const result = await service.reverifyUser('user123');

      expect(result.verified).toBe(0); // Unavailable checks retain roles without recording success
      expect(result.revoked).toBe(0);
      expect(Logger.error).toHaveBeenCalledWith(
        'Error during manual re-verification:',
        'Rule fetch failed'
      );
    });

    it('should handle user with no active assignments', async () => {
      mockDbService.getUserActiveAssignments.mockResolvedValue([]);

      const result = await service.reverifyUser('user123');

      expect(result.verified).toBe(0);
      expect(result.revoked).toBe(0);
    });
  });

  describe('reverifyRule', () => {
    it('should re-verify all assignments for a rule', async () => {
      const ruleAssignments = [
        { ...mockActiveAssignment, id: 'assign1' },
        { ...mockActiveAssignment, id: 'assign2' }
      ];

      mockDbService.getRuleActiveAssignments.mockResolvedValue(ruleAssignments);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria
        .mockResolvedValueOnce(3) // First user qualifies
        .mockResolvedValueOnce(1); // Second user doesn't qualify
      mockDbService.updateLastVerified.mockResolvedValue(undefined);
      mockDiscordVerificationService.removeUserRole.mockResolvedValue(undefined);
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      await service.reverifyRule('rule123');

      expect(mockDbService.getRuleActiveAssignments).toHaveBeenCalledWith('rule123');
      expect(mockDiscordVerificationService.removeUserRole).toHaveBeenCalledTimes(1);
      expect(loggerSpy).toHaveBeenCalledWith('🔍 Re-verifying all assignments for rule rule123');
    });

    it('should handle errors during rule re-verification', async () => {
      const ruleAssignments = [mockActiveAssignment];

      mockDbService.getRuleActiveAssignments.mockResolvedValue(ruleAssignments);
      mockDbService.getRuleById.mockRejectedValue(new Error('Rule not found'));

      await service.reverifyRule('rule123');

      expect(Logger.error).toHaveBeenCalledWith(
        'Error re-verifying rule assignment:',
        'Rule not found'
      );
    });

    it('should handle rule with no assignments', async () => {
      mockDbService.getRuleActiveAssignments.mockResolvedValue([]);

      await service.reverifyRule('rule123');

      expect(mockDbService.getRuleById).not.toHaveBeenCalled();
    });
  });

  describe('verifyUserStillQualifies', () => {
    it('should return true when user still qualifies', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);

      // Access private method through performScheduledReverification
      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        ['address123'],
        'cool-cats',
        'trait_type',
        'Rare',
        1
      );
      expect(mockDbService.updateLastVerified).toHaveBeenCalledWith('assignment123');
    });

    it('should return false when user no longer qualifies', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(1); // Below required 2

      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDiscordVerificationService.removeUserRole.mockResolvedValue(undefined);
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDiscordVerificationService.removeUserRole).toHaveBeenCalled();
    });

    it('should handle missing rule gracefully', async () => {
      mockDbService.getRuleById.mockResolvedValue(null);

      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDiscordVerificationService.removeUserRole.mockResolvedValue(undefined);
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDbService.saveRoleCheckDetails).toHaveBeenCalledWith('assignment123', expect.objectContaining({ last_check_status: 'failed' }));
      expect(mockDiscordVerificationService.removeUserRole).toHaveBeenCalled();
    });

    it('should be conservative on API errors', async () => {
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockRejectedValue(new Error('API timeout'));

      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDiscordVerificationService.removeUserRole).not.toHaveBeenCalled();
      expect(mockDbService.updateLastVerified).not.toHaveBeenCalled();
      expect(mockDbService.saveRoleCheckDetails).toHaveBeenCalledWith('assignment123', expect.objectContaining({ last_check_status: 'unavailable' }));
    });

    it('should handle default min_items', async () => {
      const ruleWithoutMinItems = { ...mockRule, min_items: null };
      mockDbService.getRuleById.mockResolvedValue(ruleWithoutMinItems);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(1);

      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        ['address123'],
        'cool-cats',
        'trait_type',
        'Rare',
        1 // Default value
      );
    });
  });

  describe('revokeRole', () => {
    it('should successfully revoke role from Discord and update database', async () => {
      mockDiscordVerificationService.removeUserRole.mockResolvedValue(undefined);
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      // Test through scheduled re-verification
      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(0); // Doesn't qualify

      await service.performScheduledReverification();

      expect(mockDiscordVerificationService.removeUserRole).toHaveBeenCalledWith(
        'user123',
        'server123',
        'role123'
      );
      expect(mockDbService.updateRoleAssignmentStatus).toHaveBeenCalledWith('assignment123', 'revoked');
      expect(loggerSpy).toHaveBeenCalledWith(
        'Successfully revoked role role123 from user user123'
      );
    });

    it('should mark as expired if Discord removal fails', async () => {
      mockDiscordVerificationService.removeUserRole.mockRejectedValue(new Error('Discord API error'));
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(0);

      await service.performScheduledReverification();

      expect(mockDbService.updateRoleAssignmentStatus).toHaveBeenCalledWith('assignment123', 'expired');
      expect(Logger.error).toHaveBeenCalledWith(
        'Failed to revoke role:',
        'Discord API error'
      );
    });
  });

  describe('getRoleAssignmentStats', () => {
    it('should return comprehensive assignment statistics', async () => {
      mockDbService.countActiveAssignments.mockResolvedValue(100);
      mockDbService.countRevokedAssignments.mockResolvedValue(25);
      mockDbService.countExpiringSoonAssignments.mockResolvedValue(5);
      mockDbService.getLastReverificationTime.mockResolvedValue('2024-01-01T12:00:00Z');

      const stats = await service.getRoleAssignmentStats();

      expect(stats).toEqual({
        totalActive: 100,
        totalRevoked: 25,
        expiringSoon: 5,
        lastReverificationRun: '2024-01-01T12:00:00Z'
      });
    });

    it('should handle null values gracefully', async () => {
      mockDbService.countActiveAssignments.mockResolvedValue(0);
      mockDbService.countRevokedAssignments.mockResolvedValue(0);
      mockDbService.countExpiringSoonAssignments.mockResolvedValue(0);
      mockDbService.getLastReverificationTime.mockResolvedValue(null);

      const stats = await service.getRoleAssignmentStats();

      expect(stats).toEqual({
        totalActive: 0,
        totalRevoked: 0,
        expiringSoon: 0,
        lastReverificationRun: null
      });
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle undefined rule properties gracefully', async () => {
      const incompleteRule = {
        id: 'rule123',
        server_id: 'server123',
        slug: undefined,
        attribute_key: undefined,
        attribute_value: undefined,
        min_items: undefined
      };

      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.getRuleById.mockResolvedValue(incompleteRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(1);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        ['address123'],
        'ALL',
        'ALL',
        'ALL',
        1 // Default value for undefined min_items
      );
    });

    it('should handle empty assignment addresses', async () => {
      const assignmentWithEmptyAddress = { ...mockActiveAssignment, address: '' };

      mockDbService.getActiveRoleAssignments.mockResolvedValue([assignmentWithEmptyAddress]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(0);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);
      
      // Mock getUserAddresses to return empty string for this test
      mockUserAddressService.getUserAddresses.mockResolvedValue(['']);

      await service.performScheduledReverification();

      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        [''],
        'cool-cats',
        'trait_type',
        'Rare',
        1
      );
      
      mockUserAddressService.getUserAddresses.mockResolvedValue(['address123']);
    });

    it('should handle very large batch sizes', async () => {
      const largeAssignmentList = Array.from({ length: 100 }, (_, i) => ({
        ...mockActiveAssignment,
        id: `assign${i}`
      }));

      mockDbService.getActiveRoleAssignments.mockResolvedValue(largeAssignmentList);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDbService.getRuleById).toHaveBeenCalledTimes(100);
      expect(mockDataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledTimes(100);
    });

    it('should handle concurrent verification requests', async () => {
      mockDbService.getUserActiveAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      // Run multiple verifications concurrently
      const promises = [
        service.reverifyUser('user1'),
        service.reverifyUser('user2'),
        service.reverifyUser('user3')
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result).toHaveProperty('verified');
        expect(result).toHaveProperty('revoked');
      });
    });

    it('should handle network timeouts gracefully', async () => {
      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Network timeout')), 100)
        )
      );
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(mockDiscordVerificationService.removeUserRole).not.toHaveBeenCalled();
      expect(mockDbService.updateLastVerified).not.toHaveBeenCalled();
      expect(mockDbService.saveRoleCheckDetails).toHaveBeenCalledWith('assignment123', expect.objectContaining({ last_check_status: 'unavailable' }));
    });

    it('should handle null or undefined assignment data', async () => {
      const nullAssignment = null as any;
      const undefinedAssignment = undefined as any;

      mockDbService.getActiveRoleAssignments.mockResolvedValue([
        mockActiveAssignment,
        nullAssignment,
        undefinedAssignment
      ]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      // Should handle only the valid assignment
      expect(mockDbService.getRuleById).toHaveBeenCalledTimes(1);
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('1 verified, 0 revoked, 0 errors'));
    });
  });

  describe('logging and monitoring', () => {
    it('should log detailed verification progress', async () => {
      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(loggerSpy).toHaveBeenCalledWith('🔄 Starting scheduled role re-verification');
      expect(loggerSpy).toHaveBeenCalledWith('Found 1 active role assignments to verify');
      // Note: Detailed user qualification logs may not be present in current implementation
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('🏁 Re-verification complete: 1 verified, 0 revoked, 0 errors')
      );
    });

    it('should log role revocations with user-friendly names', async () => {
      mockDbService.getActiveRoleAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(0);
      mockDiscordVerificationService.removeUserRole.mockResolvedValue(undefined);
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      await service.performScheduledReverification();

      expect(loggerSpy).toHaveBeenCalledWith(
        '🚫 Revoked role Test Role from user TestUser'
      );
    });

    it('should log manual verification progress', async () => {
      mockDbService.getUserActiveAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(3);
      mockDbService.updateLastVerified.mockResolvedValue(undefined);

      await service.reverifyUser('user123');

      expect(loggerSpy).toHaveBeenCalledWith('🔍 Manual re-verification for user user123');
      expect(loggerSpy).toHaveBeenCalledWith(
        'Manual re-verification complete for user user123: 1 verified, 0 revoked'
      );
    });

    it('should log rule re-verification progress', async () => {
      mockDbService.getRuleActiveAssignments.mockResolvedValue([mockActiveAssignment]);
      mockDbService.getRuleById.mockResolvedValue(mockRule);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(0);
      mockDiscordVerificationService.removeUserRole.mockResolvedValue(undefined);
      mockDbService.updateRoleAssignmentStatus.mockResolvedValue(undefined);

      await service.reverifyRule('rule123');

      expect(loggerSpy).toHaveBeenCalledWith('🔍 Re-verifying all assignments for rule rule123');
      expect(loggerSpy).toHaveBeenCalledWith(
        'Revoked role from user user123 due to rule change'
      );
    });
  });
});
