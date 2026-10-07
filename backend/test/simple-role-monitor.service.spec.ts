import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { NftOwnershipService } from '../src/services/nft-ownership.service';
import { Test, TestingModule } from '@nestjs/testing';
import { SimpleRoleMonitorService } from '../src/services/simple-role-monitor.service';
import { DbService } from '../src/services/db.service';
import { DataService } from '../src/services/data.service';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { UserAddressService } from '../src/services/user-address.service';
import { Logger } from '@nestjs/common';

describe('SimpleRoleMonitorService', () => {
  let service: SimpleRoleMonitorService;
  let dbService: jest.Mocked<DbService>;
  let dataService: jest.Mocked<DataService>;
  let discordVerificationService: jest.Mocked<DiscordVerificationService>;
  let userAddressService: any;

  beforeEach(async () => {
    const mockDbService = {
      getUserRoleHistory: jest.fn(),
      getServerUniqueUsers: jest.fn(),
      checkEnhancedTrackingExists: jest.fn(),
      getRoleAssignmentStats: jest.fn(),
      getRoleMappings: jest.fn(),
      getRuleById: jest.fn().mockImplementation(async id => (await mockDbService.getRoleMappings()).find(rule => rule.id === id)),
      saveRoleCheckDetails: jest.fn(),
      updateLastVerified: jest.fn(),
      addServerToUser: jest.fn(),
      logUserRole: jest.fn(),
    };

    const mockDataService = {
      checkAssetOwnershipWithCriteria: jest.fn(),
    };

    const mockDiscordVerificationService = {
      getGuildMember: jest.fn(),
      addUserRole: jest.fn(),
      addUserRoleDynamic: jest.fn(),
      removeUserRole: jest.fn(),
    };

    const mockUserAddressService = {
      getUserAddresses: jest.fn(),
    };

    const mockVerificationEngine = {
      verifyOwnership: jest.fn(),
      verifyBulkOwnership: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetOwnershipService,
        { provide: NftOwnershipService, useValue: { count: jest.fn() } },
        SimpleRoleMonitorService,
        { provide: DbService, useValue: mockDbService },
        { provide: DataService, useValue: mockDataService },
        { provide: DiscordVerificationService, useValue: mockDiscordVerificationService },
        VerificationEngine,
        { provide: UserAddressService, useValue: mockUserAddressService },
      ],
    }).compile();

    service = module.get<SimpleRoleMonitorService>(SimpleRoleMonitorService);
    dbService = module.get(DbService);
    dataService = module.get(DataService);
    discordVerificationService = module.get(DiscordVerificationService);
    userAddressService = module.get(UserAddressService);

    // Mock Logger to avoid console output during tests
    jest.spyOn(Logger, 'log').mockImplementation();
    jest.spyOn(Logger, 'debug').mockImplementation();
    jest.spyOn(Logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('reverifyUser', () => {
    it('should reverify a user and return verification results', async () => {
      const mockUserRoles = [
        {
          id: 'role-1',
          user_id: 'user1',
          server_id: 'server1',
          role_id: 'role1',
          address: '0x123',
          status: 'active',
        },
      ];

      const mockRules = [
        {
          id: 'rule-1',
          role_id: 'role1',
          slug: 'test-collection',
          attribute_key: 'trait',
          attribute_value: 'rare',
          min_items: 1,
        },
      ];

      dbService.getUserRoleHistory.mockResolvedValue(mockUserRoles);
      dbService.getRoleMappings.mockResolvedValue(mockRules);
      userAddressService.getUserAddresses.mockResolvedValue(['0x123']);
      dataService.checkAssetOwnershipWithCriteria.mockResolvedValue(2); // User still qualifies
      discordVerificationService.getGuildMember.mockResolvedValue({
        roles: { cache: new Map([['role1', true]]) },
      });

      const result = await service.reverifyUser('user1', 'server1');

      expect(result.verified).toContain('role1');
      expect(result.revoked).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(dbService.getUserRoleHistory).toHaveBeenCalledWith('user1', 'server1');
      expect(dataService.checkAssetOwnershipWithCriteria).toHaveBeenCalledWith(
        ['0x123'],
        'test-collection',
        'trait',
        'rare',
        1
      );
    });

    it('should revoke roles when user no longer qualifies', async () => {
      const mockUserRoles = [
        {
          id: 'role-1',
          user_id: 'user1',
          server_id: 'server1',
          role_id: 'role1',
          address: '0x123',
          status: 'active',
        },
      ];

      const mockRules = [
        {
          id: 'rule-1',
          role_id: 'role1',
          slug: 'test-collection',
          attribute_key: 'ALL',
          attribute_value: 'ALL',
          min_items: 5,
        },
      ];

      dbService.getUserRoleHistory.mockResolvedValue(mockUserRoles);
      dbService.getRoleMappings.mockResolvedValue(mockRules);
      userAddressService.getUserAddresses.mockResolvedValue(['0x123']);
      dataService.checkAssetOwnershipWithCriteria.mockResolvedValue(2); // Only 2, needs 5
      discordVerificationService.getGuildMember.mockResolvedValue({
        roles: { cache: new Map([['role1', true]]) },
      });
      discordVerificationService.removeUserRole.mockResolvedValue(true);

      const result = await service.reverifyUser('user1', 'server1');

      expect(result.verified).toHaveLength(0);
      expect(result.revoked).toContain('role1');
      expect(result.errors).toHaveLength(0);
      expect(discordVerificationService.removeUserRole).toHaveBeenCalledWith('user1', 'server1', 'role1');
    });

    it('should handle user with no address', async () => {
      dbService.getUserRoleHistory.mockResolvedValue([]);
      dbService.getRoleMappings.mockResolvedValue([]);
      userAddressService.getUserAddresses.mockResolvedValue([]);

      const result = await service.reverifyUser('user1', 'server1');

      expect(result.verified).toHaveLength(0);
      expect(result.revoked).toHaveLength(0);
      expect(result.errors).toContain('No addresses found for user');
    });

    it('should grant new roles when user qualifies but doesnt have them', async () => {
      const mockUserRoles = []; // No existing roles

      const mockRules = [
        {
          id: 'rule-1',
          role_id: 'role1',
          slug: 'test-collection',
          attribute_key: 'trait',
          attribute_value: 'rare',
          min_items: 1,
        },
      ];

      dbService.getUserRoleHistory.mockResolvedValue(mockUserRoles);
      dbService.getRoleMappings.mockResolvedValue(mockRules);
      userAddressService.getUserAddresses.mockResolvedValue(['0x123']);
      dataService.checkAssetOwnershipWithCriteria.mockResolvedValue(2); // User qualifies
      const mockRolesCache = new Map();
      discordVerificationService.getGuildMember.mockResolvedValue({
        roles: { cache: mockRolesCache }, // No roles currently
      });
      discordVerificationService.addUserRole.mockResolvedValue({
        roleId: 'role1',
        roleName: 'Test Role',
        wasAlreadyAssigned: false
      });
      dbService.logUserRole.mockResolvedValue(undefined);

      const result = await service.reverifyUser('user1', 'server1');

      expect(result.verified).toContain('role1');
      expect(result.revoked).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
      expect(discordVerificationService.addUserRole).toHaveBeenCalledWith('user1', 'role1', 'server1', 'reverification', 'rule-1', expect.objectContaining({ matched_rule_ids: ['rule-1'], last_check_status: 'passed' }));
    });
  });

  describe('reverifyServer', () => {
    it('should reverify all users in a server', async () => {
      const mockUniqueUsers = ['user1', 'user2', 'user3'];

      dbService.getServerUniqueUsers.mockResolvedValue(mockUniqueUsers);

      // Mock individual reverifyUser calls
      const mockResults = [
        { verified: ['role1'], revoked: [], errors: [] },
        { verified: [], revoked: ['role2'], errors: [] },
        { verified: ['role3'], revoked: [], errors: ['Some error'] },
      ];

      let callCount = 0;
      jest.spyOn(service, 'reverifyUser').mockImplementation(async () => {
        return mockResults[callCount++];
      });

      const result = await service.reverifyServer('server1');

      expect(result).toMatchObject({
        usersProcessed: 3,
        totalVerified: 2,
        totalRevoked: 1,
      });

      expect(result.errors).toContain('Some error');
      expect(service.reverifyUser).toHaveBeenCalledTimes(3);
      expect(service.reverifyUser).toHaveBeenCalledWith('user1', 'server1');
      expect(service.reverifyUser).toHaveBeenCalledWith('user2', 'server1');
      expect(service.reverifyUser).toHaveBeenCalledWith('user3', 'server1');
    });

    it('should handle server with no users', async () => {
      dbService.getServerUniqueUsers.mockResolvedValue([]);

      const result = await service.reverifyServer('server1');

      expect(result).toMatchObject({
        usersProcessed: 0,
        totalVerified: 0,
        totalRevoked: 0,
        errors: [],
      });
    });

    it('should handle errors during individual user verification', async () => {
      const mockUniqueUsers = ['user1', 'user2'];

      dbService.getServerUniqueUsers.mockResolvedValue(mockUniqueUsers);

      jest.spyOn(service, 'reverifyUser')
        .mockResolvedValueOnce({ verified: ['role1'], revoked: [], errors: [] })
        .mockRejectedValueOnce(new Error('Verification failed'));

      const result = await service.reverifyServer('server1');

      expect(result).toMatchObject({
        usersProcessed: 2,
        totalVerified: 1,
        totalRevoked: 0,
      });

      expect(result.errors).toContain('User user2: Verification failed');
    });
  });
});
