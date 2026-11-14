import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '../../src/services/db.service';
import { TestDatabase } from './test-database';

/**
 * ⚠️ IMPORTANT: DATABASE TESTS REQUIRE LOCAL SUPABASE INSTANCE
 * 
 * These tests require a local Supabase instance to be running.
 * To start Supabase locally, run: `supabase start`
 * 
 * If Supabase is not running, these tests will be skipped automatically.
 * 
 * The tests interact with the bot's storage database (db), not the public 
 * read-only database (data). Only write tests for the db service, not data service.
 */

describe('DbService - Integration Tests', () => {
  let service: DbService;
  let testDb: TestDatabase;
  let isSupabaseHealthy = false;

  beforeAll(async () => {
    testDb = TestDatabase.getInstance();
    
    // Check if local Supabase is running
    isSupabaseHealthy = await testDb.isHealthy();
    if (!isSupabaseHealthy) {
      console.warn('⚠️  Local Supabase not accessible. Skipping integration tests.');
    }
  });

  beforeEach(async () => {
    // Always try to create the module, but handle the case where Supabase isn't healthy
    try {
      const module: TestingModule = await Test.createTestingModule({
        providers: [DbService],
      }).compile();

      service = module.get<DbService>(DbService);
    } catch (error) {
      // If service creation fails, Supabase might not be available
      console.warn('⚠️  Could not create DbService. Supabase may not be available.');
      isSupabaseHealthy = false;
      service = undefined;
    }
    
    if (!isSupabaseHealthy) {
      return; // Skip setup if Supabase isn't healthy
    }
    
    // Clean up test data before each test
    await testDb.cleanupTestData();
  });

  afterEach(async () => {
    if (!isSupabaseHealthy) {
      return; // Skip cleanup if Supabase isn't healthy
    }
    
    // Clean up test data after each test
    await testDb.cleanupTestData();
  });

  it('should be defined', () => {
    if (!isSupabaseHealthy) {
      return; // Skip this test
    }
    expect(service).toBeDefined();
  });

  describe('addRoleMapping', () => {
    beforeEach(async () => {
      if (!isSupabaseHealthy) {
        return; // Skip setup if Supabase isn't healthy
      }
      // Create a test server first
      await testDb.createTestServer('test_server_mapping');
    });

    it('should add role mapping with all parameters', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }
      const result = await service.addRoleMapping(
        'test_server_mapping',
        'Test Server',
        'test_channel_123',
        'test-channel',
        'test-collection',
        'test_role_123',
        'Test Role',
        'trait_type',
        'rare',
        2
      );

      expect(result).toBeDefined();
      expect(result.server_id).toBe('test_server_mapping');
      expect(result.channel_id).toBe('test_channel_123');
      expect(result.slug).toBe('test-collection');
      expect(result.min_items).toBe(2);
    });

    it('should handle default values for optional parameters', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }
      
      const result = await service.addRoleMapping(
        'test_server_mapping',
        'Test Server',
        'test_channel_default',
        'test-channel',
        '', // Empty slug should become 'ALL'
        'test_role_default',
        'Test Role',
        '',
        '',
        null
      );

      expect(result).toBeDefined();
      expect(result.slug).toBe('ALL');
      expect(result.min_items).toBe(1);
    });
  });

  describe('getRoleMappings', () => {
    beforeEach(async () => {
      if (!isSupabaseHealthy) {
        return; // Skip setup if Supabase isn't healthy
      }
      await testDb.createTestServer('test_server_get');
      await testDb.createTestRule('test_server_get');
    });

    it('should return role mappings for server', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }
      
      const result = await service.getRoleMappings('test_server_get');

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].server_id).toBe('test_server_get');
    });

    it('should filter by channel when provided', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }
      
      const result = await service.getRoleMappings('test_server_get', 'test_channel_123');

      expect(Array.isArray(result)).toBe(true);
      if (result.length > 0) {
        expect(result[0].channel_id).toBe('test_channel_123');
      }
    });
  });

  describe('deleteRoleMapping', () => {
    it('should delete role mapping', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }
      
      // Create test data first
      await testDb.createTestServer('test_server_delete');
      const rule = await testDb.createTestRule('test_server_delete');

      // Delete the rule
      await expect(
        service.deleteRoleMapping(rule.id.toString(), 'test_server_delete')
      ).resolves.not.toThrow();

      // Verify it's deleted
      const remaining = await service.getRoleMappings('test_server_delete');
      expect(remaining.some(r => r.id === rule.id)).toBe(false);
    });
  });

  describe('service structure validation', () => {
    it('should have all required methods', () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }
      
      expect(typeof service.addRoleMapping).toBe('function');
      expect(typeof service.getRoleMappings).toBe('function');
      expect(typeof service.deleteRoleMapping).toBe('function');
      expect(typeof service.getAllRulesForServer).toBe('function');
      expect(typeof service.getRulesByChannel).toBe('function');
      expect(typeof service.checkForDuplicateRule).toBe('function');
      expect(typeof service.checkForExactDuplicateRule).toBe('function');
    });
  });

  describe('checkForDuplicateRule', () => {
    it('should find existing rule with same criteria for different role', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // First, create a rule
      const existingRule = await service.addRoleMapping(
        'test_server',
        'Test Server',
        'test_channel',
        'Test Channel',
        'test-collection',
        'existing-role-id',
        'Existing Role',
        'Gold',
        'rare',
        1
      );

      expect(existingRule).toBeDefined();

      // Now check for duplicate with different role
      const duplicateRule = await service.checkForDuplicateRule(
        'test_server',
        'test_channel',
        'test-collection',
        'Gold',
        'rare',
        1,
        'different-role-id' // Different role ID
      );

      expect(duplicateRule).toBeDefined();
      expect(duplicateRule.role_id).toBe('existing-role-id');
      expect(duplicateRule.slug).toBe('test-collection');
      expect(duplicateRule.attribute_key).toBe('Gold');
      expect(duplicateRule.attribute_value).toBe('rare');
      expect(duplicateRule.min_items).toBe(1);
    });

    it('should return null when no duplicate found', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const result = await service.checkForDuplicateRule(
        'test_server',
        'test_channel',
        'unique-collection',
        'Unique',
        'value',
        99
      );

      expect(result).toBeNull();
    });

    it('should exclude same role when checking for duplicates', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create a rule
      const existingRule = await service.addRoleMapping(
        'test_server',
        'Test Server',
        'test_channel',
        'Test Channel',
        'same-collection',
        'same-role-id',
        'Same Role',
        'Silver',
        'common',
        2
      );

      expect(existingRule).toBeDefined();

      // Check for duplicate with same role ID (should return null)
      const duplicateRule = await service.checkForDuplicateRule(
        'test_server',
        'test_channel',
        'same-collection',
        'Silver',
        'common',
        2,
        'same-role-id' // Same role ID - should be excluded
      );

      expect(duplicateRule).toBeNull();
    });
  });

  describe('checkForExactDuplicateRule', () => {
    it('should find exact duplicate rule (same role + same criteria)', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // First, create a rule
      await service.addRoleMapping(
        'test_server_exact_dup',
        'Test Server',
        'test_channel_exact_dup',
        'Test Channel',
        'test-collection',
        'test-role-id',
        'Test Role',
        'Gold',
        'rare',
        1
      );

      // Try to find exact duplicate
      const exactDuplicate = await service.checkForExactDuplicateRule(
        'test_server_exact_dup',
        'test_channel_exact_dup',
        'test-collection',
        'Gold',
        'rare',
        1,
        'test-role-id' // Same role ID - should find the exact match
      );

      expect(exactDuplicate).toBeDefined();
      expect(exactDuplicate.server_id).toBe('test_server_exact_dup');
      expect(exactDuplicate.role_id).toBe('test-role-id');
    });

    it('should not find duplicate when role is different', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // First, create a rule
      await service.addRoleMapping(
        'test_server_diff_role',
        'Test Server',
        'test_channel_diff_role',
        'Test Channel',
        'test-collection',
        'original-role-id',
        'Original Role',
        'Gold',
        'rare',
        1
      );

      // Try to find exact duplicate with different role
      const exactDuplicate = await service.checkForExactDuplicateRule(
        'test_server_diff_role',
        'test_channel_diff_role',
        'test-collection',
        'Gold',
        'rare',
        1,
        'different-role-id' // Different role ID - should not find match
      );

      expect(exactDuplicate).toBeNull();
    });
  });

  describe('Advanced Rule Management', () => {
    it('should get all rules for server', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const serverId = 'test_server_all_rules';

      // Add multiple rules
      await service.addRoleMapping(
        serverId, 'All Rules Server', 'channel_1', 'Channel 1',
        'collection-1', 'role_1', 'Role 1', 'trait', 'rare', 1
      );

      await service.addRoleMapping(
        serverId, 'All Rules Server', 'channel_2', 'Channel 2',
        'collection-2', 'role_2', 'Role 2', 'trait', 'epic', 2
      );

      const rules = await service.getAllRulesForServer(serverId);

      expect(Array.isArray(rules)).toBe(true);
      expect(rules.length).toBeGreaterThanOrEqual(2);
      expect(rules.every(rule => rule.server_id === serverId)).toBe(true);
    });

  });

  describe('Channel Rule Methods', () => {
    it('should get rules by channel', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const serverId = 'test_server_channel_rules';
      const channelId = 'channel_rules_test';


      // Add multiple rules to the same channel
      await service.addRoleMapping(
        serverId, 'Channel Rules Server', channelId, 'Rules Channel',
        'collection-1', 'role_1', 'Role 1', 'trait', 'rare', 1
      );

      await service.addRoleMapping(
        serverId, 'Channel Rules Server', channelId, 'Rules Channel',
        'collection-2', 'role_2', 'Role 2', 'trait', 'epic', 2
      );

      // Add rule to different channel for comparison
      await service.addRoleMapping(
        serverId, 'Channel Rules Server', 'other_channel', 'Other Channel',
        'collection-3', 'role_3', 'Role 3', 'trait', 'legendary', 3
      );

      const channelRules = await service.getRulesByChannel(serverId, channelId);

      expect(Array.isArray(channelRules)).toBe(true);
      expect(channelRules.length).toBeGreaterThanOrEqual(2);
      expect(channelRules.every(rule => rule.channel_id === channelId)).toBe(true);
      expect(channelRules.every(rule => rule.server_id === serverId)).toBe(true);
    });

    it('should return empty array for channel with no rules', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const result = await service.getRulesByChannel('nonexistent_server', 'nonexistent_channel');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });
});
