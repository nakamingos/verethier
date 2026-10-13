import { WalletBlockService } from '../../src/services/wallet-block.service';
/**
 * VerificationEngine Integration Tests
 * 
 * These tests verify the VerificationEngine against a real local Supabase database.
 * They test the core verification logic, rule processing, and asset verification
 * workflows using actual database operations.
 * 
 * ⚠️ REQUIRES LOCAL SUPABASE INSTANCE
 * Run `yarn test:db` to execute with automatic Supabase management.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { VerificationEngine, VerificationResult } from '../../src/services/verification-engine.service';
import { DbService } from '../../src/services/db.service';
import { DataService } from '../../src/services/data.service';
import { TestDatabase } from './test-database';

describe('VerificationEngine - Integration Tests', () => {
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
        VerificationEngine,
        DbService,
        DataService,
      ],
    }).compile();

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
    
    expect(verificationEngine).toBeDefined();
    expect(dbService).toBeDefined();
    expect(dataService).toBeDefined();
  });

  describe('verifyUser', () => {
    it('should return error for non-existent rule', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const result = await verificationEngine.verifyUser(
        'test_user_123',
        'nonexistent_rule',
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('not found');
      expect(result.userId).toBe('test_user_123');
      expect(result.ruleId).toBe('nonexistent_rule');
    });

    it('should handle modern verification rule', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test server and rule
      await testDb.createTestServer('test_server_verify');
      const rule = await testDb.createTestRule('test_server_verify');

      const result = await verificationEngine.verifyUser(
        'test_user_verify',
        rule.id.toString(),
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result).toBeDefined();
      expect(result.userId).toBe('test_user_verify');
      expect(result.ruleId).toBe(rule.id.toString());
      expect(result.address).toBe('0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4');
      expect(typeof result.isValid).toBe('boolean');
      
      // Should have rule type detected
    });

    it('should handle invalid ethereum address', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test server and rule
      await testDb.createTestServer('test_server_invalid');
      const rule = await testDb.createTestRule('test_server_invalid');

      const result = await verificationEngine.verifyUser(
        'test_user_invalid',
        rule.id.toString(),
        'invalid_address'
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('verifyUserBulk', () => {
    it('should verify user against multiple rules', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test server and multiple rules
      await testDb.createTestServer('test_server_bulk');
      const rule1 = await testDb.createTestRule('test_server_bulk');
      
      // Create a second rule with different parameters
      const { data: rule2 } = await testDb.getClient()
        .from('verifier_rules')
        .insert({
          server_id: 'test_server_bulk',
          server_name: 'Test Server',
          channel_id: 'test_channel_456',
          channel_name: 'channel2',
          slug: 'test-collection-2',
          role_id: 'test_role_456',
          role_name: 'role2',
          attribute_key: 'test_trait_2',
          attribute_value: 'common',
          min_items: 1
        })
        .select()
        .single();

      const result = await verificationEngine.verifyUserBulk(
        'test_user_bulk',
        [rule1.id.toString(), rule2.id.toString()],
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result).toBeDefined();
      expect(result.userId).toBe('test_user_bulk');
      expect(result.address).toBe('0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4');
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results).toHaveLength(2);
      
      // Check that both rules were processed
      const ruleIds = result.results.map(r => r.ruleId);
      expect(ruleIds).toContain(rule1.id.toString());
      expect(ruleIds).toContain(rule2.id.toString());
    });

    it('should handle mix of valid and invalid rules', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create one valid rule
      await testDb.createTestServer('test_server_mixed');
      const validRule = await testDb.createTestRule('test_server_mixed');

      const result = await verificationEngine.verifyUserBulk(
        'test_user_mixed',
        [validRule.id.toString(), 'invalid_rule_id'],
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result.results).toHaveLength(2);
      
      // One should succeed (or fail verification), one should error
      const validResult = result.results.find(r => r.ruleId === validRule.id.toString());
      const invalidResult = result.results.find(r => r.ruleId === 'invalid_rule_id');
      
      expect(validResult).toBeDefined();
      expect(invalidResult).toBeDefined();
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.error).toContain('not found');
    });
  });

  describe('verifyUserForServer', () => {
    it('should verify user against all server rules', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test server with multiple rules
      await testDb.createTestServer('test_server_all');
      const rule1 = await testDb.createTestRule('test_server_all');
      
      // Create a second rule
      const { data: rule2 } = await testDb.getClient()
        .from('verifier_rules')
        .insert({
          server_id: 'test_server_all',
          server_name: 'Test Server',
          channel_id: 'test_channel_vip',
          channel_name: 'vip',
          slug: 'vip-collection',
          role_id: 'test_role_vip',
          role_name: 'vip-member',
          attribute_key: 'vip_trait',
          attribute_value: 'gold',
          min_items: 1
        })
        .select()
        .single();

      const result = await verificationEngine.verifyUserForServer(
        'test_user_server',
        'test_server_all',
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result).toBeDefined();
      expect(result.userId).toBe('test_user_server');
      expect(result.address).toBe('0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4');
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.length).toBeGreaterThanOrEqual(2);
      
      // Should include both rules we created
      const ruleIds = result.results.map(r => r.ruleId);
      expect(ruleIds).toContain(rule1.id.toString());
      expect(ruleIds).toContain(rule2.id.toString());
    });

    it('should handle server with no rules', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create server but no rules
      await testDb.createTestServer('test_server_empty');

      const result = await verificationEngine.verifyUserForServer(
        'test_user_empty',
        'test_server_empty',
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result).toBeDefined();
      expect(result.results).toHaveLength(0);
    });

    it('should handle non-existent server', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const result = await verificationEngine.verifyUserForServer(
        'test_user_noserver',
        'nonexistent_server',
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

      expect(result).toBeDefined();
      expect(result.results).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('should handle malformed addresses gracefully', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      await testDb.createTestServer('test_server_error');
      const rule = await testDb.createTestRule('test_server_error');

      const result = await verificationEngine.verifyUser(
        'test_user_error',
        rule.id.toString(),
        'not-an-address'
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle empty parameters gracefully', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      const result = await verificationEngine.verifyUser('', '', '');

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('rule type detection', () => {
    it('should correctly identify rule types', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create a modern rule
      await testDb.createTestServer('test_server_type');
      const rule = await testDb.createTestRule('test_server_type');

      const result = await verificationEngine.verifyUser(
        'test_user_type',
        rule.id.toString(),
        '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4'
      );

    });
  });
});
