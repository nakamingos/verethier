import { Test, TestingModule } from '@nestjs/testing';
import { ListRulesHandler } from '../src/services/discord-commands/handlers/list-rules.handler';
import { DbService } from '../src/services/db.service';
import { AdminFeedback } from '../src/services/utils/admin-feedback.util';
import { formatAttribute } from '../src/services/discord-commands/utils/rule-validation.util';
import { ButtonInteraction } from 'discord.js';

describe('ListRulesHandler', () => {
  let handler: ListRulesHandler;
  let mockDbService: jest.Mocked<DbService>;
  let mockInteraction: any;

  const getLastEditReplyPayload = () => mockInteraction.editReply.mock.calls.at(-1)?.[0];

  const expectPaginatedRulesReply = (description: string, shownRules: number, totalRules: number = shownRules) => {
    const payload = getLastEditReplyPayload();
    const expectedEmbed = AdminFeedback.info(
      'Verification Rules (Page 1/1)',
      description
    ).setFooter({
      text: `Showing ${shownRules} of ${totalRules} total rules`,
    });

    expect(payload.components).toHaveLength(1);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].toJSON()).toMatchObject(expectedEmbed.toJSON());
  };

  beforeEach(async () => {
    // Create mock DbService
    mockDbService = {
      getRoleMappings: jest.fn(),
    } as any;

    // Create mock interaction
    mockInteraction = {
      id: '123456789012345678',
      guild: {
        id: 'test-guild-id',
      },
      options: { getString: jest.fn().mockReturnValue(null) },
      deferReply: jest.fn(),
      editReply: jest.fn(),
      reply: jest.fn(),
      deferred: false,
      user: {
        id: 'test-user-id',
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ListRulesHandler,
        {
          provide: DbService,
          useValue: mockDbService,
        },
      ],
    }).compile();

    handler = module.get<ListRulesHandler>(ListRulesHandler);
  });

  it('shows combined groups across protocols even when an asset filter hides a member', async () => {
    const base = { server_id: 'test-guild-id', channel_id: 'verify', role_id: 'collector', min_items: 10,
      attribute_key: 'ALL', attribute_value: 'ALL' };
    mockDbService.getRoleMappings.mockResolvedValue([
      { ...base, id: 150, asset_type: 'ethscription', slug: 'comrades' },
      { ...base, id: 151, asset_type: 'ordinal', slug: 'pizza-comrades' },
      { ...base, id: 152, min_items: 5, asset_type: 'ordinal', slug: 'yonder' },
      { ...base, id: 153, channel_id: 'other-channel', asset_type: 'ordinal', slug: 'yonder' },
    ] as any);
    mockInteraction.options.getString.mockReturnValue('ordinal');
    await handler.handle(mockInteraction);
    const description = getLastEditReplyPayload().embeds[0].toJSON().description;
    expect(description).not.toContain('ID: 150');
    expect(description).toContain('Combined minimum: **10** · group **#150** (2 rules in this channel)');
    expect(description.match(/Combined minimum:/g)).toHaveLength(1);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handle', () => {
    it.each([
      [null, [1, 2, 3, 4, 5, 6, 7, 8], 'Verification Rules'],
      ['erc20', [8], 'Tokens (ERC-20) Verification Rules'],
      ['nft', [3, 4], 'NFT Verification Rules'],
      ['ordinal', [5, 6], 'Ordinals Verification Rules'],
      ['ethscription', [1, 2, 7], 'Ethscriptions Verification Rules']
    ])('lists the correct rules for asset filter %s', async (assetType, expectedIds, title) => {
      const base = { server_id: 'test-guild-id', channel_id: 'channel', role_id: 'role', slug: 'collection',
        attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1 };
      const rules = [
        { ...base, id: 1 }, // Legacy Ethscription rule without asset_type
        { ...base, id: 2, asset_type: 'ethscription' },
        { ...base, id: 3, asset_type: 'nft', chain_id: 1, slug: null },
        { ...base, id: 4, asset_type: 'nft', chain_id: 4663, slug: null },
        { ...base, id: 5, asset_type: 'ordinal' },
        { ...base, id: 6, asset_type: 'ordinal', slug: null,
          inscription_criteria: { kind: 'numbers', ranges: [[1, 10]] } },
        { ...base, id: 7, asset_type: 'ethscription', slug: null,
          inscription_criteria: { kind: 'ids', ids: ['0x' + 'a'.repeat(64)] } },
        { ...base, id: 8, asset_type: 'erc20', chain_id: 4663, contract_address: '0x' + '1'.repeat(40), slug: null, min_items: null, token_decimals: 6, min_balance: '500000', token_symbol: 'TEST' },
        { ...base, id: 99, asset_type: 'nft', server_id: '000000000000000000' }
      ];
      mockDbService.getRoleMappings.mockResolvedValue(rules.reverse() as any);
      mockInteraction.options.getString.mockReturnValue(assetType);
      await handler.handle(mockInteraction);

      expect(mockDbService.getRoleMappings).toHaveBeenCalledWith('test-guild-id');
      expect(mockInteraction.options.getString).toHaveBeenCalledWith('asset_type');
      const embed = getLastEditReplyPayload().embeds[0].toJSON();
      expect(embed.title).toBe(`📋 ${title} (Page 1/1)`);
      expect([...embed.description.matchAll(/ID: (\d+) \| Channel/g)].map(match => Number(match[1]))).toEqual(expectedIds);
      expect(embed.footer.text).toBe(`Showing ${expectedIds.length} of ${expectedIds.length} total rules`);
    });

    it('reports no matches for the chosen asset type without showing unrelated rules', async () => {
      mockDbService.getRoleMappings.mockResolvedValue([{ id: 1, server_id: 'test-guild-id', asset_type: 'ethscription' }] as any);
      mockInteraction.options.getString.mockReturnValue('ordinal');
      await handler.handle(mockInteraction);
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [AdminFeedback.info('Verification Rules', 'No verification rules found for Ordinals.')]
      });
    });

    it('keeps each list\'s asset filter, label, and totals when navigating pages', async () => {
      const nftRules = Array.from({ length: 25 }, (_, index) => ({ id: index + 1,
        server_id: 'test-guild-id', channel_id: 'channel', role_id: 'role', asset_type: 'nft', chain_id: 1 }));
      mockDbService.getRoleMappings.mockResolvedValue([
        ...nftRules,
        { id: 99, server_id: 'test-guild-id', asset_type: 'ordinal', slug: 'yonder' }
      ] as any);
      mockInteraction.options.getString.mockReturnValue('nft');
      await handler.handle(mockInteraction);
      const first = getLastEditReplyPayload();
      const button = Object.assign(Object.create(ButtonInteraction.prototype), {
        customId: first.components[0].toJSON().components[1].custom_id,
        user: mockInteraction.user,
        update: jest.fn(), reply: jest.fn()
      });

      // Opening another asset's list must not change the first list's pagination.
      await handler.handle({ ...mockInteraction, id: '123456789012345679',
        options: { getString: jest.fn().mockReturnValue('ordinal') } });
      await handler.handlePaginationButton(button);
      const second = button.update.mock.calls.at(-1)[0].embeds[0].toJSON();
      expect(second.title).toBe('📋 NFT Verification Rules (Page 2/2)');
      expect(second.footer.text).toBe('Showing 5 of 25 total rules');
      expect([...second.description.matchAll(/ID: (\d+) \| Channel/g)].map(match => Number(match[1]))).toEqual([21, 22, 23, 24, 25]);

      button.customId = button.update.mock.calls.at(-1)[0].components[0].toJSON().components[0].custom_id;
      await handler.handlePaginationButton(button);
      const previous = button.update.mock.calls.at(-1)[0].embeds[0].toJSON();
      expect(previous.title).toBe('📋 NFT Verification Rules (Page 1/2)');
      expect(previous.footer.text).toBe('Showing 20 of 25 total rules');
      expect([...previous.description.matchAll(/ID: (\d+) \| Channel/g)].map(match => Number(match[1]))).toEqual(nftRules.slice(0, 20).map(rule => rule.id));
    });

    it('should handle empty rules list', async () => {
      mockDbService.getRoleMappings.mockResolvedValue([]);

      await handler.handle(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({
        flags: expect.any(Number), // MessageFlags.Ephemeral
      });
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        embeds: [AdminFeedback.info('Verification Rules', 'No verification rules found.')],
      });
    });

    it('paginates long inscription lists without dropping rules or exceeding Discord limits', async () => {
      const rules = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, server_id: 'guild', channel_id: 'channel', role_id: 'role',
        asset_type: 'ordinal', slug: null, attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1,
        inscription_criteria: { kind: 'ids', ids: Array.from({ length: 5 }, (_, n) => 'a'.repeat(64) + 'i' + n) } }));
      mockDbService.getRoleMappings.mockResolvedValue(rules);
      await handler.handle(mockInteraction);
      const first = getLastEditReplyPayload();
      expect(first.embeds[0].toJSON().description.length).toBeLessThanOrEqual(4096);
      expect(first.components[0].toJSON().components[1].disabled).toBe(false);
      const totalPages = Number(first.embeds[0].toJSON().title.match(/\/(\d+)/)[1]);
      const shown: number[] = [];
      for (let page = 0; page < totalPages; page++) {
        await (handler as any).showRulesPage(mockInteraction, rules, page);
        const description = getLastEditReplyPayload().embeds[0].toJSON().description;
        expect(description.length).toBeLessThanOrEqual(4096);
        shown.push(...[...description.matchAll(/ID: (\d+) \| Channel/g)].map(match => Number(match[1])));
      }
      expect(shown).toEqual(rules.map(rule => rule.id));
    });

    it('should handle single rule', async () => {
      const mockRule = {
        id: 1,
        server_id: 'test-guild-id',
        channel_id: 'channel-123',
        role_id: 'role-456',
        slug: 'test-collection',
        attribute_key: 'trait',
        attribute_value: 'rare',
        min_items: 1,
      };

      mockDbService.getRoleMappings.mockResolvedValue([mockRule]);

      await handler.handle(mockInteraction);

      expectPaginatedRulesReply(
        'ID: 1 | Channel: <#channel-123> | Role: <@&role-456> | Slug: test-collection | Attr: trait=rare',
        1
      );
    });

    it('should handle multiple rules and sort by ID', async () => {
      const mockRules = [
        {
          id: 3,
          server_id: 'test-guild-id',
          channel_id: 'channel-789',
          role_id: 'role-999',
          slug: 'ALL',
          attribute_key: 'ALL',
          attribute_value: 'ALL',
          min_items: 2,
        },
        {
          id: 1,
          server_id: 'test-guild-id',
          channel_id: 'channel-123',
          role_id: 'role-456',
          slug: 'test-collection',
          attribute_key: 'trait',
          attribute_value: 'rare',
          min_items: 1,
        },
      ];

      mockDbService.getRoleMappings.mockResolvedValue(mockRules);

      await handler.handle(mockInteraction);

      // Should be sorted by ID (1 then 3)
      const expectedDescription = 
        'ID: 1 | Channel: <#channel-123> | Role: <@&role-456> | Slug: test-collection | Attr: trait=rare\n\n' +
        'ID: 3 | Channel: <#channel-789> | Role: <@&role-999> | Slug: ALL | Attr: ALL | Min: 2';

      expectPaginatedRulesReply(expectedDescription, 2);
    });

    it('should filter out system rules', async () => {
      const mockRules = [
        {
          id: 1,
          server_id: 'test-guild-id',
          channel_id: 'channel-123',
          role_id: 'role-456',
          slug: 'test-collection',
          attribute_key: 'trait',
          attribute_value: 'rare',
          min_items: 1,
        },
        {
          id: 2,
          server_id: '000000000000000000', // System rule - should be filtered out
          channel_id: 'system-channel',
          role_id: 'system-role',
          slug: 'system',
          attribute_key: 'ALL',
          attribute_value: 'ALL',
          min_items: 1,
        },
      ];

      mockDbService.getRoleMappings.mockResolvedValue(mockRules);

      await handler.handle(mockInteraction);

      // Should only show the non-system rule
      expectPaginatedRulesReply(
        'ID: 1 | Channel: <#channel-123> | Role: <@&role-456> | Slug: test-collection | Attr: trait=rare',
        1
      );
    });

    it('should handle various attribute formats', async () => {
      const mockRules = [
        {
          id: 1,
          server_id: 'test-guild-id',
          channel_id: 'channel-123',
          role_id: 'role-456',
          slug: 'test-collection',
          attribute_key: 'trait',
          attribute_value: 'rare',
          min_items: 1,
        },
        {
          id: 2,
          server_id: 'test-guild-id',
          channel_id: 'channel-234',
          role_id: 'role-567',
          slug: 'another-collection',
          attribute_key: 'type',
          attribute_value: 'ALL',
          min_items: 1,
        },
        {
          id: 3,
          server_id: 'test-guild-id',
          channel_id: 'channel-345',
          role_id: 'role-678',
          slug: 'third-collection',
          attribute_key: 'ALL',
          attribute_value: 'legendary',
          min_items: 1,
        },
        {
          id: 4,
          server_id: 'test-guild-id',
          channel_id: 'channel-456',
          role_id: 'role-789',
          slug: 'fourth-collection',
          attribute_key: 'ALL',
          attribute_value: 'ALL',
          min_items: 1,
        },
      ];

      mockDbService.getRoleMappings.mockResolvedValue(mockRules);

      await handler.handle(mockInteraction);

      const expectedDescription = 
        'ID: 1 | Channel: <#channel-123> | Role: <@&role-456> | Slug: test-collection | Attr: trait=rare\n\n' +
        'ID: 2 | Channel: <#channel-234> | Role: <@&role-567> | Slug: another-collection | Attr: type (any value)\n\n' +
        'ID: 3 | Channel: <#channel-345> | Role: <@&role-678> | Slug: third-collection | Attr: ALL=legendary\n\n' +
        'ID: 4 | Channel: <#channel-456> | Role: <@&role-789> | Slug: fourth-collection | Attr: ALL';

      expectPaginatedRulesReply(expectedDescription, 4);
    });

    it('should handle database errors', async () => {
      const errorMessage = 'Database connection failed';
      mockDbService.getRoleMappings.mockRejectedValue(new Error(errorMessage));
      mockInteraction.deferred = true;

      await handler.handle(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: AdminFeedback.simple(`Error retrieving rules: ${errorMessage}`, true),
      });
    });

    it('should handle errors when interaction is not deferred', async () => {
      const errorMessage = 'Database connection failed';
      
      // Simulate error during deferReply
      mockInteraction.deferReply.mockRejectedValue(new Error('Defer failed'));
      mockInteraction.deferred = false;

      await handler.handle(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: AdminFeedback.simple('Error retrieving rules: Defer failed', true),
        flags: 64,
      });
    });
  });

  describe('formatting methods', () => {
    it('should format attributes correctly', () => {
      // Test the centralized utility function
      expect(formatAttribute('trait', 'rare')).toBe('trait=rare');
      expect(formatAttribute('type', 'ALL')).toBe('type (any value)');
      expect(formatAttribute('ALL', 'legendary')).toBe('ALL=legendary');
      expect(formatAttribute('ALL', 'ALL')).toBe('ALL');
    });
  });
});
