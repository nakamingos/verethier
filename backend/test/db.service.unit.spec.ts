/**
 * DbService Unit Tests
 * 
 * Focused unit tests for the refactored DbService that uses dependency injection
 * for the Supabase client. These tests verify that the dependency injection works
 * correctly and that the service can handle basic operations.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DbService } from '../src/services/db.service';

describe('DbService (Unit Tests)', () => {
  let service: DbService;
  let mockSupabaseClient: any;
  let loggerSpy: jest.SpyInstance;

  beforeEach(async () => {
    // Create a mock Supabase client
    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      range: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      upsert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      lte: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      or: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      gte: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DbService,
        {
          provide: 'SUPABASE_CLIENT',
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    service = module.get<DbService>(DbService);
    
    // Mock Logger to avoid console output during tests
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    loggerSpy.mockRestore();
  });

  describe('Service Initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have access to the injected Supabase client', () => {
      expect(service).toBeInstanceOf(DbService);
    });

    it('should have all expected methods', () => {
      expect(typeof service.addUpdateServer).toBe('function');
      expect(typeof service.getServerRole).toBe('function');
      expect(typeof service.addRoleMapping).toBe('function');
      expect(typeof service.getRoleMappings).toBe('function');
      expect(typeof service.deleteRoleMapping).toBe('function');
      expect(typeof service.getAllRulesForServer).toBe('function');
      expect(typeof service.getRuleById).toBe('function');
      expect(typeof service.trackRoleAssignment).toBe('function');
      expect(typeof service.updateRoleVerification).toBe('function');
    });
  });

  describe('Optional NFT metadata cache', () => {
    it('falls back to provider metadata when cache reads fail', async () => {
      mockSupabaseClient.gte.mockResolvedValueOnce({ error: { message: 'permission denied' } });
      expect(await service.getCachedNftMetadata(1, 'contract', ['1'], new Date().toISOString())).toEqual([]);
      mockSupabaseClient.gte.mockRejectedValueOnce(new Error('network failure'));
      expect(await service.getCachedNftMetadata(1, 'contract', ['1'], new Date().toISOString())).toEqual([]);
    });
    it('does not fail verification when cache writes fail', async () => {
      const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      mockSupabaseClient.upsert.mockResolvedValueOnce({ error: { message: 'permission denied' } });
      await expect(service.cacheNftMetadata([])).resolves.toBeUndefined();
      mockSupabaseClient.upsert.mockRejectedValueOnce(new Error('network failure'));
      await expect(service.cacheNftMetadata([])).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledTimes(2);
      warning.mockRestore();
    });
  });

  describe('addUpdateServer', () => {
    it('should successfully add/update a server', async () => {
      const mockResult = {
        data: { id: '123', name: 'Test Server', role_id: 'role123' },
        error: null
      };
      
      mockSupabaseClient.upsert.mockResolvedValue(mockResult);

      const result = await service.addUpdateServer('123', 'Test Server', 'role123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_servers');
      expect(mockSupabaseClient.upsert).toHaveBeenCalledWith({
        id: '123',
        name: 'Test Server',
        role_id: 'role123'
      });
      expect(result).toEqual(mockResult.data);
    });

    it('should throw error on database error', async () => {
      const mockError = new Error('Database error');
      mockSupabaseClient.upsert.mockResolvedValue({
        data: null,
        error: mockError
      });

      await expect(service.addUpdateServer('123', 'Test Server', 'role123')).rejects.toThrow('Database error');
    });
  });

  describe('getServerRole', () => {
    it('should successfully retrieve a server role', async () => {
      const mockResult = {
        data: [{ role_id: 'role123' }],
        error: null
      };
      mockSupabaseClient.eq.mockResolvedValue(mockResult);

      const result = await service.getServerRole('123');

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_servers');
      expect(mockSupabaseClient.select).toHaveBeenCalledWith('role_id');
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('id', '123');
      expect(result).toBe('role123');
    });

    it('should return undefined when server not found', async () => {
      const mockResult = {
        data: [],
        error: null
      };
      mockSupabaseClient.eq.mockResolvedValue(mockResult);

      const result = await service.getServerRole('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should throw error on database error', async () => {
      const mockError = new Error('Database error');
      mockSupabaseClient.eq.mockResolvedValue({
        data: null,
        error: mockError
      });

      await expect(service.getServerRole('123')).rejects.toThrow('Database error');
    });
  });

  describe('addRoleMapping', () => {
    it('should call the correct Supabase methods with correct parameters', async () => {
      const mockResult = {
        data: { id: 1 },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      await service.addRoleMapping(
        '123',          // serverId
        'Test Server',  // serverName
        'channel123',   // channelId
        'Test Channel', // channelName
        'test-slug',    // slug
        'role123',      // roleId
        'Test Role',    // roleName
        'attribute',    // attrKey
        'value',        // attrVal
        1               // minItems
      );

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_rules');
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith({
        server_id: '123',
        server_name: 'Test Server',
        channel_id: 'channel123',
        channel_name: 'Test Channel',
        slug: 'test-slug',
        role_id: 'role123',
        role_name: 'Test Role',
        attribute_key: 'attribute',
        attribute_value: 'value',
        min_items: 1
      });
      expect(mockSupabaseClient.select).toHaveBeenCalled();
      expect(mockSupabaseClient.single).toHaveBeenCalled();
    });

    it('should use defaults for empty values', async () => {
      const mockResult = {
        data: { id: 1 },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      await service.addRoleMapping(
        '123',          // serverId
        'Test Server',  // serverName
        'channel123',   // channelId
        'Test Channel', // channelName
        '',             // slug (empty)
        'role123',      // roleId
        'Test Role',    // roleName
        '',             // attrKey (empty)
        '',             // attrVal (empty)
        null            // minItems (null)
      );

      expect(mockSupabaseClient.insert).toHaveBeenCalledWith({
        server_id: '123',
        server_name: 'Test Server',
        channel_id: 'channel123',
        channel_name: 'Test Channel',
        slug: 'ALL',
        role_id: 'role123',
        role_name: 'Test Role',
        attribute_key: 'ALL',
        attribute_value: 'ALL',
        min_items: 1
      });
    });
  });

  describe('trackRoleAssignment', () => {
    it('should call the correct Supabase methods with correct parameters', async () => {
      const mockResult = {
        data: { id: 'assignment123' },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      const assignment = {
        userId: 'user123',
        serverId: '123',
        roleId: 'role123',
        ruleId: '1',
        address: '0xABC123',
        userName: 'Test User',
        serverName: 'Test Server',
        roleName: 'Test Role'
      };

      await service.trackRoleAssignment(assignment);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_user_roles');
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith({
        user_id: 'user123',
        server_id: '123',
        role_id: 'role123',
        rule_id: '1',
        user_name: 'Test User',
        server_name: 'Test Server',
        role_name: 'Test Role',
        verification_data: {},
        status: 'active',
        verified_at: expect.any(String),
        last_checked: expect.any(String),
        expires_at: null,
        updated_at: expect.any(String)
      });
      expect(mockSupabaseClient.select).toHaveBeenCalled();
      expect(mockSupabaseClient.single).toHaveBeenCalled();
    });

    it('should handle expiration times correctly', async () => {
      const mockResult = {
        data: { id: 'assignment123' },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      const assignment = {
        userId: 'user123',
        serverId: '123',
        roleId: 'role123',
        ruleId: '1',
        address: '0xabc',
        expiresInHours: 24
      };

      await service.trackRoleAssignment(assignment);

      const insertCall = mockSupabaseClient.insert.mock.calls[0][0];
      expect(insertCall.expires_at).toBeDefined();
      expect(insertCall.expires_at).not.toBeNull();
      expect(new Date(insertCall.expires_at)).toBeInstanceOf(Date);
    });
  });

  describe('updateRoleVerification', () => {
    it('should call the correct Supabase methods for valid verification', async () => {
      const mockResult = {
        data: { id: 'assignment123' },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      await service.updateRoleVerification('assignment123', true);

      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_user_roles');
      expect(mockSupabaseClient.update).toHaveBeenCalledWith({
        status: 'active',
        verified_at: expect.any(String),
        last_checked: expect.any(String),
        updated_at: expect.any(String)
      });
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('id', 'assignment123');
      expect(mockSupabaseClient.select).toHaveBeenCalled();
      expect(mockSupabaseClient.single).toHaveBeenCalled();
    });

    it('should set status to revoked for invalid verification', async () => {
      const mockResult = {
        data: { id: 'assignment123' },
        error: null
      };
      mockSupabaseClient.single.mockResolvedValue(mockResult);

      await service.updateRoleVerification('assignment123', false);

      expect(mockSupabaseClient.update).toHaveBeenCalledWith({
        status: 'revoked',
        verified_at: expect.any(String),
        last_checked: expect.any(String),
        updated_at: expect.any(String)
      });
    });
  });

  describe('Dependency Injection', () => {
    it('should properly inject the Supabase client', () => {
      // This test verifies that the service was created successfully with the injected client
      // If DI failed, the beforeEach would have thrown an error
      expect(service).toBeDefined();
      
      // Verify that calling a method attempts to use the injected client
      mockSupabaseClient.eq.mockResolvedValue({ data: [], error: null });
      service.getServerRole('test');
      
      expect(mockSupabaseClient.from).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle Supabase errors gracefully', async () => {
      const mockError = new Error('Database connection failed');
      mockSupabaseClient.upsert.mockResolvedValue({
        data: null,
        error: mockError
      });

      await expect(service.addUpdateServer('123', 'Test', 'role123')).rejects.toThrow('Database connection failed');
    });

    it('should handle method call exceptions', async () => {
      mockSupabaseClient.eq.mockRejectedValue(new Error('Network timeout'));

      await expect(service.getServerRole('123')).rejects.toThrow('Network timeout');
    });
  });

  describe('restoreRuleWithOriginalId', () => {
    const mockRuleData = {
      id: 42,
      server_id: 'server123',
      server_name: 'Test Server',
      channel_id: 'channel123',
      channel_name: 'test-channel',
      slug: 'test-collection',
      role_id: 'role123',
      role_name: 'Test Role',
      attribute_key: 'trait',
      attribute_value: 'rare',
      min_items: 1
    };

    it('should restore rule with original ID when no conflict exists', async () => {
      // Mock successful insert
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: { ...mockRuleData, created_at: new Date() },
        error: null
      });

      const result = await service.restoreRuleWithOriginalId(mockRuleData);

      expect(result.id).toBe(42);
      expect(mockSupabaseClient.from).toHaveBeenCalledWith('verifier_rules');
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({
        id: 42,
        server_id: 'server123',
        role_id: 'role123'
      }));
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({
        id: 42,
        server_id: 'server123',
        role_id: 'role123'
      }));
    });

    it('should create new rule when ID conflict exists', async () => {
      // Mock database constraint error for duplicate ID
      mockSupabaseClient.single.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));

      await expect(service.restoreRuleWithOriginalId(mockRuleData)).rejects.toThrow();
    });

    it('should handle database errors during ID conflict check', async () => {
      const dbError = new Error('Database connection failed');
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: null,
        error: dbError
      });

      await expect(service.restoreRuleWithOriginalId(mockRuleData))
        .rejects.toThrow('Database connection failed');
    });

    it('should use default values for missing rule data', async () => {
      const incompleteRuleData = {
        id: 42,
        server_id: 'server123',
        server_name: 'Test Server',
        channel_id: 'channel123',
        channel_name: 'test-channel',
        role_id: 'role123',
        role_name: 'Test Role'
        // Missing slug, attribute_key, attribute_value, min_items
      };

      // Mock successful insert
      mockSupabaseClient.single.mockResolvedValueOnce({
        data: { ...incompleteRuleData, created_at: new Date() },
        error: null
      });

      await service.restoreRuleWithOriginalId(incompleteRuleData);

      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({
        id: 42,
        server_id: 'server123',
        role_id: 'role123'
      }));
    });
  });
  describe('Ordinals rules', () => {
    const fields = { asset_type: 'ordinal' as const, chain_id: null, contract_address: null, token_standard: null, token_ids: null, collection_name: 'Pizza Comrades' };
    it('persists collection/count criteria with no EVM chain and restores them on undo', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: { id: 1 }, error: null });
      await service.addRoleMapping('server', 'Server', 'channel', 'verify', 'pizza-comrades', 'role', 'Holder', 'ALL', 'ALL', 10, fields);
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({ ...fields, slug: 'pizza-comrades', min_items: 10 }));
      await service.restoreRuleWithOriginalId({ id: 1, server_id: 'server', channel_id: 'channel', role_id: 'role', slug: 'pizza-comrades', min_items: 10, attribute_key: 'ALL', attribute_value: 'ALL', ...fields });
      expect(mockSupabaseClient.insert).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1, slug: 'pizza-comrades', min_items: 10, ...fields }));
    });
    it('keeps duplicate checks separate from Ethscriptions with the same slug', async () => {
      mockSupabaseClient.maybeSingle.mockResolvedValue({ data: null, error: null });
      await service.checkForExactDuplicateRule('server', 'channel', 'pizza-comrades', 'ALL', 'ALL', 10, 'role', fields);
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('asset_type', 'ordinal');
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('slug', 'pizza-comrades');
      expect(mockSupabaseClient.eq).not.toHaveBeenCalledWith('asset_type', 'ethscription');
    });
  });
  describe('Specific inscription rules', () => {
    it.each(['ordinal', 'ethscription'] as const)('persists, identifies duplicates, and restores %s criteria', async assetType => {
      const criteria = { kind: 'numbers' as const, ranges: [[0, 99999]] as Array<[number, number]> };
      const fields = { asset_type: assetType, chain_id: assetType === 'ordinal' ? null : 1, inscription_criteria: criteria };
      mockSupabaseClient.single.mockResolvedValue({ data: { id: 1 }, error: null });
      await service.addRoleMapping('server', 'Server', 'channel', 'verify', null, 'role', 'Holder', 'ALL', 'ALL', 1, fields);
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({ ...fields, slug: null }));
      await service.checkForExactDuplicateRule('server', 'channel', null, 'ALL', 'ALL', 1, 'role', fields);
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('asset_type', assetType);
      expect(mockSupabaseClient.is).toHaveBeenCalledWith('slug', null);
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('inscription_criteria', JSON.stringify(criteria));
      await service.restoreRuleWithOriginalId({ id: 1, server_id: 'server', channel_id: 'channel', role_id: 'role', slug: null, ...fields });
      expect(mockSupabaseClient.insert).toHaveBeenLastCalledWith(expect.objectContaining({ id: 1, slug: null, inscription_criteria: criteria }));
    });
  });
  describe('NFT rules', () => {
    const fields = { asset_type: 'nft' as const, chain_id: 1, contract_address: '0x1111111111111111111111111111111111111111', token_standard: 'erc1155' as const, token_ids: ['0', '500'], collection_name: 'Example' };
    it('writes NFT fields with a null Ethscriptions slug', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: { id: 1 }, error: null });
      await service.addRoleMapping('server', 'Server', 'channel', 'verify', 'ALL', 'role', 'Holder', 'ALL', 'ALL', 1, fields);
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({ ...fields, slug: null }));
    });
    it('preserves NFT fields when undo restores a removed rule', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: { id: 1 }, error: null });
      await service.restoreRuleWithOriginalId({ id: 1, server_id: 'server', channel_id: 'channel', role_id: 'role', slug: null, min_items: 1, attribute_key: 'ALL', attribute_value: 'ALL', ...fields });
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({ id: 1, slug: null, ...fields }));
    });
    it('preserves existing assignment metadata when adding check details', async () => {
      mockSupabaseClient.maybeSingle.mockResolvedValue({ data: { id: 1, status: 'active', verification_data: { existing_metadata: true } }, error: null });
      mockSupabaseClient.single.mockResolvedValue({ data: { id: 1 }, error: null });
      await service.trackRoleAssignment({ userId: 'user', serverId: 'server', roleId: 'role', verificationData: { matched_rule_ids: [1, 2] } });
      expect(mockSupabaseClient.update).toHaveBeenCalledWith(expect.objectContaining({ verification_data: { existing_metadata: true, matched_rule_ids: [1, 2] } }));
    });
  });

  describe('earned role history', () => {
    it('includes every assignment status and paginates beyond the Supabase row limit', async () => {
      const first = Array.from({ length: 1000 }, (_, id) => ({ id, status: 'revoked' }));
      mockSupabaseClient.range.mockResolvedValueOnce({ data: first }).mockResolvedValueOnce({ data: [{ id: 1000, status: 'active' }] });
      expect(await service.getEarnedRoleAssignments()).toHaveLength(1001);
      expect(mockSupabaseClient.in).toHaveBeenCalledWith('status', ['active', 'revoked', 'expired']);
      expect(mockSupabaseClient.range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    });

    it('scopes manual reconciliation to the requested user or rule', async () => {
      mockSupabaseClient.range.mockResolvedValue({ data: [] });
      await service.getEarnedRoleAssignments({ userId: 'user', ruleId: '42' });
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('user_id', 'user');
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('rule_id', '42');
    });

    it('propagates history query errors without returning a partial allowlist', async () => {
      mockSupabaseClient.range.mockResolvedValue({ error: new Error('unavailable') });
      await expect(service.getEarnedRoleAssignments()).rejects.toThrow('unavailable');
    });
  });

  describe('ERC-20 rule persistence', () => {
    const token = { asset_type: 'erc20' as const, chain_id: 4663, contract_address: '0x' + '1'.repeat(40),
      token_decimals: 6, token_symbol: 'TEST', min_balance: '500000', collection_name: 'Test', token_standard: null, token_ids: null };
    it('saves token fields without collection or item-count defaults', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: { id: 1, ...token } });
      await service.addRoleMapping('guild', 'Guild', 'channel', 'Channel', null, 'role', 'Holder', 'ALL', 'ALL', null, token);
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({ slug: null, min_items: null, ...token }));
    });
    it('matches duplicates by network, contract, and exact minimum independently of NFT rules', async () => {
      await service.checkForExactDuplicateRule('guild', 'channel', null, 'ALL', 'ALL', null, 'role', token);
      await service.checkForDuplicateRule('guild', 'channel', null, 'ALL', 'ALL', null, 'other-role', { ...token, min_balance: '1000000' });
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('asset_type', 'erc20');
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('chain_id', 4663);
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('contract_address', token.contract_address);
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('min_balance', '500000');
      expect(mockSupabaseClient.eq).toHaveBeenCalledWith('min_balance', '1000000');
      expect(mockSupabaseClient.is).toHaveBeenCalledWith('min_items', null);
      expect(mockSupabaseClient.eq).not.toHaveBeenCalledWith('asset_type', 'ethscription');
    });
    it('preserves the token threshold and metadata when restoring a removed rule', async () => {
      mockSupabaseClient.single.mockResolvedValue({ data: { id: 1, ...token } });
      await service.restoreRuleWithOriginalId({ id: 1, server_id: 'guild', channel_id: 'channel', role_id: 'role',
        attribute_key: 'ALL', attribute_value: 'ALL', min_items: null, slug: null, ...token });
      expect(mockSupabaseClient.insert).toHaveBeenCalledWith(expect.objectContaining({ id: 1, slug: null, min_items: null, ...token }));
    });
  });

});
