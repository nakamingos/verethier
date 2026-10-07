import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { NftOwnershipService } from '../src/services/nft-ownership.service';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { DbService } from '../src/services/db.service';
import { NonceService } from '../src/services/nonce.service';
import { DataService } from '../src/services/data.service';
import { UserAddressService } from '../src/services/user-address.service';
import { Logger } from '@nestjs/common';
import { MessageFlags } from 'discord.js';

// Mock Logger methods to suppress error output during tests
const loggerSpy = jest.spyOn(Logger, 'error').mockImplementation(() => {});
const loggerDebugSpy = jest.spyOn(Logger, 'debug').mockImplementation(() => {});

const mockDbService = {
  getServerRole: jest.fn(),
  findRuleByMessageId: jest.fn(),
  getRulesByChannel: jest.fn(),
  addServerToUser: jest.fn(),
  trackRoleAssignment: jest.fn(),
  getRoleMappings: jest.fn().mockResolvedValue([
    {
      id: 1,
      role_id: 'role-id',
      slug: 'test-collection',
      min_items: 1,
      attribute_key: 'ALL',
      attribute_value: 'ALL'
    },
    {
      id: 2,
      role_id: 'role-id-2',
      slug: 'other-collection',
      min_items: 1,
      attribute_key: 'ALL',
      attribute_value: 'ALL'
    }
  ]),
  getUserRoleHistory: jest.fn().mockResolvedValue([])
};

const mockNonceService = {
  createNonce: jest.fn(),
};

const mockDataService = {
  getCollectionNames: jest.fn().mockResolvedValue({
    'test-collection': {
      name: 'The Test Collection',
      singleName: 'Comrade',
    },
    'other-collection': {
      name: 'The Other Collection',
      singleName: 'Misprint',
    },
    'third-collection': {
      name: 'The Third Collection',
      singleName: 'EtherPhunk',
    },
  }),
  checkAssetOwnershipWithCriteria: jest.fn().mockResolvedValue(0),
};

const mockUserAddressService = {
  getUserAddresses: jest.fn().mockResolvedValue(['0xexistingwallet']),
};

const mockGuildMember = {
  id: 'user-id',
  displayName: 'Test User',
  user: {
    username: 'testuser',
    id: 'user-id'
  },
  roles: {
    add: jest.fn(),
    cache: {
      has: jest.fn().mockReturnValue(false),
      keys: jest.fn().mockReturnValue([]),
    }
  },
};

const mockFetchedGuild = {
  members: {
    fetch: jest.fn().mockResolvedValue(mockGuildMember),
  },
  roles: {
    fetch: jest.fn().mockImplementation(async (roleId: string) => {
      if (roleId === 'role-id') return { id: 'role-id', name: 'Test Role' };
      if (roleId === 'role-id-2') return { id: 'role-id-2', name: 'Test Role 2' };
      if (roleId === 'role-id-3') return { id: 'role-id-3', name: 'Bonus Role' };
      if (roleId === 'role-id-4') return { id: 'role-id-4', name: 'Second Bonus Role' };
      if (roleId === 'role-id-5') return { id: 'role-id-5', name: 'Third Bonus Role' };
      return undefined;
    }),
  },
};

const mockClient = {
  guilds: {
    cache: new Map([
      ['guild-id', {
        id: 'guild-id',
        name: 'Test Guild',
        members: {
          fetch: jest.fn().mockResolvedValue({
            ...mockGuildMember,
            roles: {
              ...mockGuildMember.roles,
              cache: {
                ...mockGuildMember.roles.cache,
                has: jest.fn().mockReturnValue(false), // User doesn't have the role by default
              }
            },
          }),
        },
        roles: {
          cache: {
            get: jest.fn().mockReturnValue({ id: 'role-id', name: 'Test Role' }),
            map: jest.fn().mockReturnValue([{ id: 'role-id', name: 'Test Role' }])
          }
        }
      }]
    ]),
    fetch: jest.fn().mockResolvedValue(mockFetchedGuild),
  },
  get: jest.fn().mockImplementation((id) => {
    return mockClient.guilds.cache.get(id);
  })
};

const mockInteraction = {
  guild: { 
    id: 'guild-id', 
    name: 'Test Guild', 
    iconURL: jest.fn().mockReturnValue('https://example.com/icon.png'),
    roles: { cache: new Map([['role-id', { id: 'role-id', name: 'Test Role' }]]) } 
  },
  channel: { id: 'channel-id' },
  message: { id: 'message-id' },
  user: { id: 'user-id', tag: 'testuser#1234', avatarURL: () => 'avatar-url' },
  deferReply: jest.fn(),
  editReply: jest.fn(),
  reply: jest.fn(),
  isRepliable: jest.fn().mockReturnValue(true),
  deferred: true,
};

describe('DiscordVerificationService', () => {
  let service: DiscordVerificationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssetOwnershipService,
        { provide: NftOwnershipService, useValue: { count: jest.fn() } },
        DiscordVerificationService,
        { provide: DbService, useValue: mockDbService },
        { provide: NonceService, useValue: mockNonceService },
        { provide: DataService, useValue: mockDataService },
        { provide: UserAddressService, useValue: mockUserAddressService },
      ],
    }).compile();

    service = module.get<DiscordVerificationService>(DiscordVerificationService);
    service.initialize(mockClient as any);
    jest.clearAllMocks();
    loggerSpy.mockClear();
    loggerDebugSpy.mockClear();
    mockGuildMember.roles.cache.has.mockReturnValue(false);
    mockGuildMember.roles.cache.keys.mockReturnValue([]);
    mockFetchedGuild.members.fetch.mockResolvedValue(mockGuildMember);
  });

  afterAll(() => {
    loggerSpy.mockRestore();
    loggerDebugSpy.mockRestore();
  });

  describe('requestVerification', () => {
    it('should create verification request successfully', async () => {
      mockDbService.getRulesByChannel.mockResolvedValue([{ role_id: 'role-id' }]);
      mockNonceService.createNonce.mockResolvedValue('test-nonce');

      await service.requestVerification(mockInteraction as any);

      // Note: deferReply is now handled by the caller, not by requestVerification
      expect(mockDbService.getRulesByChannel).toHaveBeenCalledWith('guild-id', 'channel-id');
      expect(mockNonceService.createNonce).toHaveBeenCalledWith(
        'user-id',
        'guild-id',
        'message-id',
        'channel-id'
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              title: 'Wallet Verification'
            })
          })
        ]),
        components: expect.any(Array)
      });
    });

    it('should retire the previous verification link when a newer one is requested in the same channel', async () => {
      const previousInteraction = {
        ...mockInteraction,
        editReply: jest.fn(),
        isRepliable: jest.fn().mockReturnValue(true),
        deleteReply: jest.fn().mockResolvedValue(undefined),
      };

      mockDbService.getRulesByChannel.mockResolvedValue([{ role_id: 'role-id' }]);
      mockNonceService.createNonce.mockResolvedValue('test-nonce');

      service.tempMessages['old-nonce'] = previousInteraction as any;
      (service as any).nonceScopes['old-nonce'] = 'user-id:guild-id:channel-id';
      (service as any).latestRequestNonces['user-id:guild-id:channel-id'] = 'old-nonce';

      jest.useFakeTimers();
      try {
        await service.requestVerification(mockInteraction as any);

        expect(previousInteraction.editReply).toHaveBeenCalledWith({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                title: 'Verification Link Replaced',
                description: 'A newer verification link was requested. Please use the latest "Verify Now" button. This notice will disappear shortly.'
              })
            })
          ]),
          components: []
        });
        expect(previousInteraction.deleteReply).not.toHaveBeenCalled();

        jest.advanceTimersByTime(10_000);
        await Promise.resolve();

        expect(previousInteraction.deleteReply).toHaveBeenCalled();
        expect(service.tempMessages['old-nonce']).toBeUndefined();
        expect((service as any).latestRequestNonces['user-id:guild-id:channel-id']).toBe('test-nonce');
      } finally {
        jest.useRealTimers();
      }
    });

    it('should handle error when no rules found', async () => {
      mockDbService.getRulesByChannel.mockResolvedValue([]);

      await service.requestVerification(mockInteraction as any);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: 'Error: No verification rules found for this channel.'
      });
    });
  });

  describe('addUserRole', () => {
    it('should add role to user successfully', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;

      await service.addUserRole('user-id', 'role-id', 'guild-id', nonce, 'rule-123');

      expect(mockDbService.trackRoleAssignment).toHaveBeenCalledWith({
        userId: 'user-id',
        serverId: 'guild-id',
        roleId: 'role-id',
        ruleId: 'rule-123',
        userName: 'Test User',
        serverName: 'Test Guild',
        roleName: 'Test Role',
        expiresInHours: undefined
      });
      // addUserRole no longer sends success message or cleans up nonce
      expect(mockInteraction.editReply).not.toHaveBeenCalled();
      expect(service.tempMessages[nonce]).toBeDefined(); // Should still exist
    });

    it('should handle error when guild not found', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;

      await expect(
        service.addUserRole('user-id', 'role-id', 'invalid-guild', 'wallet-address', nonce)
      ).rejects.toThrow('Guild not found');
    });

    it('should handle error when no stored interaction', async () => {
      await expect(
        service.addUserRole('user-id', 'role-id', 'guild-id', 'wallet-address', 'invalid-nonce')
      ).rejects.toThrow('No stored interaction found for this nonce');
    });
  });

  describe('throwError', () => {
    it('should send error message to user', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;

      await service.throwError(nonce, 'Test error message');

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              title: 'Verification Failed',
              description: 'Test error message'
            })
          })
        ]),
        components: [] // Expect components to be cleared
      });
      expect(service.tempMessages[nonce]).toBeUndefined();
    });

    it('should remove verify button when sending error message', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;

      await service.throwError(nonce, 'Test error message');

      // Verify that components array is empty (no "Verify Now" button)
      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      expect(editReplyCall.components).toEqual([]);
    });

    it('should handle missing stored interaction gracefully', async () => {
      // Should not throw error
      await service.throwError('invalid-nonce', 'Test error');
    });
  });

  describe('sendVerificationComplete', () => {
    it('should send verification complete message with role names', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: false, matchingCount: 1 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
              data: expect.objectContaining({
                title: 'Verification Successful',
                description: expect.stringContaining('**Test Role**: (1/1) The Test Collection')
              })
            })
          ]),
        components: [] // Expect components to be cleared
      });
      expect(service.tempMessages[nonce]).toBeUndefined(); // Should be cleaned up
    });

    it('should handle multiple roles', async () => {
      const nonce = 'test-nonce';
      const mockRole = { id: 'role-id', name: 'Test Role' };
      const mockRole2 = { id: 'role-id-2', name: 'Test Role 2' };
      // Add the second role to the mock cache
      mockClient.guilds.cache.get('guild-id').roles.cache.get.mockImplementation((roleId: string) => {
        if (roleId === 'role-id') return mockRole;
        if (roleId === 'role-id-2') return mockRole2;
        return undefined;
      });
      service.tempMessages[nonce] = mockInteraction as any;

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: false, ruleId: '1', matchingCount: 1 },
        { roleId: 'role-id-2', roleName: 'Test Role 2', wasAlreadyAssigned: true, ruleId: '2', matchingCount: 1 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({
              title: 'Verification Successful',
              description: expect.stringMatching(/New Roles Assigned[\s\S]*Test Role[\s\S]*Roles You Already Have[\s\S]*Test Role 2/)
            })
          })
        ]),
        components: [] // Expect components to be cleared
      });
    });

    it('should deduplicate duplicate role IDs in the roles list', async () => {
      const nonce = 'test-nonce';
      const mockRole = { id: 'role-id', name: 'GIF Goddess' };
      // Mock the role cache
      mockClient.guilds.cache.get('guild-id').roles.cache.get.mockImplementation((roleId: string) => {
        if (roleId === 'role-id') return mockRole;
        return undefined;
      });
      service.tempMessages[nonce] = mockInteraction as any;

      // Pass duplicate role IDs (same role assigned by multiple rules)
      const roleResults = [
        { roleId: 'role-id', roleName: 'GIF Goddess', wasAlreadyAssigned: false, ruleId: '1', matchingCount: 1 },
        { roleId: 'role-id', roleName: 'GIF Goddess', wasAlreadyAssigned: false, ruleId: '1', matchingCount: 1 },
        { roleId: 'role-id', roleName: 'GIF Goddess', wasAlreadyAssigned: false, ruleId: '1', matchingCount: 1 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: expect.arrayContaining([
          expect.objectContaining({
              data: expect.objectContaining({
                title: 'Verification Successful',
                description: expect.stringContaining('**GIF Goddess**: (1/1) The Test Collection')
              })
            })
          ]),
        components: [] // Expect components to be cleared
      });
      
      // Verify that 'GIF Goddess' appears only once in the description
      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;
      const matches = description.match(/\*\*GIF Goddess\*\*/g);
      expect(matches).toHaveLength(1); // Should appear only once, not three times
    });

    it('should list all matched requirements for a role the user already has', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getRoleMappings.mockResolvedValueOnce([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'Eyes',
          attribute_value: 'Laser'
        },
        {
          id: 2,
          role_id: 'role-id',
          slug: 'other-collection',
          min_items: 1,
          attribute_key: 'Type',
          attribute_value: 'Gold'
        }
      ]);

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '1', matchingCount: 3 },
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '2', matchingCount: 1 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults);

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;

      expect(description).toContain('**✅ Roles You Already Have:**');
      expect(description).toContain('**Test Role**:');
      expect(description).toContain(' ↳ 3 Comrades with Eyes: Laser');
      expect(description).toContain(' ↳ 1 Misprint with Type: Gold');
      expect(description).not.toContain('• **');

      const matches = description.match(/\*\*Test Role\*\*/g);
      expect(matches).toHaveLength(1);
    });

    it('should show owned quantity-based multi-collection roles with a progress prefix and collection separators', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getRoleMappings.mockResolvedValueOnce([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection,other-collection,third-collection',
          min_items: 15,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        }
      ]);

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '1', matchingCount: 334 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults);

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;
      const normalizedDescription = description.replace(/\u00A0/g, ' ');

      expect(normalizedDescription).toContain('**✅ Roles You Already Have:**');
      expect(normalizedDescription).toContain('**Test Role**: (334/15) The Test Collection ∨ The Other Collection ∨ The Third Collection');
      expect(normalizedDescription).not.toContain('items from');
      expect(description).toContain('\u00A0∨ ');
    });

    it('should aggregate multiple collection-only existing-role matches onto one line', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getRoleMappings.mockResolvedValueOnce([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 2,
          role_id: 'role-id',
          slug: 'other-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 3,
          role_id: 'role-id',
          slug: 'third-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        }
      ]);

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '1', matchingCount: 3 },
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '2', matchingCount: 1 },
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '3', matchingCount: 2 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults);

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;
      const normalizedDescription = description.replace(/\u00A0/g, ' ');

      expect(normalizedDescription).toContain(
        '**Test Role**: (6/1) The Test Collection ∨ The Other Collection ∨ The Third Collection'
      );
      expect(description).not.toContain('(3/1) The Test Collection');
    });

    it('should leave long trait requirements naturally wrappable without forcing visible line breaks', () => {
      const requirement = (service as any).formatRoleRequirement(
        {
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'Classification',
          attribute_value: 'Official Rug Lord Fan Club Glasses',
        },
        {
          'test-collection': {
            name: 'The Test Collection',
            singleName: 'Comrade',
          },
        },
        {
          style: 'requirement',
          matchingCount: 0,
        }
      );

      expect(requirement).toContain(' with Classification: Official Rug Lord Fan Club Glasses');
      expect(requirement).not.toContain('\u00A0');
      expect(requirement).not.toContain('\n');
    });

    it('should format category-only rules as attribute requirements instead of collection-only rules', () => {
      const requirement = (service as any).formatRoleRequirement(
        {
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'Head',
          attribute_value: 'ALL',
        },
        {
          'test-collection': {
            name: 'The Test Collection',
            singleName: 'Comrade',
          },
        },
        {
          style: 'requirement',
          matchingCount: 0,
        }
      );

      expect(requirement).toBe('Own 1+ Comrade with Head');
      expect(requirement).not.toContain('(0/1) The Test Collection');
      expect(requirement).not.toContain('(0/1)');
    });

    it('should format owned category-only rules using the collection noun with the attribute category', () => {
      const requirement = (service as any).formatRoleRequirement(
        {
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'Head',
          attribute_value: 'ALL',
        },
        {
          'test-collection': {
            name: 'The Test Collection',
            singleName: 'Comrade',
          },
        },
        {
          style: 'holding',
          matchingCount: 3,
        }
      );

      expect(requirement).toBe('3 Comrades with Head');
      expect(requirement).not.toContain('(3/1) The Test Collection');
    });

    it('should show unowned verification roles and include all matched reasons', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getRoleMappings.mockResolvedValue([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 2,
          role_id: 'role-id-2',
          slug: 'other-collection',
          min_items: 1,
          attribute_key: 'Head',
          attribute_value: 'Crown'
        },
        {
          id: 3,
          role_id: 'role-id-2',
          slug: 'third-collection',
          min_items: 1,
          attribute_key: 'Type',
          attribute_value: 'Legendary'
        },
        {
          id: 4,
          role_id: 'role-id-3',
          slug: 'third-collection',
          min_items: 2,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 5,
          role_id: 'role-id-4',
          slug: 'other-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 6,
          role_id: 'role-id-5',
          slug: 'third-collection',
          min_items: 1,
          attribute_key: 'Head',
          attribute_value: 'Halo'
        }
      ]);
      mockDataService.checkAssetOwnershipWithCriteria.mockImplementation(async (_addresses, slug, attributeKey, attributeValue) => {
        if (slug === 'other-collection' && attributeKey === 'Head' && attributeValue === 'Crown') return 1;
        if (slug === 'third-collection' && attributeKey === 'Type' && attributeValue === 'Legendary') return 1;
        if (slug === 'third-collection' && attributeKey === 'ALL' && attributeValue === 'ALL') return 2;
        if (slug === 'other-collection' && attributeKey === 'ALL' && attributeValue === 'ALL') return 1;
        if (slug === 'third-collection' && attributeKey === 'Head' && attributeValue === 'Halo') return 1;
        return 0;
      });

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '1', matchingCount: 1 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults, '0xnewwallet');

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;

      expect(mockUserAddressService.getUserAddresses).toHaveBeenCalledWith('user-id');
      expect(description).toContain('**🚀 Additional Roles Available:**');
      expect(description).toContain('**Test Role 2**:');
      expect(description).toContain(' ↳ Own 1+ Misprint with Head: Crown');
      expect(description).toContain(' ↳ Own 1+ EtherPhunk with Type: Legendary');
      expect(description).toContain('**Bonus Role**: (2/2) The Third Collection');
      expect(description).toContain('**Second Bonus Role**: (1/1) The Other Collection');
      expect(description).toContain('**Third Bonus Role**: Own 1+ EtherPhunk with Head: Halo');
      expect(description).not.toContain('items from The Third Collection');
    });

    it('should aggregate multiple collection-only additional roles into one combined total', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getRoleMappings.mockResolvedValue([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 8,
          role_id: 'role-id-4',
          slug: 'other-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 9,
          role_id: 'role-id-4',
          slug: 'third-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        }
      ]);
      mockDataService.checkAssetOwnershipWithCriteria.mockImplementation(async (_addresses, slug, attributeKey, attributeValue) => {
        if (slug === 'other-collection' && attributeKey === 'ALL' && attributeValue === 'ALL') return 1;
        if (slug === 'third-collection' && attributeKey === 'ALL' && attributeValue === 'ALL') return 2;
        return 0;
      });

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '1', matchingCount: 1 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults, '0xnewwallet');

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;
      const normalizedDescription = description.replace(/\u00A0/g, ' ');

      expect(description).toContain('**🚀 Additional Roles Available:**');
      expect(normalizedDescription).toContain('**Second Bonus Role**: (3/1) The Other Collection ∨ The Third Collection');
      expect(description).not.toContain('(1/1) The Other Collection');
      expect(description).not.toContain('(2/1) The Third Collection');
    });

    it('should keep additional roles visible when the user has partial progress toward a higher threshold', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getRoleMappings.mockResolvedValue([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 7,
          role_id: 'role-id-3',
          slug: 'third-collection',
          min_items: 5,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        }
      ]);
      mockDataService.checkAssetOwnershipWithCriteria.mockImplementation(async (_addresses, slug, attributeKey, attributeValue) => {
        if (slug === 'third-collection' && attributeKey === 'ALL' && attributeValue === 'ALL') return 2;
        return 0;
      });

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '1', matchingCount: 1 }
      ];

      const potentialRoles = await (service as any).analyzePotentialRoles(
        'guild-id',
        'user-id',
        ['role-id'],
        '0xnewwallet'
      );

      expect(potentialRoles).toEqual([
        {
          roleId: 'role-id-3',
          roleName: 'Bonus Role',
          matchedRules: [{ ruleId: '7', matchingCount: 2 }],
        }
      ]);

      await service.sendVerificationComplete('guild-id', nonce, roleResults, '0xnewwallet');

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;

      expect(description).toContain('**🚀 Additional Roles Available:**');
      expect(description).toContain('**Bonus Role**: (2/5) The Third Collection');
      expect(description).not.toContain('Own 5+ items from The Third Collection');
    });

    it('should still show additional roles when the user has zero matching holdings for them', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getRoleMappings.mockResolvedValue([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 2,
          role_id: 'role-id-2',
          slug: 'other-collection',
          min_items: 1,
          attribute_key: 'Head',
          attribute_value: 'Crown'
        },
        {
          id: 7,
          role_id: 'role-id-3',
          slug: 'third-collection',
          min_items: 5,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        }
      ]);
      mockDataService.checkAssetOwnershipWithCriteria.mockResolvedValue(0);

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '1', matchingCount: 1 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults, '0xnewwallet');

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;

      expect(description).toContain('**🚀 Additional Roles Available:**');
      expect(description).toContain('**Test Role 2**: Own 1+ Misprint with Head: Crown');
      expect(description).not.toContain('Own 1+ Misprint with Head: Crown (0/1)');
      expect(description).toContain('**Bonus Role**: (0/5) The Third Collection');
    });

    it('should still recommend a role when database history is stale but the member no longer has it in Discord', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getUserRoleHistory.mockResolvedValueOnce([
        { role_id: 'role-id-3', status: 'active' }
      ]);
      mockDbService.getRoleMappings.mockResolvedValueOnce([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 7,
          role_id: 'role-id-3',
          slug: 'third-collection',
          min_items: 2,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        }
      ]);
      mockGuildMember.roles.cache.keys.mockReturnValue([]);
      mockDataService.checkAssetOwnershipWithCriteria.mockImplementation(async (_addresses, slug, attributeKey, attributeValue) => {
        if (slug === 'third-collection' && attributeKey === 'ALL' && attributeValue === 'ALL') return 2;
        return 0;
      });

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '1', matchingCount: 1 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults, '0xnewwallet');

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;

      expect(description).toContain('**🚀 Additional Roles Available:**');
      expect(description).toContain('**Bonus Role**: (2/2) The Third Collection');
    });

    it('should keep a newly assigned role out of the existing roles section even if multiple rules match it', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getRoleMappings.mockResolvedValueOnce([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 3,
          role_id: 'role-id',
          slug: 'third-collection',
          min_items: 1,
          attribute_key: 'Type',
          attribute_value: 'Legendary'
        }
      ]);

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: false, ruleId: '1', matchingCount: 1 },
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: true, ruleId: '3', matchingCount: 2 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults);

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;

      expect(description).toContain('**🎉 New Roles Assigned:**');
      expect(description).not.toContain('**✅ Roles You Already Have:**');
      expect(description).toContain('**Test Role**:');
      expect(description).toContain(' ↳ (1/1) The Test Collection');
      expect(description).toContain(' ↳ 2 EtherPhunks with Type: Legendary');

      const matches = description.match(/\*\*Test Role\*\*/g);
      expect(matches).toHaveLength(1);
    });

    it('should aggregate multiple collection-only new-role matches into one combined total', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;
      mockDbService.getRoleMappings.mockResolvedValueOnce([
        {
          id: 1,
          role_id: 'role-id',
          slug: 'test-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 2,
          role_id: 'role-id',
          slug: 'other-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        },
        {
          id: 3,
          role_id: 'role-id',
          slug: 'third-collection',
          min_items: 1,
          attribute_key: 'ALL',
          attribute_value: 'ALL'
        }
      ]);

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: false, ruleId: '1', matchingCount: 3 },
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: false, ruleId: '2', matchingCount: 1 },
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: false, ruleId: '3', matchingCount: 2 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults);

      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      const description = editReplyCall.embeds[0].data.description;
      const normalizedDescription = description.replace(/\u00A0/g, ' ');

      expect(description).toContain('**🎉 New Roles Assigned:**');
      expect(normalizedDescription).toContain('**Test Role**: (6/1) The Test Collection ∨ The Other Collection ∨ The Third Collection');
      expect(description).not.toContain('(3/1) The Test Collection');
      expect(description).not.toContain('**✅ Roles You Already Have:**');
    });

    it('should remove verify button when sending success message', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: false, matchingCount: 1 }
      ];

      await service.sendVerificationComplete('guild-id', nonce, roleResults);

      // Verify that components array is empty (no "Verify Now" button)
      const editReplyCall = mockInteraction.editReply.mock.calls[0][0];
      expect(editReplyCall.components).toEqual([]);
    });

    it('should handle error when guild not found', async () => {
      const nonce = 'test-nonce';
      service.tempMessages[nonce] = mockInteraction as any;

      const roleResults = [
        { roleId: 'role-id', roleName: 'Test Role', wasAlreadyAssigned: false, matchingCount: 1 }
      ];

      await expect(
        service.sendVerificationComplete('invalid-guild', nonce, roleResults)
      ).rejects.toThrow('Guild not found');
    });
  });
});
