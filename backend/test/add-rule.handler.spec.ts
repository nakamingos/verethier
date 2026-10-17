import { validateEthscriptionCriteria } from '../src/services/discord-commands/utils/rule-validation.util';
import { Erc20OwnershipService } from '../src/services/erc20-ownership.service';
import { NftOwnershipService } from '../src/services/nft-ownership.service';
import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { EthscriptionsOwnershipService } from '../src/services/ethscriptions-ownership.service';
import { Test, TestingModule } from '@nestjs/testing';
import { AddRuleHandler } from '../src/services/discord-commands/handlers/add-rule.handler';
import { DbService } from '../src/services/db.service';
import { DiscordMessageService } from '../src/services/discord-message.service';
import { DiscordService } from '../src/services/discord.service';
import { DataService } from '../src/services/data.service';
import { RuleConfirmationInteractionHandler } from '../src/services/discord-commands/interactions/rule-confirmation.interaction';
import { DuplicateRuleConfirmationInteractionHandler } from '../src/services/discord-commands/interactions/duplicate-rule-confirmation.interaction';
import { RemovalUndoInteractionHandler } from '../src/services/discord-commands/interactions/removal-undo.interaction';
import { ChannelType } from 'discord.js';

const mockTokenService = { prepareRule: jest.fn() };
const mockNftService = { prepareRule: jest.fn(), validateTraits: jest.fn() };
const mockEthscriptionsService = { prepareInscriptionRule: jest.fn() };
const mockOrdinalsService = { prepareRule: jest.fn(), prepareTraitSnapshot: jest.fn(), prepareInscriptionRule: jest.fn() };

const mockDbService = {
  checkForExactDuplicateRule: jest.fn(),
  checkForDuplicateRule: jest.fn(),
  checkForDuplicateRole: jest.fn(),
  addRoleMapping: jest.fn(),
  getRulesByChannel: jest.fn(),
  updateRuleMessageId: jest.fn(),
};

const mockDiscordMessageService = {
  findExistingVerificationMessage: jest.fn(),
  createVerificationMessage: jest.fn(),
};

const mockDiscordService = {
  getRole: jest.fn(),
};

const mockDataService = {
  getAllSlugs: jest.fn(),
  getAttributeKeys: jest.fn(),
  getAllAttributeValues: jest.fn(),
};

const mockRemovalUndoInteractionHandler = {
  setupRemovalButtonHandler: jest.fn(),
};

const mockRuleConfirmationHandler = {
  storeConfirmationData: jest.fn(),
  createConfirmationButtons: jest.fn().mockReturnValue({
    type: 1, // ActionRow
    components: [
      {
        type: 2, // Button
        custom_id: 'undo_rule_test',
        label: 'Undo',
        style: 4, // Danger
        emoji: { name: '↩️' }
      }
    ]
  }),
  setupConfirmationButtonHandler: jest.fn(),
};

const mockDuplicateRuleConfirmationHandler = {
  storeRuleData: jest.fn(),
  createDuplicateRuleButtons: jest.fn().mockReturnValue({
    type: 1, // ActionRow
    components: [
      {
        type: 2, // Button
        custom_id: 'confirm_duplicate_test',
        label: 'Create Anyway',
        style: 4, // Danger
        emoji: { name: '✅' }
      },
      {
        type: 2, // Button
        custom_id: 'cancel_duplicate_test',
        label: 'Cancel',
        style: 2, // Secondary
        emoji: { name: '❌' }
      }
    ]
  }),
  setupDuplicateRuleButtonHandler: jest.fn(),
  createUndoRemovalButton: jest.fn().mockReturnValue({
    type: 1, // ActionRow
    components: [
      {
        type: 2, // Button
        custom_id: 'undo_cancellation_test',
        label: 'Undo',
        style: 1, // Primary
        emoji: { name: '↩️' }
      }
    ]
  }),
  setupCancellationButtonHandler: jest.fn(),
  getPendingRule: jest.fn(),
  deletePendingRule: jest.fn(),
  storeCancelledRule: jest.fn(),
  getCancelledRule: jest.fn(),
  deleteCancelledRule: jest.fn(),
  createRuleInfoFields: jest.fn().mockReturnValue([
    { name: '**Collection**', value: 'test-collection', inline: true },
    { name: '**Attribute**', value: 'test-attribute=test-value', inline: true },
    { name: '**Min Items**', value: '1', inline: true }
  ]),
};

describe('AddRuleHandler', () => {
  let handler: AddRuleHandler;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AddRuleHandler,
        { provide: Erc20OwnershipService, useValue: mockTokenService },
        { provide: NftOwnershipService, useValue: mockNftService },
        { provide: OrdinalsOwnershipService, useValue: mockOrdinalsService },
        { provide: EthscriptionsOwnershipService, useValue: mockEthscriptionsService },
        { provide: DbService, useValue: mockDbService },
        { provide: DiscordMessageService, useValue: mockDiscordMessageService },
        { provide: DiscordService, useValue: mockDiscordService },
        { provide: DataService, useValue: mockDataService },
        { provide: RuleConfirmationInteractionHandler, useValue: mockRuleConfirmationHandler },
        { provide: DuplicateRuleConfirmationInteractionHandler, useValue: mockDuplicateRuleConfirmationHandler },
      ],
    }).compile();

    handler = module.get<AddRuleHandler>(AddRuleHandler);
    jest.clearAllMocks();
    mockNftService.validateTraits.mockReset().mockResolvedValue(undefined);
    
    // Setup default mock return values
    mockDataService.getAllSlugs.mockResolvedValue(['test-collection', 'another-collection', 'example-slug']);
  });

  it('saves canonical collection/trait spelling when creation input uses spaces and different case', async () => {
    mockDataService.getAllSlugs.mockResolvedValue(['Pizza-Comrades']);
    mockDataService.getAttributeKeys.mockResolvedValue(['EyeColor']);
    mockDataService.getAllAttributeValues.mockResolvedValue(['Gold Crown']);
    const values = {role: 'Gold Crown Holders', slug: ' PIZZA   COMRADES ', attribute_key: ' eyecolor ', attribute_value: ' gold crown '};
    const interaction = { options: { getChannel: () => ({id: 'channel'}), getString: key => values[key] ?? null, getInteger: () => 10 }, editReply: jest.fn() };
    expect(await (handler as any).validateInputParams(interaction, 'ethscription')).toMatchObject({
      roleName: 'Gold Crown Holders', slug: 'Pizza-Comrades', attributeKey: 'EyeColor', attributeValue: 'Gold Crown', minItems: 10,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  describe('handle', () => {
    it('should validate input parameters', async () => {
      const mockInteraction = {
        id: 'interaction-123',
        guild: { id: 'guild-id', name: 'test-guild' },
        user: { tag: 'test-user#1234' },
        options: {
          getChannel: jest.fn().mockReturnValue(null), // Invalid channel
          getString: jest.fn().mockReturnValue('Test Role'),
          getInteger: jest.fn(),
        },
        deferReply: jest.fn(),
        editReply: jest.fn(),
      } as any;

      await handler.handle(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 });
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('Channel and role are required')
      });
    });

    it('should successfully validate correct input parameters', async () => {
      const mockChannel = { id: 'channel-id', name: 'test-channel', type: ChannelType.GuildText };
      const mockRole = { id: 'role-id', name: 'Test Role', editable: true };
      
      const mockInteraction = {
        id: 'interaction-123',
        guild: {
          id: 'guild-id',
          name: 'test-guild',
          roles: {
            cache: {
              find: jest.fn().mockReturnValue(mockRole)
            }
          }
        },
        user: { tag: 'test-user#1234' },
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel),
          getString: jest.fn((key: string) => {
            if (key === 'role') return 'Test Role';
            if (key === 'slug') return 'test-collection';
            return null;
          }),
          getInteger: jest.fn().mockReturnValue(null),
        },
        deferReply: jest.fn(),
        editReply: jest.fn(),
        followUp: jest.fn(),
      } as any;

      // Mock successful validation and creation
      mockDbService.checkForExactDuplicateRule.mockResolvedValue(null);
      mockDbService.checkForDuplicateRule.mockResolvedValue(null);
      mockDbService.checkForDuplicateRole.mockResolvedValue(null);
      mockDbService.getRulesByChannel.mockResolvedValue([]);
      mockDbService.addRoleMapping.mockResolvedValue({ id: 1 });
      mockDiscordMessageService.findExistingVerificationMessage.mockResolvedValue(false);

      await handler.handle(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 });
      // Should get to duplicate checking since validation passed
      expect(mockDbService.checkForExactDuplicateRule).toHaveBeenCalled();
    });

    it.each([
      ['New Role', 'New Role'],
      ['💡 Create new role: "Cosmic Oven-Lord"', 'Cosmic Oven-Lord']
    ])('creates and saves only the role name when submitted as %s', async (submittedName, roleName) => {
      const mockChannel = { id: 'channel-id', name: 'test-channel', type: ChannelType.GuildText };
      
      const mockInteraction = {
        id: 'interaction-123',
        guild: {
          id: 'guild-id',
          name: 'test-guild',
          roles: {
            cache: {
              find: jest.fn().mockReturnValue(null) // Role doesn't exist
            },
            create: jest.fn().mockResolvedValue({
              id: 'new-role-id',
              name: roleName,
              editable: true
            })
          },
          members: {
            me: {
              roles: {
                highest: { position: 5 }
              }
            }
          }
        },
        user: { tag: 'test-user#1234' },
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel),
          getString: jest.fn((key: string) => {
            if (key === 'role') return submittedName;
            if (key === 'slug') return 'test-collection';
            return null;
          }),
          getInteger: jest.fn().mockReturnValue(null),
        },
        deferReply: jest.fn(),
        editReply: jest.fn(),
        followUp: jest.fn(),
      } as any;

      // Mock successful validation and creation
      mockDbService.checkForExactDuplicateRule.mockResolvedValue(null);
      mockDbService.checkForDuplicateRule.mockResolvedValue(null);
      mockDbService.checkForDuplicateRole.mockResolvedValue(null);
      mockDbService.getRulesByChannel.mockResolvedValue([]);
      mockDbService.addRoleMapping.mockResolvedValue({ id: 1 });
      mockDiscordMessageService.findExistingVerificationMessage.mockResolvedValue(false);

      await handler.handle(mockInteraction);

      expect(mockInteraction.guild.roles.create).toHaveBeenCalledWith({
        name: roleName,
        color: 'Blue',
        position: 4, // Bot's highest position (5) - 1
        reason: 'Auto-created for verification rule by test-user#1234'
      });
      expect(mockDbService.addRoleMapping).toHaveBeenCalledWith(
        'guild-id', 'test-guild', 'channel-id', 'test-channel', 'test-collection',
        'new-role-id', roleName, 'ALL', 'ALL', 1, undefined
      );
      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.arrayContaining([
            expect.objectContaining({
              data: expect.objectContaining({
                fields: expect.arrayContaining([
                  expect.objectContaining({
                    name: '🆕 New Role Created',
                    value: `The role <@&new-role-id> was created for this verification rule.`
                  })
                ])
              })
            })
          ])
        })
      );
    });

    it('should detect exact duplicate rules', async () => {
      const mockChannel = { id: 'channel-id', name: 'test-channel', type: ChannelType.GuildText };
      const mockRole = { id: 'role-id', name: 'Test Role', editable: true };
      
      const mockInteraction = {
        id: 'interaction-123',
        guild: {
          id: 'guild-id',
          name: 'test-guild',
          roles: {
            cache: {
              find: jest.fn().mockReturnValue(mockRole)
            }
          }
        },
        user: { tag: 'test-user#1234' },
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel),
          getString: jest.fn((key: string) => {
            if (key === 'role') return 'Test Role';
            if (key === 'slug') return 'test-collection';
            return null;
          }),
          getInteger: jest.fn().mockReturnValue(null),
        },
        deferReply: jest.fn(),
        editReply: jest.fn(),
        followUp: jest.fn(),
      } as any;

      // Mock exact duplicate found
      mockDbService.checkForExactDuplicateRule.mockResolvedValue({
        id: 1,
        role_id: 'role-id',
        slug: 'test-collection',
        attribute_key: 'ALL',
        attribute_value: 'ALL',
        min_items: 1
      });

      await handler.handle(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            title: expect.stringContaining('Exact Duplicate Rule'),
            color: 16711680, // Red color for error
          })
        })]
      });
    });
  });

  describe('validateInputParams', () => {
    it('should return null for missing channel', async () => {
      const mockInteraction = {
        options: {
          getChannel: jest.fn().mockReturnValue(null),
          getString: jest.fn().mockReturnValue('Test Role'),
          getInteger: jest.fn(),
        },
        editReply: jest.fn(),
      } as any;

      const result = await (handler as any).validateInputParams(mockInteraction);

      expect(result).toBeNull();
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should return null for missing role', async () => {
      const mockChannel = { id: 'channel-id', name: 'test-channel' };
      const mockInteraction = {
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel),
          getString: jest.fn().mockReturnValue(null),
          getInteger: jest.fn(),
        },
        editReply: jest.fn(),
      } as any;

      const result = await (handler as any).validateInputParams(mockInteraction);

      expect(result).toBeNull();
      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    it('should return parameters with defaults for valid input', async () => {
      const mockChannel = { id: 'channel-id', name: 'test-channel' };
      const mockInteraction = {
        options: {
          getChannel: jest.fn().mockReturnValue(mockChannel),
          getString: jest.fn((key: string) => {
            if (key === 'role') return 'Test Role';
            return null; // All other strings return null for default testing
          }),
          getInteger: jest.fn().mockReturnValue(null),
        },
        editReply: jest.fn(),
      } as any;

      const result = await (handler as any).validateInputParams(mockInteraction);

      expect(result).toEqual({
        channel: mockChannel,
        roleName: 'Test Role',
        slug: 'ALL',
        attributeKey: 'ALL',
        attributeValue: 'ALL',
        minItems: 1
      });
    });

    it('keeps the Ethscriptions ALL default when selected by the command', async () => {
      const channel = { id: 'channel-id', name: 'verify' };
      const interaction = {
        options: {
          getChannel: jest.fn().mockReturnValue(channel),
          getString: jest.fn(key => {
            if (key === 'asset_type') throw new Error('No asset_type option on the new command');
            return key === 'role' ? 'Holder' : null;
          }),
          getInteger: jest.fn().mockReturnValue(null)
        },
        editReply: jest.fn()
      } as any;
      expect(await (handler as any).validateInputParams(interaction, 'ethscription')).toEqual({
        channel, roleName: 'Holder', slug: 'ALL', attributeKey: 'ALL', attributeValue: 'ALL', minItems: 1
      });
      expect(interaction.options.getString).not.toHaveBeenCalledWith('asset_type');
    });
  });
  describe('Ordinals setup', () => {
    const fields = { asset_type: 'ordinal', slug: 'pizza-comrades', chain_id: null, collection_name: 'Pizza Comrades',
      contract_address: null, token_standard: null, token_ids: null };
    function interactionFor(options = {}) {
      const inputs = { role: 'Holder', asset_type: 'ordinal', slug: 'pizza-comrades', ...options };
      return {
        id: 'ordinal-setup', guild: { id: 'guild-id', name: 'Guild', roles: {
          cache: { find: jest.fn().mockReturnValue({ id: 'role-id', name: 'Holder', editable: true }) }, create: jest.fn(),
        } }, user: { id: 'admin', tag: 'admin' },
        options: { getChannel: jest.fn().mockReturnValue({ id: 'channel-id', name: 'verify', type: ChannelType.GuildText }),
          getString: jest.fn(key => inputs[key] ?? null), getInteger: jest.fn().mockReturnValue(10) },
        deferReply: jest.fn(), editReply: jest.fn(), followUp: jest.fn(),
      } as any;
    }
    it('uses the existing rule, duplicate and undo flow with the provider collection name', async () => {
      mockOrdinalsService.prepareRule.mockResolvedValue(fields);
      mockDbService.checkForExactDuplicateRule.mockResolvedValue(null);
      mockDbService.checkForDuplicateRule.mockResolvedValue(null);
      mockDbService.getRulesByChannel.mockResolvedValue([]);
      mockDbService.addRoleMapping.mockResolvedValue({ id: 11, ...fields });
      mockDiscordMessageService.findExistingVerificationMessage.mockResolvedValue(true);
      const interaction = interactionFor({ asset_type: null });
      await handler.handle(interaction, 'ordinal');
      expect(interaction.options.getString).not.toHaveBeenCalledWith('asset_type');
      expect(mockOrdinalsService.prepareRule).toHaveBeenCalledWith('pizza-comrades');
      expect(mockNftService.prepareRule).not.toHaveBeenCalled();
      expect(mockDataService.getAllSlugs).not.toHaveBeenCalled();
      expect(mockDbService.checkForExactDuplicateRule).toHaveBeenCalledWith('guild-id', 'channel-id', 'pizza-comrades', 'ALL', 'ALL', 10, 'role-id', fields);
      expect(mockDbService.addRoleMapping).toHaveBeenCalledWith('guild-id', 'Guild', 'channel-id', 'verify', 'pizza-comrades', 'role-id', 'Holder', 'ALL', 'ALL', 10, fields);
      expect(mockDuplicateRuleConfirmationHandler.createRuleInfoFields).toHaveBeenCalledWith(expect.objectContaining(fields));
      expect(mockRuleConfirmationHandler.storeConfirmationData).toHaveBeenCalled();
    });
    it.each([{ network: 'ethereum' },
      { token_ids: '1' }, { collection_name: 'Custom' }, { contract_address: '0x' + '1'.repeat(40) }])(
      'rejects unsupported options before creating a role or checking the provider: %s', async options => {
        const interaction = interactionFor(options);
        interaction.guild.roles.cache.find.mockReturnValue(null);
        await handler.handle(interaction);
        expect(mockOrdinalsService.prepareRule).not.toHaveBeenCalled();
        expect(interaction.guild.roles.create).not.toHaveBeenCalled();
        expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Leave NFT network and contract options empty') });
      });
    it('normalizes traits and saves the full snapshot through the existing rule flow', async () => {
      const snapshot = { inscription_ids: ['a'.repeat(64) + 'i0'], criteria_hash: 'b'.repeat(64), fetched_at: new Date().toISOString() };
      mockOrdinalsService.prepareRule.mockResolvedValue({ ...fields });
      mockOrdinalsService.prepareTraitSnapshot.mockResolvedValue(snapshot);
      mockDbService.checkForExactDuplicateRule.mockResolvedValue(null);
      mockDbService.checkForDuplicateRule.mockResolvedValue(null);
      mockDbService.getRulesByChannel.mockResolvedValue([]);
      mockDbService.addRoleMapping.mockResolvedValue({ id: 11, ...fields, ordinal_trait_snapshot: snapshot });
      mockDiscordMessageService.findExistingVerificationMessage.mockResolvedValue(true);
      await handler.handle(interactionFor({ attribute_key: ' Hat ', attribute_value: ' Red ' }));
      expect(mockOrdinalsService.prepareTraitSnapshot).toHaveBeenCalledWith({ ...fields, attribute_key: 'Hat', attribute_value: 'Red' });
      expect(mockDbService.addRoleMapping).toHaveBeenCalledWith('guild-id', 'Guild', 'channel-id', 'verify', 'pizza-comrades', 'role-id', 'Holder', 'Hat', 'Red', 10, { ...fields, ordinal_trait_snapshot: snapshot });
    });
    it('rejects a value without a key before creating a role', async () => {
      const interaction = interactionFor({ attribute_value: 'Red' });
      await handler.handle(interaction);
      expect(mockOrdinalsService.prepareRule).not.toHaveBeenCalled();
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Select an attribute_key') });
    });
    it('does not create a trait rule after a failed or incomplete snapshot scan', async () => {
      mockOrdinalsService.prepareRule.mockResolvedValue({ ...fields });
      mockOrdinalsService.prepareTraitSnapshot.mockRejectedValue(new Error('Ordinals trait verification is temporarily unavailable.'));
      const interaction = interactionFor({ attribute_key: 'Hat' });
      await handler.handle(interaction);
      expect(interaction.guild.roles.create).not.toHaveBeenCalled();
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
    });
    it('reports unknown collections before creating roles or saving rules', async () => {
      mockOrdinalsService.prepareRule.mockRejectedValue(new Error('This collection was not found on Xverse. Check its collection slug.'));
      const interaction = interactionFor({ slug: 'unknown' });
      await handler.handle(interaction);
      expect(interaction.guild.roles.create).not.toHaveBeenCalled();
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('not found on Xverse') });
    });
  });
  describe('Specific inscription setup', () => {
    const id = 'a'.repeat(64) + 'i0';
    const ethHash = '0x' + 'a'.repeat(64);
    function interactionFor(options: Record<string, any> = {}) {
      const inputs = { role: 'Special', asset_type: 'ordinal', inscription_ids: id, ...options };
      return { id: 'specific-setup', guild: { id: 'guild-id', name: 'Guild', roles: {
        cache: { find: jest.fn().mockReturnValue({ id: 'role-id', name: 'Special', editable: true }) }, create: jest.fn(),
      } }, user: { id: 'admin', tag: 'admin' },
      options: { getChannel: jest.fn().mockReturnValue({ id: 'channel-id', name: 'verify', type: ChannelType.GuildText }),
        getString: jest.fn(key => inputs[key] ?? null), getInteger: jest.fn().mockReturnValue(1) },
      deferReply: jest.fn(), editReply: jest.fn(), followUp: jest.fn() } as any;
    }
    it.each(['ordinal', 'ethscription'] as const)('saves %s selections through duplicate detection, confirmation, and undo', async assetType => {
      const criteria = { kind: 'ids', ids: [assetType === 'ordinal' ? id : ethHash] };
      const fields = { asset_type: assetType, slug: null, chain_id: assetType === 'ordinal' ? null : 1,
        contract_address: null, token_standard: null, token_ids: null, collection_name: null, inscription_criteria: criteria };
      const provider = assetType === 'ordinal' ? mockOrdinalsService : mockEthscriptionsService;
      provider.prepareInscriptionRule.mockResolvedValue(fields);
      mockDbService.checkForExactDuplicateRule.mockResolvedValue(null);
      mockDbService.checkForDuplicateRule.mockResolvedValue(null);
      mockDbService.getRulesByChannel.mockResolvedValue([]);
      mockDbService.addRoleMapping.mockResolvedValue({ id: 12, ...fields });
      mockDiscordMessageService.findExistingVerificationMessage.mockResolvedValue(true);
      const interaction = interactionFor({ asset_type: null, inscription_ids: criteria.ids[0] });
      await handler.handle(interaction, assetType);
      expect(interaction.options.getString).not.toHaveBeenCalledWith('asset_type');
      expect(provider.prepareInscriptionRule).toHaveBeenCalledWith(criteria.ids[0], null, 1);
      expect(mockDataService.getAllSlugs).not.toHaveBeenCalled();
      expect(mockDbService.checkForExactDuplicateRule).toHaveBeenCalledWith('guild-id', 'channel-id', null, 'ALL', 'ALL', 1, 'role-id', fields);
      expect(mockDbService.addRoleMapping).toHaveBeenCalledWith('guild-id', 'Guild', 'channel-id', 'verify', null, 'role-id', 'Special', 'ALL', 'ALL', 1, fields);
      expect(mockRuleConfirmationHandler.storeConfirmationData).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ruleId: 12, slug: null }));
    });
    it.each([{ slug: 'yonder' }, { attribute_key: 'Hat' }, { attribute_value: 'Pirate' }, { token_ids: '1' }, { network: 'ethereum' }])('rejects mixed selection criteria before creating roles: %s', async options => {
      const interaction = interactionFor(options);
      await handler.handle(interaction);
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
      expect(mockOrdinalsService.prepareInscriptionRule).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Leave slug, attributes, and NFT options empty') });
    });
    it('rejects inscription options on NFT rules', async () => {
      const interaction = interactionFor({ asset_type: 'nft' });
      await handler.handle(interaction);
      expect(mockNftService.prepareRule).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Use /setup add-ordinals-rule or /setup add-ethscription-rule') });
    });
    it.each(['ordinal', 'ethscription'] as const)('passes global %s number ranges through the existing setup flow', async assetType => {
      const provider = assetType === 'ordinal' ? mockOrdinalsService : mockEthscriptionsService;
      provider.prepareInscriptionRule.mockResolvedValue({ asset_type: assetType, slug: null, inscription_criteria: { kind: 'numbers', ranges: [[0, 99999]] } });
      const result = await (handler as any).validateInputParams(interactionFor({ asset_type: null, inscription_ids: null, inscription_numbers: '0-99999' }), assetType);
      expect(provider.prepareInscriptionRule).toHaveBeenCalledWith(null, '0-99999', 1);
      expect(result.slug).toBeNull();
    });
  });
  describe('NFT setup', () => {
    const fields = { asset_type: 'nft', chain_id: 1, contract_address: '0x1111111111111111111111111111111111111111', token_standard: 'erc1155', token_ids: ['0', '1'], collection_name: 'Example' };
    function interactionFor(options = {}, minItems = 1) {
      const role = { id: 'role-id', name: 'Holder', editable: true };
      const inputs = { role: 'Holder', asset_type: 'nft', contract_address: fields.contract_address, ...options };
      return {
        id: 'nft-setup', guild: { id: 'guild-id', name: 'Guild', roles: { cache: { find: jest.fn().mockReturnValue(role) } } },
        user: { id: 'admin', tag: 'admin' },
        options: { getChannel: jest.fn().mockReturnValue({ id: 'channel-id', name: 'verify', type: ChannelType.GuildText }), getString: jest.fn(key => inputs[key] ?? null), getInteger: jest.fn().mockReturnValue(minItems) },
        deferReply: jest.fn(), editReply: jest.fn(), followUp: jest.fn(),
      } as any;
    }
    it('saves NFT criteria using the existing command and confirmation flow', async () => {
      mockNftService.prepareRule.mockResolvedValue(fields);
      mockDbService.checkForExactDuplicateRule.mockResolvedValue(null);
      mockDbService.checkForDuplicateRule.mockResolvedValue(null);
      mockDbService.getRulesByChannel.mockResolvedValue([]);
      mockDbService.addRoleMapping.mockResolvedValue({ id: 10, ...fields });
      mockDiscordMessageService.findExistingVerificationMessage.mockResolvedValue(true);
      const interaction = interactionFor({ asset_type: null, token_ids: '0-1', collection_name: 'Example' }, 2);
      await handler.handle(interaction, 'nft');
      expect(interaction.options.getString).not.toHaveBeenCalledWith('asset_type');
      expect(mockNftService.prepareRule).toHaveBeenCalledWith(fields.contract_address, '0-1', 'Example', 1);
      expect(mockDataService.getAllSlugs).not.toHaveBeenCalled();
      expect(mockDbService.checkForExactDuplicateRule).toHaveBeenCalledWith('guild-id', 'channel-id', 'ALL', 'ALL', 'ALL', 2, 'role-id', fields);
      expect(mockDbService.addRoleMapping).toHaveBeenCalledWith('guild-id', 'Guild', 'channel-id', 'verify', 'ALL', 'role-id', 'Holder', 'ALL', 'ALL', 2, fields);
      expect(mockDuplicateRuleConfirmationHandler.createRuleInfoFields).toHaveBeenCalledWith(expect.objectContaining(fields));
      expect(mockRuleConfirmationHandler.storeConfirmationData).toHaveBeenCalled();
    });
    it('stores the selected Robinhood network through the same setup flow', async () => {
      const robinhood = { ...fields, chain_id: 4663 };
      mockNftService.prepareRule.mockResolvedValue(robinhood);
      const result = await (handler as any).validateInputParams(interactionFor({ network: 'robinhood' }));
      expect(mockNftService.prepareRule).toHaveBeenCalledWith(fields.contract_address, null, null, 4663);
      expect(result.assetFields).toEqual(robinhood);
    });
    it('rejects unsupported networks before checking a contract', async () => {
      const interaction = interactionFor({ network: 'base' });
      await handler.handle(interaction);
      expect(mockNftService.prepareRule).not.toHaveBeenCalled();
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Select Ethereum or Robinhood') });
    });
    it('rejects network options for Ethscriptions rules', async () => {
      const interaction = interactionFor({ asset_type: 'ethscription', contract_address: null, network: 'robinhood' });
      await handler.handle(interaction);
      expect(mockNftService.prepareRule).not.toHaveBeenCalled();
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Use /setup add-nft-rule for network') });
    });
    it.each([{ slug: 'example' }, { contract_address: null }])('rejects missing contract or mixed criteria: %s', async options => {
      const interaction = interactionFor(options);
      await handler.handle(interaction);
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('NFT rules require contract_address') });
    });
    it('rejects quantity greater than one for a specific ERC-721 ID', async () => {
      mockNftService.prepareRule.mockResolvedValue({ ...fields, token_standard: 'erc721', token_ids: ['0'] });
      const interaction = interactionFor({ token_ids: '0' }, 2);
      await handler.handle(interaction);
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('requires min_items:1') });
    });
    it('normalizes trait inputs and carries them through duplicate checks and saving', async () => {
      mockNftService.prepareRule.mockResolvedValue(fields);
      mockDbService.checkForExactDuplicateRule.mockResolvedValue(null);
      mockDbService.checkForDuplicateRule.mockResolvedValue(null);
      mockDbService.getRulesByChannel.mockResolvedValue([]);
      mockDbService.addRoleMapping.mockResolvedValue({ id: 11, ...fields, attribute_key: 'Color', attribute_value: 'Red' });
      mockDiscordMessageService.findExistingVerificationMessage.mockResolvedValue(true);
      await handler.handle(interactionFor({ attribute_key: ' Color ', attribute_value: ' Red ' }, 3));
      expect(mockNftService.validateTraits).toHaveBeenCalledWith({ ...fields, attribute_key: 'Color', attribute_value: 'Red' });
      expect(mockDbService.checkForExactDuplicateRule).toHaveBeenCalledWith('guild-id', 'channel-id', 'ALL', 'Color', 'Red', 3, 'role-id', fields);
      expect(mockDbService.addRoleMapping).toHaveBeenCalledWith('guild-id', 'Guild', 'channel-id', 'verify', 'ALL', 'role-id', 'Holder', 'Color', 'Red', 3, fields);
      expect(mockDuplicateRuleConfirmationHandler.createRuleInfoFields).toHaveBeenCalledWith(expect.objectContaining({ attribute_key: 'Color', attribute_value: 'Red' }));
    });
    it('allows a trait key with any value', async () => {
      mockNftService.prepareRule.mockResolvedValue(fields);
      const result = await (handler as any).validateInputParams(interactionFor({ attribute_key: 'Color' }));
      expect(result).toMatchObject({ attributeKey: 'Color', attributeValue: 'ALL' });
    });
    it('requires a key before a value', async () => {
      const interaction = interactionFor({ attribute_value: 'Red' });
      await handler.handle(interaction);
      expect(mockNftService.prepareRule).not.toHaveBeenCalled();
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Select an attribute_key') });
    });
    it('does not save a trait rule when metadata access is unavailable', async () => {
      mockNftService.prepareRule.mockResolvedValue(fields);
      mockNftService.validateTraits.mockRejectedValue(new Error('NFT trait verification is temporarily unavailable. Please try again.'));
      const interaction = interactionFor({ attribute_key: 'Color', attribute_value: 'Red' });
      await handler.handle(interaction);
      expect(mockDbService.addRoleMapping).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('temporarily unavailable') });
    });
  });

  describe('ERC-20 rule setup', () => {
    const token = { asset_type: 'erc20', chain_id: 4663, contract_address: '0x' + '1'.repeat(40), token_decimals: 6,
      min_balance: '500000', token_symbol: 'TEST', collection_name: 'Test', token_standard: null, token_ids: null };
    function interaction(extra = {}) {
      const options = { role: 'Holder', contract_address: token.contract_address, min_balance: '0.5', network: 'robinhood', ...extra };
      return { options: { getString: jest.fn(name => options[name] ?? null), getInteger: jest.fn(() => null),
        getChannel: jest.fn(() => ({ id: 'channel' })) }, editReply: jest.fn() };
    }
    it('prepares fractional balances with the selected network and keeps item criteria empty', async () => {
      mockTokenService.prepareRule.mockResolvedValue(token);
      const input = interaction();
      const result = await (handler as any).validateInputParams(input, 'erc20');
      expect(mockTokenService.prepareRule).toHaveBeenCalledWith(token.contract_address, '0.5', 4663);
      expect(result).toMatchObject({ slug: null, attributeKey: 'ALL', attributeValue: 'ALL', minItems: null, assetFields: token });
      expect(mockDataService.getAllSlugs).not.toHaveBeenCalled();
      expect(mockNftService.prepareRule).not.toHaveBeenCalled();
    });
    it.each([{ min_balance: null }, { slug: 'collection' }, { attribute_key: 'Trait' }, { token_ids: '1' }, { inscription_numbers: '1' }])('rejects missing amounts or mixed asset options: %s', async extra => {
      const input = interaction(extra);
      expect(await (handler as any).validateInputParams(input, 'erc20')).toBeNull();
      expect(input.editReply).toHaveBeenCalled();
    });
  });

});

describe('single collection setup validation', () => {
  it('rejects comma-separated slugs before querying collection or attribute suggestions', async () => {
    const data = { getAllSlugs: jest.fn() };
    const result = await validateEthscriptionCriteria(data as any, 'comrades,other', 'ALL', 'ALL');
    expect(result).toEqual({ isValid: false, message: expect.stringContaining('one collection per rule') });
    expect(data.getAllSlugs).not.toHaveBeenCalled();
  });
});
