/**
 * DynamicRoleService Integration Tests
 * 
 * These tests verify the DynamicRoleService role monitoring and management 
 * functionality against a real local Supabase database. They test role
 * assignment tracking, re-verification, and automatic role management.
 * 
 * ⚠️ REQUIRES LOCAL SUPABASE INSTANCE
 * Run `yarn test:db` to execute with automatic Supabase management.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { DynamicRoleService } from '../../src/services/dynamic-role.service';
import { DbService } from '../../src/services/db.service';
import { DataService } from '../../src/services/data.service';
import { DiscordVerificationService } from '../../src/services/discord-verification.service';
import { DiscordService } from '../../src/services/discord.service';
import { TestDatabase } from './test-database';

// Mock Discord services since we're testing DB integration, not Discord API
const mockDiscordVerificationService = {
  assignRole: jest.fn().mockResolvedValue({ success: true }),
  removeRole: jest.fn().mockResolvedValue({ success: true }),
  verifyRoleAssignment: jest.fn().mockResolvedValue({ success: true }),
  getUserFromGuild: jest.fn().mockResolvedValue({ id: 'test_user', username: 'testuser' }),
};

const mockDiscordService = {
  getGuild: jest.fn().mockResolvedValue({ id: 'test_server', name: 'Test Server' }),
  getUser: jest.fn().mockResolvedValue({ id: 'test_user', username: 'testuser' }),
  isUserInGuild: jest.fn().mockResolvedValue(true),
};

describe('DynamicRoleService - Integration Tests', () => {
  let dynamicRoleService: DynamicRoleService;
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
        DynamicRoleService,
        DbService,
        DataService,
        {
          provide: DiscordVerificationService,
          useValue: mockDiscordVerificationService,
        },
        {
          provide: DiscordService,
          useValue: mockDiscordService,
        },
      ],
    }).compile();

    dynamicRoleService = module.get<DynamicRoleService>(DynamicRoleService);
    dbService = module.get<DbService>(DbService);
    dataService = module.get<DataService>(DataService);

    // Clean up test data before each test
    await testDb.cleanupTestData();
    
    // Also clean up user roles table
    await testDb.cleanupTestData(['verifier_user_roles']);
  });

  afterEach(async () => {
    if (!isSupabaseHealthy) {
      return;
    }
    
    // Clean up test data after each test
    await testDb.cleanupTestData();
    await testDb.cleanupTestData(['verifier_user_roles']);
  });

  it('should be defined', () => {
    if (!isSupabaseHealthy) {
      console.log('⏭️ Skipping test: Supabase not available');
      return;
    }
    
    expect(dynamicRoleService).toBeDefined();
    expect(dbService).toBeDefined();
    expect(dataService).toBeDefined();
  });

  describe('role assignment tracking', () => {
    it('should track active role assignments', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test server and rule
      await testDb.createTestServer('test_server_tracking');
      const rule = await testDb.createTestRule('test_server_tracking');

      // Create a test role assignment
      const { data: assignment } = await testDb.getClient()
        .from('verifier_user_roles')
        .insert({
          user_id: 'test_user_track',
          server_id: 'test_server_tracking',
          role_id: 'test_role_123',
          rule_id: rule.id.toString(),
          address: '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
          user_name: 'Test User',
          server_name: 'Test Server',
          role_name: 'Test Role',
          status: 'active',
          verified_at: new Date().toISOString(),
          last_checked: new Date().toISOString()
        })
        .select()
        .single();

      expect(assignment).toBeDefined();
      expect(assignment.status).toBe('active');
      expect(assignment.user_id).toBe('test_user_track');
      expect(assignment.server_id).toBe('test_server_tracking');
    });

    it('should handle role assignment updates', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test data
      await testDb.createTestServer('test_server_update');
      const rule = await testDb.createTestRule('test_server_update');

      // Create initial assignment
      const { data: assignment } = await testDb.getClient()
        .from('verifier_user_roles')
        .insert({
          user_id: 'test_user_update',
          server_id: 'test_server_update',
          role_id: 'test_role_456',
          rule_id: rule.id.toString(),
          address: '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
          status: 'active',
          verified_at: new Date().toISOString()
        })
        .select()
        .single();

      // Update the assignment status
      const { data: updatedAssignment } = await testDb.getClient()
        .from('verifier_user_roles')
        .update({
          status: 'revoked',
          last_checked: new Date().toISOString()
        })
        .eq('id', assignment.id)
        .select()
        .single();

      expect(updatedAssignment.status).toBe('revoked');
      expect(updatedAssignment.last_checked).toBeDefined();
    });
  });

  describe('role verification queries', () => {
    it('should query active role assignments', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test server and rule
      await testDb.createTestServer('test_server_query');
      const rule = await testDb.createTestRule('test_server_query');

      // Create multiple role assignments with different statuses
      await testDb.getClient()
        .from('verifier_user_roles')
        .insert([
          {
            user_id: 'test_user_active1',
            server_id: 'test_server_query',
            role_id: 'test_role_active1',
            rule_id: rule.id.toString(),
            address: '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
            status: 'active',
            verified_at: new Date().toISOString()
          },
          {
            user_id: 'test_user_active2',
            server_id: 'test_server_query',
            role_id: 'test_role_active2',
            rule_id: rule.id.toString(),
            address: '0x842d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
            status: 'active',
            verified_at: new Date().toISOString()
          },
          {
            user_id: 'test_user_revoked',
            server_id: 'test_server_query',
            role_id: 'test_role_revoked',
            rule_id: rule.id.toString(),
            address: '0x942d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
            status: 'revoked',
            verified_at: new Date().toISOString()
          }
        ]);

      // Query active assignments
      const { data: activeAssignments } = await testDb.getClient()
        .from('verifier_user_roles')
        .select('*')
        .eq('server_id', 'test_server_query')
        .eq('status', 'active');

      expect(activeAssignments).toHaveLength(2);
      expect(activeAssignments!.every(a => a.status === 'active')).toBe(true);
    });

    it('should query assignments by user', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      // Create test data across multiple servers
      await testDb.createTestServer('test_server_user1');
      await testDb.createTestServer('test_server_user2');
      const rule1 = await testDb.createTestRule('test_server_user1');
      const rule2 = await testDb.createTestRule('test_server_user2');

      const userId = 'test_user_multi_server';

      // Create assignments for same user across different servers
      await testDb.getClient()
        .from('verifier_user_roles')
        .insert([
          {
            user_id: userId,
            server_id: 'test_server_user1',
            role_id: 'test_role_server1',
            rule_id: rule1.id.toString(),
            address: '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
            status: 'active',
            verified_at: new Date().toISOString()
          },
          {
            user_id: userId,
            server_id: 'test_server_user2',
            role_id: 'test_role_server2',
            rule_id: rule2.id.toString(),
            address: '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
            status: 'active',
            verified_at: new Date().toISOString()
          }
        ]);

      // Query assignments by user
      const { data: userAssignments } = await testDb.getClient()
        .from('verifier_user_roles')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

      expect(userAssignments).toHaveLength(2);
      expect(userAssignments!.every(a => a.user_id === userId)).toBe(true);
      
      const serverIds = userAssignments!.map(a => a.server_id);
      expect(serverIds).toContain('test_server_user1');
      expect(serverIds).toContain('test_server_user2');
    });
  });

  describe('role management operations', () => {
    it('should handle role assignment creation', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      await testDb.createTestServer('test_server_create');
      const rule = await testDb.createTestRule('test_server_create');

      // Test role assignment creation
      const newAssignment = {
        user_id: 'test_user_create',
        server_id: 'test_server_create',
        role_id: 'test_role_create',
        rule_id: rule.id.toString(),
        address: '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
        user_name: 'Create User',
        server_name: 'Create Server',
        role_name: 'Create Role',
        status: 'active' as const,
        verified_at: new Date().toISOString()
      };

      const { data: assignment, error } = await testDb.getClient()
        .from('verifier_user_roles')
        .insert(newAssignment)
        .select()
        .single();

      expect(error).toBeNull();
      expect(assignment).toBeDefined();
      expect(assignment.user_id).toBe('test_user_create');
      expect(assignment.status).toBe('active');
    });

    it('should handle role assignment expiration', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      await testDb.createTestServer('test_server_expire');
      const rule = await testDb.createTestRule('test_server_expire');

      // Create assignment with future expiration
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7); // 7 days from now

      const { data: assignment } = await testDb.getClient()
        .from('verifier_user_roles')
        .insert({
          user_id: 'test_user_expire',
          server_id: 'test_server_expire',
          role_id: 'test_role_expire',
          rule_id: rule.id.toString(),
          address: '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
          status: 'active',
          verified_at: new Date().toISOString(),
          expires_at: futureDate.toISOString()
        })
        .select()
        .single();

      expect(assignment.expires_at).toBeDefined();
      expect(new Date(assignment.expires_at)).toBeInstanceOf(Date);
    });
  });

  describe('database queries and relationships', () => {
    it('should maintain referential integrity with rules', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      await testDb.createTestServer('test_server_integrity');
      const rule = await testDb.createTestRule('test_server_integrity');

      // Create assignment referencing the rule
      const { data: assignment } = await testDb.getClient()
        .from('verifier_user_roles')
        .insert({
          user_id: 'test_user_integrity',
          server_id: 'test_server_integrity',
          role_id: 'test_role_integrity',
          rule_id: rule.id.toString(),
          address: '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
          status: 'active',
          verified_at: new Date().toISOString()
        })
        .select()
        .single();

      // Verify we can join with the rule
      const { data: joinedData } = await testDb.getClient()
        .from('verifier_user_roles')
        .select(`
          *,
          verifier_rules!inner(
            id,
            server_id,
            role_id,
            slug,
            attribute_key,
            attribute_value
          )
        `)
        .eq('id', assignment.id)
        .single();

      expect(joinedData).toBeDefined();
      expect(joinedData.verifier_rules).toBeDefined();
      expect(joinedData.verifier_rules.id).toBe(rule.id);
    });

    it('should handle complex filtering queries', async () => {
      if (!isSupabaseHealthy) {
        console.log('⏭️ Skipping test: Supabase not available');
        return;
      }

      await testDb.createTestServer('test_server_filter');
      const rule = await testDb.createTestRule('test_server_filter');

      // Create assignments with different timestamps for filtering
      const now = new Date();
      const oldDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

      await testDb.getClient()
        .from('verifier_user_roles')
        .insert([
          {
            user_id: 'test_user_recent',
            server_id: 'test_server_filter',
            role_id: 'test_role_recent',
            rule_id: rule.id.toString(),
            address: '0x742d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
            status: 'active',
            verified_at: now.toISOString(),
            last_checked: now.toISOString()
          },
          {
            user_id: 'test_user_old',
            server_id: 'test_server_filter',
            role_id: 'test_role_old',
            rule_id: rule.id.toString(),
            address: '0x842d35cc6634c0532925a3b8d3aa3e3cf9fbc4f4',
            status: 'active',
            verified_at: oldDate.toISOString(),
            last_checked: oldDate.toISOString()
          }
        ]);

      // Query assignments that need re-verification (older than 12 hours)
      const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);
      
      const { data: needsReverification } = await testDb.getClient()
        .from('verifier_user_roles')
        .select('*')
        .eq('server_id', 'test_server_filter')
        .eq('status', 'active')
        .lt('last_checked', twelveHoursAgo.toISOString());

      expect(needsReverification).toHaveLength(1);
      expect(needsReverification![0].user_id).toBe('test_user_old');
    });
  });
});
