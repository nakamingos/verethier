import { WalletBlockService } from '../../src/services/wallet-block.service';
/**
 * VerificationService Integration Tests
 * 
 * These tests verify the VerificationService orchestration layer against 
 * a real local Supabase database. They test the service's ability to 
 * coordinate between the VerificationEngine, DbService, and DataService.
 * 
 * ⚠️ REQUIRES LOCAL SUPABASE INSTANCE
 * Run `yarn test:db` to execute with automatic Supabase management.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { VerificationService } from '../../src/services/verification.service';
import { VerificationEngine, VerificationResult, BulkVerificationResult } from '../../src/services/verification-engine.service';
import { DbService } from '../../src/services/db.service';
import { DataService } from '../../src/services/data.service';
import { DiscordVerificationService } from '../../src/services/discord-verification.service';
import { TestDatabase } from './test-database';

// Mock the DiscordVerificationService since we're testing DB integration, not Discord
const mockDiscordVerificationService = {
  assignRole: jest.fn().mockResolvedValue({ success: true }),
  removeRole: jest.fn().mockResolvedValue({ success: true }),
  notifyUser: jest.fn().mockResolvedValue({ success: true }),
};

describe('VerificationService - Integration Tests', () => {
  let verificationService: VerificationService;
  let verificationEngine: VerificationEngine;
  let dbService: DbService;
  let dataService: DataService;
  let testDb: TestDatabase;
  let isSupabaseHealthy = false;

  beforeAll(async () => {
    testDb = TestDatabase.getInstance();
    isSupabaseHealthy = await testDb.isHealthy();
    
    if (!isSupabaseHealthy) {
      console.warn('⚠️  Local Supabase not accessible. Skipping integration tests.');
    }
  });

  beforeEach(async () => {
    if (!isSupabaseHealthy) {
      return;
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: WalletBlockService, useValue: { allowedAddresses: async (_serverId, wallets) => wallets, assertAllowed: jest.fn().mockResolvedValue(undefined) } },
        VerificationService,
        VerificationEngine,
        DbService,
        DataService,
        {
          provide: DiscordVerificationService,
          useValue: mockDiscordVerificationService,
        },
      ],
    }).compile();

    verificationService = module.get<VerificationService>(VerificationService);
    verificationEngine = module.get<VerificationEngine>(VerificationEngine);
    dbService = module.get<DbService>(DbService);
    dataService = module.get<DataService>(DataService);

    // Clean up test data before each test
    await testDb.cleanupTestData();
  });

  afterEach(async () => {
    if (!isSupabaseHealthy) {
      return;
    }
    
    // Clean up test data after each test
    await testDb.cleanupTestData();
  });

  it('should be defined', () => {
    if (!isSupabaseHealthy) {
      console.log('⏭️ Skipping test: Supabase not available');
      return;
    }
    
    expect(verificationService).toBeDefined();
    expect(verificationEngine).toBeDefined();
    expect(dbService).toBeDefined();
    expect(dataService).toBeDefined();
  });

  describe('verifyUser (delegated to VerificationEngine)', () => {
    it('should delegate to VerificationEngine and return result', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test server and rule
      await testDb.createTestServer('test_server_delegate');
      const rule = await testDb.createTestRule('test_server_delegate');

      const result = await verificationService.verifyUser(
        'test_user_delegate',
        rule.id.toString(),
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result).toBeDefined();
      expect(result.userId).toBe('test_user_delegate');
      expect(result.ruleId).toBe(rule.id.toString());
      expect(result.address).toBe('0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4');
      expect(typeof result.isValid).toBe('boolean');
    });

    it('should handle string and number rule IDs', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      await testDb.createTestServer('test_server_id_types');
      const rule = await testDb.createTestRule('test_server_id_types');

      // Test with string ID
      const result1 = await verificationService.verifyUser(
        'test_user_str',
        rule.id.toString(),
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      // Test with number ID
      const result2 = await verificationService.verifyUser(
        'test_user_num',
        rule.id,
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result1.ruleId).toBe(rule.id.toString());
      expect(result2.ruleId).toBe(rule.id.toString());
    });
  });

  describe('verifyUserBulk', () => {
    it('should verify user against multiple rules', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test server and multiple rules
      await testDb.createTestServer('test_server_bulk_svc');
      const rule1 = await testDb.createTestRule('test_server_bulk_svc');
      
      const { data: rule2 } = await testDb.getClient()
        .from('verifier_rules')
        .insert({
          server_id: 'test_server_bulk_svc',
          server_name: 'Test Server',
          channel_id: 'test_channel_bulk2',
          channel_name: 'bulk-channel-2',
          slug: 'bulk-collection-2',
          role_id: 'test_role_bulk2',
          role_name: 'Bulk Role 2',
          attribute_key: 'bulk_trait_2',
          attribute_value: 'legendary',
          min_items: 1
        })
        .select()
        .single();

      const result = await verificationService.verifyUserBulk(
        'test_user_bulk_svc',
        [rule1.id.toString(), rule2.id.toString()],
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result).toBeDefined();
      expect(result.userId).toBe('test_user_bulk_svc');
      expect(result.address).toBe('0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4');
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results).toHaveLength(2);

      // Verify that results include both rules
      const ruleIds = result.results.map(r => r.ruleId);
      expect(ruleIds).toContain(rule1.id.toString());
      expect(ruleIds).toContain(rule2.id.toString());
    });

    it('should handle empty rule array', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const result = await verificationService.verifyUserBulk(
        'test_user_empty',
        [],
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result.results).toHaveLength(0);
    });
  });

  describe('verifyUserForServer', () => {
    it('should verify user against all server rules', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test server with multiple rules
      await testDb.createTestServer('test_server_for_server');
      const rule1 = await testDb.createTestRule('test_server_for_server');
      
      const { data: rule2 } = await testDb.getClient()
        .from('verifier_rules')
        .insert({
          server_id: 'test_server_for_server',
          server_name: 'Test Server',
          channel_id: 'test_channel_server2',
          channel_name: 'server-channel-2',
          slug: 'server-collection-2',
          role_id: 'test_role_server2',
          role_name: 'Server Role 2',
          attribute_key: 'server_trait_2',
          attribute_value: 'epic',
          min_items: 1
        })
        .select()
        .single();

      const result = await verificationService.verifyUserForServer(
        'test_user_for_server',
        'test_server_for_server',
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result).toBeDefined();
      expect(result.userId).toBe('test_user_for_server');
      expect(result.address).toBe('0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4');
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.length).toBeGreaterThanOrEqual(2);

      // Should include both rules we created
      const ruleIds = result.results.map(r => r.ruleId);
      expect(ruleIds).toContain(rule1.id.toString());
      expect(ruleIds).toContain(rule2.id.toString());
    });

    it('should handle server with no rules gracefully', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create server but no rules
      await testDb.createTestServer('test_server_no_rules');

      const result = await verificationService.verifyUserForServer(
        'test_user_no_rules',
        'test_server_no_rules',
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result).toBeDefined();
      expect(result.results).toHaveLength(0);
      expect(result.userId).toBe('test_user_no_rules');
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle invalid addresses gracefully', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      await testDb.createTestServer('test_server_invalid');
      const rule = await testDb.createTestRule('test_server_invalid');

      const result = await verificationService.verifyUser(
        'test_user_invalid',
        rule.id.toString(),
        'invalid_address'
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle non-existent rules', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const result = await verificationService.verifyUser(
        'test_user_nonexistent',
        'nonexistent_rule_id',
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle empty parameters', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const result = await verificationService.verifyUser('', '', '');

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('service orchestration', () => {
    it('should properly coordinate between engine and database', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test data
      await testDb.createTestServer('test_server_orchestration');
      const rule = await testDb.createTestRule('test_server_orchestration');

      // Verify that the service can successfully coordinate
      const result = await verificationService.verifyUser(
        'test_user_orchestration',
        rule.id.toString(),
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      // Should be able to get the same rule via DbService
      const rules = await dbService.getRoleMappings('test_server_orchestration');
      expect(rules.length).toBeGreaterThan(0);
      
      const foundRule = rules.find(r => r.id === rule.id);
      expect(foundRule).toBeDefined();
      expect(foundRule.server_id).toBe('test_server_orchestration');

      // Verification result should reference the same rule
      expect(result.ruleId).toBe(rule.id.toString());
    });
  });
});
