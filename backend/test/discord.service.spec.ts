import { Test, TestingModule } from '@nestjs/testing';
import { DiscordService } from '../src/services/discord.service';
import { DiscordMessageService } from '../src/services/discord-message.service';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { DiscordCommandsService } from '../src/services/discord-commands.service';
import { VerificationService } from '../src/services/verification.service';
import { DbService } from '../src/services/db.service';
import { NonceService } from '../src/services/nonce.service';
import { DataService } from '../src/services/data.service';
import { CacheService } from '../src/services/cache.service';
import { Logger } from '@nestjs/common';
import { NftMetadataService } from '../src/services/nft-metadata.service';
import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { CONSTANTS } from '../src/constants';

// Mock Discord.js client and related objects
const mockUser = { id: 'user123', tag: 'TestBot#1234' };
const mockGuild = { 
  id: 'guild123', 
  members: { 
    me: { 
      roles: { highest: { position: 10 } } 
    } 
  },
  roles: {
    cache: new Map(),
    fetch: jest.fn()
  }
};
const mockRole = { id: 'role123', name: 'TestRole', position: 5, editable: true };

const mockClient = {
  on: jest.fn(),
  login: jest.fn().mockResolvedValue(''),
  destroy: jest.fn().mockResolvedValue(undefined),
  isReady: jest.fn().mockReturnValue(true),
  users: {
    fetch: jest.fn().mockResolvedValue(mockUser)
  },
  guilds: {
    cache: new Map([['guild123', mockGuild]]),
    fetch: jest.fn().mockResolvedValue(mockGuild)
  },
  user: mockUser
};

const mockRest = {
  setToken: jest.fn().mockReturnThis(),
  put: jest.fn().mockResolvedValue({})
};

jest.mock('discord.js', () => {
  const actual = jest.requireActual('discord.js');
  return {
    ...actual,
    REST: jest.fn().mockImplementation(() => mockRest),
    Client: jest.fn().mockImplementation(() => mockClient),
    Routes: {
      applicationCommands: jest.fn().mockReturnValue('applications/123/commands')
    },
    Events: { ClientReady: 'ready' },
    GatewayIntentBits: { Guilds: 1 },
    MessageFlags: { Ephemeral: 64 }
  };
});

const mockDbService = {
  addRoleMapping: jest.fn(),
  deleteRoleMapping: jest.fn(),
  getRoleMappings: jest.fn(),
  getKnownOrdinalCollectionSlugs: jest.fn(),
  ruleExists: jest.fn(),
  insertRoleMapping: jest.fn(),
  findRuleByMessageId: jest.fn(),
  getServerRole: jest.fn(),
};

const mockNonceService = {
  createNonce: jest.fn(),
  getNonceData: jest.fn(),
  invalidateNonce: jest.fn(),
};

const mockDiscordMessageService = {
  initialize: jest.fn(),
  findExistingVerificationMessage: jest.fn(),
  createVerificationMessage: jest.fn(),
  doesVerificationMessageExist: jest.fn(),
};

const mockDiscordVerificationService = {
  initialize: jest.fn(),
  requestVerification: jest.fn(),
  addUserRole: jest.fn(),
  throwError: jest.fn(),
};

const mockDiscordCommandsService = {
  handleEditRule: jest.fn(),
  handleEditRuleModal: jest.fn(),
  handleEditRuleButton: jest.fn(),
  handleEditRuleAutocomplete: jest.fn(),
  handleWalletBlock: jest.fn(),
  handleWalletBlockPagination: jest.fn(),
  handleAuditLog: jest.fn(),
  handleAuditLogPagination: jest.fn(),
  initialize: jest.fn(),
  handleAddRule: jest.fn(),
  handleRemoveRule: jest.fn(),
  handleListRules: jest.fn(),
  handleVerification: jest.fn(),
};

const mockVerificationService = {
  getRulesByMessageId: jest.fn(),
  getRulesForChannel: jest.fn(),
  getAllRulesForServer: jest.fn(),
  verifyUserAgainstRules: jest.fn(),
  assignRoleToUser: jest.fn(),
};

const mockDataService = {
  getAllSlugs: jest.fn().mockResolvedValue(['crypto-punks', 'bored-apes', 'mutant-apes']),
  getAttributeValues: jest.fn().mockResolvedValue([]),
  getAllAttributeValues: jest.fn().mockResolvedValue([]),
};

const mockCacheService = {
  getAttributeKeys: jest.fn().mockResolvedValue([]),
  getAttributeValues: jest.fn().mockResolvedValue([]),
  getAllAttributeValues: jest.fn().mockResolvedValue([]),
  cacheAllCollectionData: jest.fn().mockResolvedValue(undefined),
};
const mockNftMetadataService = { suggestions: jest.fn() };
const mockOrdinalsService = { suggestions: jest.fn() };

describe('DiscordService - Enhanced Tests', () => {
  let service: DiscordService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = process.env;
    process.env = {
      ...originalEnv,
      DISCORD: '0', // Disable Discord bot initialization in tests
      DISCORD_BOT_TOKEN: 'test-token',
      DISCORD_CLIENT_ID: 'test-client-id',
      NONCE_EXPIRY: '3600'
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordService,
        { provide: NonceService, useValue: mockNonceService },
        { provide: DbService, useValue: mockDbService },
        { provide: DiscordMessageService, useValue: mockDiscordMessageService },
        { provide: DiscordVerificationService, useValue: mockDiscordVerificationService },
        { provide: DiscordCommandsService, useValue: mockDiscordCommandsService },
        { provide: VerificationService, useValue: mockVerificationService },
        { provide: DataService, useValue: mockDataService },
        { provide: CacheService, useValue: mockCacheService },
        { provide: NftMetadataService, useValue: mockNftMetadataService },
        { provide: OrdinalsOwnershipService, useValue: mockOrdinalsService },
      ],
    }).compile();
    service = module.get<DiscordService>(DiscordService);
    jest.clearAllMocks();
    mockClient.on.mockReset();
    mockClient.isReady.mockReturnValue(true);
    mockNftMetadataService.suggestions.mockReset().mockResolvedValue(['Color', 'Hat']);
    mockOrdinalsService.suggestions.mockReset().mockResolvedValue(['Background', 'Hat']);
    
    // Set up client for tests that need it
    (service as any).client = mockClient;
  });

  describe('Initialization', () => {
    afterEach(() => { jest.useRealTimers(); });
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize bot successfully', async () => {
      // Reset client to null to test initialization
      (service as any).client = null;
      
      let readyCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') {
          readyCallback = callback;
        }
      });

      const initPromise = service.initializeBot();
      
      // Simulate ready event
      if (readyCallback) {
        readyCallback(mockClient);
      }

      await initPromise;

      expect(mockClient.login).toHaveBeenCalledWith('test_bot_token');
      expect(mockDiscordMessageService.initialize).toHaveBeenCalledWith(mockClient);
      expect(mockDiscordVerificationService.initialize).toHaveBeenCalledWith(mockClient);
      expect(mockDiscordCommandsService.initialize).toHaveBeenCalledWith(mockClient);
    });

    it('should not initialize bot multiple times', async () => {
      // Reset client to null to test the guard clause
      (service as any).client = null;
      
      // First initialization
      let readyCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') {
          readyCallback = callback;
        }
      });

      const initPromise1 = service.initializeBot();
      
      // Trigger ready event for first init
      if (readyCallback) {
        readyCallback(mockClient);
      }
      
      await initPromise1;
      
      // Clear mock calls from first initialization
      mockClient.login.mockClear();
      
      // Second call should be no-op since client is now set
      await service.initializeBot();
      
      expect(mockClient.login).toHaveBeenCalledTimes(0); // Should not be called again
    });

    it('waits for the same in-progress login when initialization is requested twice', async () => {
      (service as any).client = null;
      let readyCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') readyCallback = callback;
      });
      const first = service.initializeBot();
      const second = service.initializeBot();
      let completed = false;
      void second.then(() => { completed = true; });
      await Promise.resolve();
      expect(completed).toBe(false);
      expect(mockClient.login).toHaveBeenCalledTimes(1);
      readyCallback(mockClient);
      await Promise.all([first, second]);
    });

    it('installs working button handlers after a gateway connection taking longer than ten seconds', async () => {
      jest.useFakeTimers();
      (service as any).client = null;
      let readyCallback: Function;
      let interactionCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') readyCallback = callback;
        if (event === 'interactionCreate') interactionCallback = callback;
      });
      const testFlag = jest.replaceProperty(EnvironmentConfig, 'IS_TEST', false);
      const enabledFlag = jest.replaceProperty(EnvironmentConfig, 'DISCORD_ENABLED', 1);
      try {
        const pending = service.onModuleInit();
        await jest.advanceTimersByTimeAsync(15_000);
        expect(mockClient.destroy).not.toHaveBeenCalled();
        readyCallback(mockClient);
        await pending;
        expect(service.isReady()).toBe(true);
        const interaction = {
          isAutocomplete: () => false, isChatInputCommand: () => false, isButton: () => true,
          customId: 'requestVerification',
          guild: { id: 'guild123' }, channel: { id: 'channel123' },
          deferReply: jest.fn().mockResolvedValue({}),
        };
        mockVerificationService.getRulesForChannel.mockResolvedValue([{ id: 1 }]);
        await interactionCallback(interaction);
        expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
        expect(mockDiscordVerificationService.requestVerification).toHaveBeenCalledWith(interaction);
      } finally {
        enabledFlag.restore();
        testFlag.restore();
      }
    });

    it('closes a timed-out connection and ignores a late ready event', async () => {
      jest.useFakeTimers();
      (service as any).client = null;
      let readyCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') readyCallback = callback;
      });
      const rejected = expect(service.initializeBot()).rejects.toThrow('timed out after 60 seconds');
      await jest.advanceTimersByTimeAsync(CONSTANTS.DISCORD_INITIALIZATION_TIMEOUT);
      await rejected;
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      expect((service as any).client).toBeNull();
      readyCallback(mockClient);
      expect(mockDiscordVerificationService.initialize).not.toHaveBeenCalled();
      expect(service.isReady()).toBe(false);
    });

    it('cleans up a failed login and permits another initialization attempt', async () => {
      (service as any).client = null;
      mockClient.login.mockRejectedValueOnce(new Error('Gateway unavailable'));
      await expect(service.initializeBot()).rejects.toThrow('Gateway unavailable');
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      let readyCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'ready') readyCallback = callback;
      });
      const retry = service.initializeBot();
      readyCallback(mockClient);
      await retry;
      expect(mockClient.login).toHaveBeenCalledTimes(2);
    });

    it('fails application startup when the enabled Discord bot cannot initialize', async () => {
      const testFlag = jest.replaceProperty(EnvironmentConfig, 'IS_TEST', false);
      const enabledFlag = jest.replaceProperty(EnvironmentConfig, 'DISCORD_ENABLED', 1);
      const initialization = jest.spyOn(service, 'initializeBot').mockRejectedValue(new Error('Gateway unavailable'));
      try {
        await expect(service.onModuleInit()).rejects.toThrow('Gateway unavailable');
        expect(mockClient.on).not.toHaveBeenCalledWith('interactionCreate', expect.any(Function));
      } finally {
        initialization.mockRestore();
        enabledFlag.restore();
        testFlag.restore();
      }
    });

    it('reports readiness only when startup completed and the Discord gateway is ready', async () => {
      const testFlag = jest.replaceProperty(EnvironmentConfig, 'IS_TEST', false);
      const enabledFlag = jest.replaceProperty(EnvironmentConfig, 'DISCORD_ENABLED', 1);
      const initialization = jest.spyOn(service, 'initializeBot').mockResolvedValue();
      try {
        expect(service.isReady()).toBe(false);
        await service.onModuleInit();
        expect(service.isReady()).toBe(true);
        mockClient.isReady.mockReturnValue(false);
        expect(service.isReady()).toBe(false);
      } finally {
        initialization.mockRestore();
        enabledFlag.restore();
        testFlag.restore();
      }
    });
  });

  describe('Slash Commands Registration', () => {
    it('registers wallet restriction commands with a required address and bounded optional reason', async () => {
      await service.registerSlashCommands();
      const setup = mockRest.put.mock.calls.at(-1)[1].body.find(command => command.name === 'setup').toJSON();
      const block = setup.options.find(option => option.name === 'block-wallet');
      const unblock = setup.options.find(option => option.name === 'unblock-wallet');
      expect(block.options).toEqual([
        expect.objectContaining({ name: 'address', required: true, max_length: 62 }),
        expect.objectContaining({ name: 'reason', max_length: 200 }),
      ]);
      expect(unblock.options).toEqual([expect.objectContaining({ name: 'address', required: true })]);
      expect(setup.options.some(option => option.name === 'list-blocked-wallets')).toBe(true);
    });
    it('registers an optional asset-type filter for list-rules', async () => {
      await service.registerSlashCommands();
      const setup = mockRest.put.mock.calls.at(-1)[1].body.find(command => command.name === 'setup').toJSON();
      const list = setup.options.find(option => option.name === 'list-rules');
      expect(list.options).toHaveLength(1);
      expect(list.options[0]).toEqual(expect.objectContaining({
        name: 'asset_type',
        choices: [
          { name: 'Tokens (ERC-20)', value: 'erc20' },
          { name: 'NFT', value: 'nft' },
          { name: 'Ordinals', value: 'ordinal' },
          { name: 'Ethscriptions', value: 'ethscription' }
        ]
      }));
      expect(list.options[0].required).not.toBe(true);
    });

    it('registers focused rule commands with valid required options', async () => {
      await service.registerSlashCommands();
      const setup = mockRest.put.mock.calls.at(-1)[1].body.find(command => command.name === 'setup').toJSON();
      const rules = setup.options.filter(option => option.name.startsWith('add-'));
      expect(rules.map(rule => rule.name)).toEqual([
        'add-solana-nft-rule', 'add-solana-token-rule', 'add-token-rule', 'add-nft-rule', 'add-ordinals-rule', 'add-ethscription-rule'
      ]);
      expect(rules.map(rule => rule.options.length)).toEqual([7, 5, 5, 9, 9, 9]);
      for (const rule of rules) {
        expect(rule.options.slice(0, 2)).toEqual([
          expect.objectContaining({ name: 'channel', required: true }),
          expect.objectContaining({ name: 'role', required: true, autocomplete: true })
        ]);
        expect(rule.options.some(option => option.name === 'asset_type')).toBe(false);
        for (const name of ['attribute_key', 'attribute_value']) {
          if (!rule.name.startsWith('add-solana-') && rule.name !== 'add-token-rule') expect(rule.options.find(option => option.name === name).autocomplete).toBe(true);
        }
      }
      const [solanaNft,solanaToken,token,nft,ordinals,ethscriptions] = rules;
      expect(solanaNft.options[2]).toMatchObject({name:'scope',required:true});
      expect(solanaNft.options[3]).toMatchObject({name:'addresses',required:true});
      expect(solanaToken.options[2]).toMatchObject({name:'mint',required:true});
      expect(solanaToken.options[4]).toMatchObject({name:'min_balance',required:true});
      expect(token.options[3]).toEqual(expect.objectContaining({ name: 'min_balance', type: 3, required: true }));
      expect(token.options.some(option => option.name === 'min_items')).toBe(false);
      expect(nft.options[2]).toEqual(expect.objectContaining({ name: 'contract_address', required: true }));
      expect(nft.options.some(option => ['slug', 'inscription_ids', 'inscription_numbers'].includes(option.name))).toBe(false);
      for (const rule of [ordinals, ethscriptions]) {
        expect(rule.options.some(option => ['network', 'contract_address', 'token_ids', 'collection_name'].includes(option.name))).toBe(false);
        for (const name of ['inscription_ids', 'inscription_numbers']) {
          expect(rule.options.find(option => option.name === name).max_length).toBe(6000);
        }
      }
      for (const rule of [ordinals, ethscriptions]) {
        const index = rule.options.findIndex(option => option.name === 'inscription_numbers');
        expect(rule.options[index + 1]).toMatchObject({name: 'label', max_length: 100});
        expect(rule.options[index + 1].required).not.toBe(true);
      }
      expect(ordinals.options.find(option => option.name === 'slug').autocomplete).toBe(true);
      expect(ethscriptions.options.find(option => option.name === 'slug').autocomplete).toBe(true);
    });

    it('registers one verification command with required channel/action and Administrator permissions', async () => {
      await service.registerSlashCommands();
      const command = mockRest.put.mock.calls.at(-1)[1].body.find(command => command.name === 'setup').toJSON();
      const actual = jest.requireActual('discord.js');
      expect(command.default_member_permissions).toBe(actual.PermissionFlagsBits.Administrator.toString());
      expect(command.options.some(option => ['recover-verification', 'refresh-verification'].includes(option.name))).toBe(false);
      const verification = command.options.find(option => option.name === 'verification');
      expect(verification.options).toEqual([
        expect.objectContaining({ name: 'channel', required: true, channel_types: [actual.ChannelType.GuildText] }),
        expect.objectContaining({ name: 'action', required: true, type: actual.ApplicationCommandOptionType.String, choices: [
          { name: 'Refresh existing', value: 'refresh' },
          { name: 'Create new', value: 'new' },
          { name: 'Recover missing', value: 'recover' }
        ] })
      ]);
    });

    it('should register slash commands successfully', async () => {
      await service.registerSlashCommands();
      
      expect(mockRest.put).toHaveBeenCalledWith(
        'applications/123/commands',
        { body: expect.any(Array) }
      );
    });

    it('should handle slash command registration errors', async () => {
      const loggerErrorSpy = jest.spyOn(Logger, 'error').mockImplementation();
      mockRest.put.mockRejectedValueOnce(new Error('Registration failed'));
      
      await service.registerSlashCommands();
      
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to register slash commands:', expect.any(Error));
      loggerErrorSpy.mockRestore();
    });

    it('should create slash commands with interaction handlers', async () => {
      await service.createSlashCommands();
      
      expect(mockClient.on).toHaveBeenCalledWith('interactionCreate', expect.any(Function));
    });

    it('installs verification handlers before command registration finishes and does not duplicate them', async () => {
      let finishRegistration: (value: object) => void;
      mockRest.put.mockReturnValueOnce(new Promise(resolve => { finishRegistration = resolve; }));
      const pending = service.createSlashCommands();
      expect(mockClient.on).toHaveBeenCalledWith('interactionCreate', expect.any(Function));
      finishRegistration({});
      await pending;
      await service.createSlashCommands();
      expect(mockClient.on.mock.calls.filter(([event]) => event === 'interactionCreate')).toHaveLength(1);
    });
  });

  describe('Discord API Interactions', () => {
    beforeEach(() => {
      mockGuild.roles.fetch.mockResolvedValue(mockRole);
    });

    describe('getUser', () => {
      it('should fetch user successfully', async () => {
        const result = await service.getUser('user123');
        
        expect(mockClient.users.fetch).toHaveBeenCalledWith('user123');
        expect(result).toEqual(mockUser);
      });

      it('should handle user fetch errors', async () => {
        const loggerWarnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
        mockClient.users.fetch.mockRejectedValueOnce(new Error('User not found'));
        
        const result = await service.getUser('invalid-user');
        
        expect(result).toBeNull();
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          'Failed to fetch user invalid-user:',
          'User not found'
        );
        loggerWarnSpy.mockRestore();
      });

      it('should handle no client initialized', async () => {
        const loggerWarnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
        (service as any).client = null;
        
        const result = await service.getUser('user123');
        
        expect(result).toBeNull();
        // No warning logged when client isn't initialized (for non-critical name resolution)
        loggerWarnSpy.mockRestore();
        
        (service as any).client = mockClient;
      });
    });

    describe('getGuild', () => {
      it('should fetch guild successfully', async () => {
        const result = await service.getGuild('guild123');
        
        expect(mockClient.guilds.fetch).toHaveBeenCalledWith('guild123');
        expect(result).toEqual(mockGuild);
      });

      it('should handle guild fetch errors', async () => {
        const loggerWarnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
        mockClient.guilds.fetch.mockRejectedValueOnce(new Error('Guild not found'));
        
        const result = await service.getGuild('invalid-guild');
        
        expect(result).toBeNull();
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          'Failed to fetch guild invalid-guild:',
          'Guild not found'
        );
        loggerWarnSpy.mockRestore();
      });

      it('should handle no client initialized', async () => {
        const loggerWarnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
        (service as any).client = null;
        
        const result = await service.getGuild('guild123');
        
        expect(result).toBeNull();
        // No warning logged when client isn't initialized (for non-critical name resolution)
        loggerWarnSpy.mockRestore();
        
        (service as any).client = mockClient;
      });
    });

    describe('getRole', () => {
      it('should fetch role successfully', async () => {
        const result = await service.getRole('guild123', 'role123');
        
        expect(mockClient.guilds.fetch).toHaveBeenCalledWith('guild123');
        expect(mockGuild.roles.fetch).toHaveBeenCalledWith('role123');
        expect(result).toEqual(mockRole);
      });

      it('should handle role fetch errors', async () => {
        const loggerWarnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
        mockGuild.roles.fetch.mockRejectedValueOnce(new Error('Role not found'));
        
        const result = await service.getRole('guild123', 'invalid-role');
        
        expect(result).toBeNull();
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          'Failed to fetch role invalid-role in guild guild123:',
          'Role not found'
        );
        loggerWarnSpy.mockRestore();
      });

      it('should handle no client initialized', async () => {
        const loggerWarnSpy = jest.spyOn(Logger, 'warn').mockImplementation();
        (service as any).client = null;
        
        const result = await service.getRole('guild123', 'role123');
        
        expect(result).toBeNull();
        // No warning logged when client isn't initialized (for non-critical name resolution)
        loggerWarnSpy.mockRestore();
        
        (service as any).client = mockClient;
      });
    });
  });

  describe('Command Handling', () => {
    it.each([
      ['add-nft-rule', 'nft'],
      ['add-ordinals-rule', 'ordinal'],
      ['add-ethscription-rule', 'ethscription']
    ])('routes %s to the shared handler as %s and requires admin permission', async (command, assetType) => {
      const interaction = {
        options: { getSubcommand: () => command },
        guild: { id: 'g' }, guildId: 'g',
        user: { id: 'user123', tag: 'TestUser#1234' },
        memberPermissions: { has: jest.fn().mockReturnValue(false) },
        reply: jest.fn()
      } as any;
      await service.handleSetup(interaction);
      expect(mockDiscordCommandsService.handleAddRule).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('Access Denied'), flags: 64
      }));

      interaction.memberPermissions.has.mockReturnValue(true);
      await service.handleSetup(interaction);
      expect(mockDiscordCommandsService.handleAddRule).toHaveBeenCalledWith(interaction, assetType);
    });

    it.each(['add-rule', 'recover-verification', 'refresh-verification'])('rejects removed command %s without invoking a handler', async command => {
      const mockInteraction = {
        options: { getSubcommand: () => command },
        guild: { id: 'g' },
        guildId: 'g',
        user: { id: 'user123', tag: 'TestUser#1234' },
        deferred: false,
        replied: false,
        memberPermissions: { has: jest.fn().mockReturnValue(true) }, // Grant admin permissions
        reply: jest.fn().mockResolvedValue(undefined)
      } as any;
      
      await service.handleSetup(mockInteraction);
      expect(mockDiscordCommandsService.handleAddRule).not.toHaveBeenCalled();
      expect(mockDiscordCommandsService.handleVerification).not.toHaveBeenCalled();
      expect(mockInteraction.reply).toHaveBeenCalledWith({ content: expect.stringContaining('no longer available'), flags: 64 });
      expect(mockInteraction.reply.mock.calls[0][0].content).toContain('reload Discord');
    });

    it('should handle remove-rule command', async () => {
      const mockInteraction = {
        options: { getSubcommand: () => 'remove-rule' },
        guild: { id: 'g' },
        guildId: 'g',
        user: { id: 'user123', tag: 'TestUser#1234' },
        deferred: false,
        replied: false,
        memberPermissions: { has: jest.fn().mockReturnValue(true) }, // Grant admin permissions
        reply: jest.fn().mockResolvedValue(undefined)
      } as any;
      
      await service.handleSetup(mockInteraction);
      expect(mockDiscordCommandsService.handleRemoveRule).toHaveBeenCalledWith(mockInteraction);
    });

    it('should handle list-rules command', async () => {
      const mockInteraction = {
        options: { getSubcommand: () => 'list-rules' },
        guild: { id: 'g' },
        guildId: 'g',
        user: { id: 'user123', tag: 'TestUser#1234' },
        deferred: false,
        replied: false,
        memberPermissions: { has: jest.fn().mockReturnValue(true) }, // Grant admin permissions
        reply: jest.fn().mockResolvedValue(undefined)
      } as any;
      
      await service.handleSetup(mockInteraction);
      expect(mockDiscordCommandsService.handleListRules).toHaveBeenCalledWith(mockInteraction);
    });

    it.each([true, false])('allows verification only for administrators (admin: %s)', async admin => {
      const interaction = {
        options: { getSubcommand: () => 'verification' },
        guild: { id: 'g' }, guildId: 'g',
        user: { id: 'user123', tag: 'TestUser#1234' },
        memberPermissions: { has: jest.fn().mockReturnValue(admin) },
        reply: jest.fn()
      } as any;
      await service.handleSetup(interaction);
      if (admin) expect(mockDiscordCommandsService.handleVerification).toHaveBeenCalledWith(interaction);
      else {
        expect(mockDiscordCommandsService.handleVerification).not.toHaveBeenCalled();
        expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Access Denied'), flags: 64 }));
      }
    });

    it('should handle setup errors when interaction is not deferred or replied', async () => {
      const loggerErrorSpy = jest.spyOn(Logger, 'error').mockImplementation();
      const mockInteraction = {
        options: { getSubcommand: () => 'add-ethscription-rule' },
        guild: { id: 'g' },
        deferred: false,
        replied: false,
        reply: jest.fn().mockResolvedValue({})
      } as any;
      
      mockDiscordCommandsService.handleAddRule.mockRejectedValueOnce(new Error('Test error'));
      
      await service.handleSetup(mockInteraction);
      
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: 'An error occurred while processing your request.',
        flags: 64 // MessageFlags.Ephemeral
      });
      expect(loggerErrorSpy).toHaveBeenCalledWith('Error in handleSetup:', expect.any(Error));
      loggerErrorSpy.mockRestore();
    });

    it('should handle setup errors when interaction is deferred', async () => {
      const loggerErrorSpy = jest.spyOn(Logger, 'error').mockImplementation();
      const mockInteraction = {
        options: { getSubcommand: () => 'add-ethscription-rule' },
        guild: { id: 'g' },
        deferred: true,
        replied: false,
        editReply: jest.fn().mockResolvedValue({})
      } as any;
      
      mockDiscordCommandsService.handleAddRule.mockRejectedValueOnce(new Error('Test error'));
      
      await service.handleSetup(mockInteraction);
      
      expect(mockInteraction.editReply).toHaveBeenCalledWith({
        content: 'An error occurred while processing your request.'
      });
      loggerErrorSpy.mockRestore();
    });

    it('should handle setup errors when reply fails', async () => {
      const loggerErrorSpy = jest.spyOn(Logger, 'error').mockImplementation();
      const mockInteraction = {
        options: { getSubcommand: () => 'add-ethscription-rule' },
        guild: { id: 'g' },
        deferred: false,
        replied: false,
        reply: jest.fn().mockRejectedValue(new Error('Reply failed'))
      } as any;
      
      mockDiscordCommandsService.handleAddRule.mockRejectedValueOnce(new Error('Test error'));
      
      await service.handleSetup(mockInteraction);
      
      expect(loggerErrorSpy).toHaveBeenCalledWith('Error in handleSetup:', expect.any(Error));
      expect(loggerErrorSpy).toHaveBeenCalledWith('Failed to send error message to user:', expect.any(Error));
      loggerErrorSpy.mockRestore();
    });
  });

  describe('Service Delegation', () => {
    it('should delegate requestVerification to DiscordVerificationService', async () => {
      const mockInteraction = { customId: 'requestVerification' } as any;
      
      await service.requestVerification(mockInteraction);
      expect(mockDiscordVerificationService.requestVerification).toHaveBeenCalledWith(mockInteraction);
    });

    it('should delegate addUserRole to DiscordVerificationService', async () => {
      await service.addUserRole('userId', 'roleId', 'guildId', 'nonce');
      expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledWith('userId', 'roleId', 'guildId', 'nonce');
    });

    it('should delegate throwError to DiscordVerificationService', async () => {
      await service.throwError('nonce', 'error message');
      expect(mockDiscordVerificationService.throwError).toHaveBeenCalledWith('nonce', 'error message');
    });

    it('should delegate findExistingVerificationMessage to DiscordMessageService', async () => {
      const mockChannel = { id: 'channelId' } as any;
      await service.findExistingVerificationMessage(mockChannel);
      expect(mockDiscordMessageService.findExistingVerificationMessage).toHaveBeenCalledWith(mockChannel);
    });
  });

  describe('NFT attribute autocomplete', () => {
    const contract = '0x1111111111111111111111111111111111111111';
    function interaction(name = 'attribute_key', value = '', options = {}) {
      const fields = { contract_address: contract, network: 'robinhood', ...options };
      return { options: { getFocused: () => ({ name, value }), getString: key => fields[key] ?? null }, respond: jest.fn().mockResolvedValue(undefined) } as any;
    }
    it('uses the selected NFT network and contract', async () => {
      const input = interaction();
      await service.handleNftAttributeAutocomplete(input);
      expect(mockNftMetadataService.suggestions).toHaveBeenCalledWith({ chain_id: 4663, contract_address: contract }, undefined);
      expect(input.respond).toHaveBeenCalledWith([{ name: 'Color', value: 'Color' }, { name: 'Hat', value: 'Hat' }]);
      expect(mockDataService.getAllSlugs).not.toHaveBeenCalled();
    });
    it('suggests values for a selected key and preserves manually typed values', async () => {
      mockNftMetadataService.suggestions.mockResolvedValue(['Red', 'Blue']);
      const input = interaction('attribute_value', 'Purple', { attribute_key: 'Color' });
      await service.handleNftAttributeAutocomplete(input);
      expect(mockNftMetadataService.suggestions).toHaveBeenCalledWith({ chain_id: 4663, contract_address: contract }, 'Color');
      expect(input.respond).toHaveBeenCalledWith([{ name: 'Purple', value: 'Purple' }]);
    });
    it('retains manual entry if Alchemy fails', async () => {
      mockNftMetadataService.suggestions.mockRejectedValue(new Error('unavailable'));
      const input = interaction('attribute_key', 'Color');
      await service.handleNftAttributeAutocomplete(input);
      expect(input.respond).toHaveBeenCalledWith([{ name: 'Color', value: 'Color' }]);
    });
    it('limits suggestions to 25', async () => {
      mockNftMetadataService.suggestions.mockResolvedValue(Array.from({ length: 30 }, (_, i) => `Trait${i}`));
      const input = interaction();
      await service.handleNftAttributeAutocomplete(input);
      expect(input.respond.mock.calls[0][0]).toHaveLength(25);
    });
  });

  describe('collection input normalization in autocomplete', () => {
    it('finds saved Ordinals collections when the search contains capitals and repeated spaces', async () => {
      mockDbService.getKnownOrdinalCollectionSlugs.mockResolvedValue(['pizza-comrades', 'yonder']);
      const interaction = {options: {getFocused: () => ' PIZZA   COMRADES '}, respond: jest.fn()};
      await service.handleOrdinalSlugAutocomplete(interaction as any);
      expect(interaction.respond).toHaveBeenCalledWith([{name: 'pizza-comrades', value: 'pizza-comrades'}]);
    });
    it('normalizes the Ordinals collection context before requesting trait suggestions', async () => {
      mockOrdinalsService.suggestions.mockResolvedValue(['Gold Crown']);
      const values = {slug: ' PIZZA   COMRADES ', attribute_key: 'Category'};
      const interaction = {options: {getFocused: () => ({name: 'attribute_value', value: 'gold crown'}), getString: key => values[key]}, respond: jest.fn()};
      await service.handleOrdinalAttributeAutocomplete(interaction as any);
      expect(mockOrdinalsService.suggestions).toHaveBeenCalledWith('pizza-comrades', 'Category');
      expect(interaction.respond).toHaveBeenCalledWith([{name: 'Gold Crown', value: 'Gold Crown'}]);
    });
    it('normalizes Ethscription searches and resolves the canonical slug for trait suggestions', async () => {
      (service as any).isInitialized = true;
      const previous = await mockDataService.getAllSlugs();
      mockDataService.getAllSlugs.mockResolvedValue(['Pizza-Comrades']);
      try {
        const interaction = {options: {getFocused: () => ' PIZZA   COMRADES ', getString: () => ' PIZZA   COMRADES '}, respond: jest.fn()};
        await service.handleSlugAutocomplete(interaction as any);
        expect(interaction.respond).toHaveBeenCalledWith([{name: 'Pizza-Comrades', value: 'Pizza-Comrades'}]);
        mockCacheService.getAttributeKeys.mockResolvedValue(['EyeColor']);
        interaction.options.getFocused = () => '';
        await service.handleAttributeKeyAutocomplete(interaction as any);
        expect(mockCacheService.getAttributeKeys).toHaveBeenCalledWith('Pizza-Comrades', mockDataService);
        expect(interaction.respond).toHaveBeenLastCalledWith([{name: 'EyeColor', value: 'EyeColor'}]);
      } finally {mockDataService.getAllSlugs.mockResolvedValue(previous);}
    });
  });

  describe('Ordinals slug autocomplete', () => {
    const interaction = (typed = '') => ({ options: { getFocused: () => typed }, respond: jest.fn() });
    it('populates existing database collections and searches them case-insensitively', async () => {
      mockDbService.getKnownOrdinalCollectionSlugs.mockResolvedValue(['pizza-comrades', 'yonder']);
      const empty = interaction(); await service.handleOrdinalSlugAutocomplete(empty as any);
      expect(empty.respond).toHaveBeenCalledWith([{ name: 'pizza-comrades', value: 'pizza-comrades' }, { name: 'yonder', value: 'yonder' }]);
      const query = interaction('PIZZA'); await service.handleOrdinalSlugAutocomplete(query as any);
      expect(query.respond).toHaveBeenCalledWith([{ name: 'pizza-comrades', value: 'pizza-comrades' }, { name: 'pizza', value: 'pizza' }]);
    });
    it('keeps manual entry available when the database fails, without offering ALL or multiple slugs', async () => {
      mockDbService.getKnownOrdinalCollectionSlugs.mockRejectedValue(new Error('offline'));
      const manual = interaction(' NEW-COLLECTION '); await service.handleOrdinalSlugAutocomplete(manual as any);
      expect(manual.respond).toHaveBeenCalledWith([{ name: 'new-collection', value: 'new-collection' }]);
      for (const value of ['ALL', 'one,two', 'a'.repeat(101)]) {
        const invalid = interaction(value); await service.handleOrdinalSlugAutocomplete(invalid as any);
        expect(invalid.respond).toHaveBeenCalledWith([]);
      }
    });
    it('limits suggestions to 25 and responds before the Discord deadline when the database stalls', async () => {
      mockDbService.getKnownOrdinalCollectionSlugs.mockResolvedValue(Array.from({length: 30}, (_, n) => `collection-${n}`));
      const limited = interaction('collection'); await service.handleOrdinalSlugAutocomplete(limited as any);
      expect(limited.respond.mock.calls[0][0]).toHaveLength(25);
      expect(limited.respond.mock.calls[0][0][24]).toEqual({name: 'collection', value: 'collection'});
      jest.useFakeTimers();
      try {
        mockDbService.getKnownOrdinalCollectionSlugs.mockReturnValue(new Promise(() => {}));
        const stalled = interaction('new'); const pending = service.handleOrdinalSlugAutocomplete(stalled as any);
        await jest.advanceTimersByTimeAsync(1500); await pending;
        expect(stalled.respond).toHaveBeenCalledWith([{ name: 'new', value: 'new' }]);
      } finally { jest.useRealTimers(); }
    });
  });

  describe('Ordinals attribute autocomplete', () => {
    function interaction(name = 'attribute_key', value = '', options = {}) {
      const fields = { slug: 'yonder', asset_type: 'ordinal', ...options };
      return { options: { getFocused: () => ({ name, value }), getString: key => fields[key] ?? null }, respond: jest.fn().mockResolvedValue(undefined) } as any;
    }
    it('shows and filters hyphenated Category values for Pizza Comrades', async () => {
      mockOrdinalsService.suggestions.mockResolvedValue(['Comrade', 'Cosmic Oven-Lord', 'Honorary']);
      const options = { slug: 'pizza-comrades', attribute_key: 'Category' };
      const initial = interaction('attribute_value', '', options);
      await service.handleOrdinalAttributeAutocomplete(initial);
      expect(mockOrdinalsService.suggestions).toHaveBeenCalledWith('pizza-comrades', 'Category');
      expect(initial.respond).toHaveBeenCalledWith([
        { name: 'Comrade', value: 'Comrade' },
        { name: 'Cosmic Oven-Lord', value: 'Cosmic Oven-Lord' },
        { name: 'Honorary', value: 'Honorary' }
      ]);
      const search = interaction('attribute_value', 'oven-l', options);
      await service.handleOrdinalAttributeAutocomplete(search);
      expect(search.respond).toHaveBeenCalledWith([
        { name: 'oven-l', value: 'oven-l' }, { name: 'Cosmic Oven-Lord', value: 'Cosmic Oven-Lord' }
      ]);
    });

    it('uses the selected collection and preserves manually typed values', async () => {
      mockOrdinalsService.suggestions.mockResolvedValue(['Blue', 'Red']);
      const input = interaction('attribute_value', 'Purple', { attribute_key: 'Background' });
      await service.handleOrdinalAttributeAutocomplete(input);
      expect(mockOrdinalsService.suggestions).toHaveBeenCalledWith('yonder', 'Background');
      expect(input.respond).toHaveBeenCalledWith([{ name: 'Purple', value: 'Purple' }]);
      expect(mockNftMetadataService.suggestions).not.toHaveBeenCalled();
    });
    it('preserves manual entry when ord.net fails', async () => {
      mockOrdinalsService.suggestions.mockRejectedValue(new Error('unavailable'));
      const input = interaction('attribute_key', 'Hat');
      await service.handleOrdinalAttributeAutocomplete(input);
      expect(input.respond).toHaveBeenCalledWith([{ name: 'Hat', value: 'Hat' }]);
    });
    it('responds within the autocomplete deadline when the provider stalls', async () => {
      jest.useFakeTimers();
      try {
        mockOrdinalsService.suggestions.mockImplementation(() => new Promise(() => undefined));
        const input = interaction('attribute_key', 'Hat');
        const pending = service.handleOrdinalAttributeAutocomplete(input);
        await jest.advanceTimersByTimeAsync(1500);
        await pending;
        expect(input.respond).toHaveBeenCalledWith([{ name: 'Hat', value: 'Hat' }]);
      } finally { jest.useRealTimers(); }
    });
  });

  describe('Role Autocomplete', () => {
    beforeEach(() => {
      // Ensure service is marked as initialized for autocomplete tests
      (service as any).isInitialized = true;
    });

    it('should filter roles by focused value and bot permissions', async () => {
      const role1 = { id: 'role1', name: 'admin', position: 5, editable: true, color: 0xFF0000 }; // Red color
      const role2 = { id: 'role2', name: 'moderator', position: 3, editable: true, color: 0x00FF00 }; // Green color
      
      // Create a proper roles cache mock that returns the filtered results
      const mockRolesCache = {
        filter: jest.fn().mockReturnValue({
          filter: jest.fn().mockReturnValue({
            filter: jest.fn().mockReturnValue({
              filter: jest.fn().mockReturnValue({
                sort: jest.fn().mockReturnValue({
                  first: jest.fn().mockReturnValue([role1, role2])
                })
              })
            })
          })
        }),
        find: jest.fn().mockReturnValue(undefined) // No existing role with focused name
      };

      const mockGuildWithRoles = {
        members: { me: { roles: { highest: { position: 10 } } } },
        roles: {
          cache: mockRolesCache
        }
      };

      const mockInteraction = {
        guild: mockGuildWithRoles,
        options: {
          getFocused: jest.fn().mockReturnValue('mod')
        },
        respond: jest.fn()
      };

      await service.handleRoleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '@admin', value: 'admin' },
        { name: '@moderator', value: 'moderator' },
        { name: 'mod', value: 'mod' }
      ]);
    });

    it('should not suggest creating new role when role already exists', async () => {
      const existingRole = {
        id: 'existing-role-id',
        name: 'poop',
        position: 1,
        editable: true
      };

      const mockGuild = {
        members: { me: { roles: { highest: { position: 5 } } } },
        roles: {
          cache: {
            filter: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            first: jest.fn().mockReturnValue([existingRole]),
            find: jest.fn().mockReturnValue(existingRole)
          }
        }
      };

      const mockInteraction = {
        guild: mockGuild,
        options: {
          getFocused: jest.fn().mockReturnValue('poop')
        },
        respond: jest.fn()
      };

      await service.handleRoleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '@poop', value: 'poop' }
      ]);
    });

    it.each([
      ['unique-role-name', 'unique-role-name'],
      ['Cosmic Oven-Lord', 'Cosmic Oven-Lord'],
      ['💡 Create new role: "Cosmic Oven-Lord"', 'Cosmic Oven-Lord'],
      ['x'.repeat(100), 'x'.repeat(100)]
    ])('uses the actual role name for both suggestion label and value: %s', async (focused, roleName) => {
      const mockGuild = {
        members: { me: { roles: { highest: { position: 5 } } } },
        roles: {
          cache: {
            filter: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            first: jest.fn().mockReturnValue([]),
            find: jest.fn().mockReturnValue(undefined)
          }
        }
      };

      const mockInteraction = {
        guild: mockGuild,
        options: {
          getFocused: jest.fn().mockReturnValue(focused)
        },
        respond: jest.fn()
      };

      await service.handleRoleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: roleName, value: roleName }
      ]);
    });

    it('should handle no guild in interaction', async () => {
      const mockInteraction = {
        guild: null,
        options: {
          getFocused: jest.fn().mockReturnValue('test-role')
        },
        respond: jest.fn()
      };

      await service.handleRoleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('should handle no bot member in guild', async () => {
      const mockGuild = {
        members: { me: null },
        roles: { cache: new Map() }
      };

      const mockInteraction = {
        guild: mockGuild,
        options: {
          getFocused: jest.fn().mockReturnValue('test-role')
        },
        respond: jest.fn()
      };

      await service.handleRoleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
    });

    it('should handle autocomplete errors gracefully', async () => {
      const loggerErrorSpy = jest.spyOn(Logger, 'error').mockImplementation();
      const mockInteraction = {
        guild: { members: { me: null } },
        options: {
          getFocused: jest.fn().mockImplementation(() => {
            throw new Error('Autocomplete error');
          })
        },
        respond: jest.fn()
      };

      await service.handleRoleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([]);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Error in handleRoleAutocomplete:', expect.any(Error));
      loggerErrorSpy.mockRestore();
    });

    it('should limit autocomplete choices to 24 roles plus create option', async () => {
      const roles = Array.from({ length: 30 }, (_, i) => ({
        id: `role${i}`,
        name: `role${i}`,
        position: i + 1,
        editable: true
      }));

      const mockGuild = {
        members: { me: { roles: { highest: { position: 50 } } } },
        roles: {
          cache: {
            filter: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            first: jest.fn().mockReturnValue(roles.slice(0, 24)),
            find: jest.fn().mockReturnValue(undefined)
          }
        }
      };

      const mockInteraction = {
        guild: mockGuild,
        options: {
          getFocused: jest.fn().mockReturnValue('role')
        },
        respond: jest.fn()
      };

      await service.handleRoleAutocomplete(mockInteraction);

      const expectedChoices = [
        ...roles.slice(0, 24).map(role => ({ name: `@${role.name}`, value: role.name })),
        { name: 'role', value: 'role' }
      ];

      expect(mockInteraction.respond).toHaveBeenCalledWith(expectedChoices);
      expect(expectedChoices.length).toBe(25);
    });

    it('should display role colors when roles have colors and omit when roles are default color', async () => {
      const coloredRole = { id: 'role1', name: 'VIP', position: 5, editable: true, color: 0x9932CC }; // Purple
      const defaultColorRole = { id: 'role2', name: 'Member', position: 3, editable: true, color: 0 }; // Default/black

      const mockGuild = {
        members: { me: { roles: { highest: { position: 10 } } } },
        roles: {
          cache: {
            filter: jest.fn().mockReturnThis(),
            sort: jest.fn().mockReturnThis(),
            first: jest.fn().mockReturnValue([coloredRole, defaultColorRole]),
            find: jest.fn().mockReturnValue(undefined)
          }
        }
      };

      const mockInteraction = {
        guild: mockGuild,
        options: {
          getFocused: jest.fn().mockReturnValue('test')
        },
        respond: jest.fn()
      };

      await service.handleRoleAutocomplete(mockInteraction);

      expect(mockInteraction.respond).toHaveBeenCalledWith([
        { name: '@VIP', value: 'VIP' },
        { name: '@Member', value: 'Member' },
        { name: 'test', value: 'test' }
      ]);
    });
  });

  describe('Event Handling', () => {
    it.each([
      ['add-nft-rule', 'role', 'handleRoleAutocomplete'],
      ['add-ordinals-rule', 'role', 'handleRoleAutocomplete'],
      ['add-ethscription-rule', 'role', 'handleRoleAutocomplete'],
      ['add-nft-rule', 'attribute_key', 'handleNftAttributeAutocomplete'],
      ['add-nft-rule', 'attribute_value', 'handleNftAttributeAutocomplete'],
      ['add-ordinals-rule', 'slug', 'handleOrdinalSlugAutocomplete'],
      ['add-ordinals-rule', 'attribute_key', 'handleOrdinalAttributeAutocomplete'],
      ['add-ordinals-rule', 'attribute_value', 'handleOrdinalAttributeAutocomplete'],
      ['add-ethscription-rule', 'slug', 'handleSlugAutocomplete'],
      ['add-ethscription-rule', 'attribute_key', 'handleAttributeKeyAutocomplete'],
      ['add-ethscription-rule', 'attribute_value', 'handleAttributeValueAutocomplete']
    ] as const)('routes %s %s autocomplete without reading asset_type', async (command, focused, handler) => {
      let interactionCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'interactionCreate') interactionCallback = callback;
      });
      await service.createSlashCommands();
      const interaction = {
        isAutocomplete: () => true,
        commandName: 'setup',
        options: {
          getSubcommand: () => command,
          getFocused: () => ({ name: focused }),
          getString: jest.fn(() => { throw new Error('Unexpected legacy option lookup'); })
        }
      };
      const handlerSpy = jest.spyOn(service, handler).mockResolvedValue();
      try {
        await interactionCallback(interaction);
        expect(handlerSpy).toHaveBeenCalledWith(interaction);
        expect(interaction.options.getString).not.toHaveBeenCalled();
      } finally {
        handlerSpy.mockRestore();
      }
    });

    it('should handle interaction create events for autocomplete', async () => {
      let interactionCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'interactionCreate') {
          interactionCallback = callback;
        }
      });

      await service.createSlashCommands();

      const autocompleteInteraction = {
        isAutocomplete: () => true,
        isChatInputCommand: () => false,
        isButton: () => false,
        commandName: 'setup',
        options: {
          getSubcommand: () => 'add-ethscription-rule',
          getString: jest.fn().mockReturnValue(null),
          getFocused: jest.fn().mockReturnValue({ name: 'role' })
        }
      };

      const handleRoleAutocompleteSpy = jest.spyOn(service, 'handleRoleAutocomplete').mockResolvedValue();
      
      if (interactionCallback) {
        await interactionCallback(autocompleteInteraction);
      }

      expect(handleRoleAutocompleteSpy).toHaveBeenCalledWith(autocompleteInteraction);
      handleRoleAutocompleteSpy.mockRestore();
    });

    it('should handle interaction create events for chat input commands', async () => {
      let interactionCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'interactionCreate') {
          interactionCallback = callback;
        }
      });

      await service.createSlashCommands();

      const commandInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => true,
        isButton: () => false,
        commandName: 'setup'
      };

      const handleSetupSpy = jest.spyOn(service, 'handleSetup').mockResolvedValue();
      
      if (interactionCallback) {
        await interactionCallback(commandInteraction);
      }

      expect(handleSetupSpy).toHaveBeenCalledWith(commandInteraction);
      handleSetupSpy.mockRestore();
    });

    it('should handle interaction create events for button interactions with unified handler', async () => {
      let interactionCallback: Function;
      mockClient.on.mockImplementation((event, callback) => {
        if (event === 'interactionCreate') {
          interactionCallback = callback;
        }
      });

      await service.createSlashCommands();

      // Mock a proper button interaction with required methods
      const buttonInteraction = {
        isAutocomplete: () => false,
        isChatInputCommand: () => false,
        isButton: () => true,
        customId: 'requestVerification',
        deferReply: jest.fn().mockResolvedValue({}),
        editReply: jest.fn().mockResolvedValue({}),
        reply: jest.fn().mockResolvedValue({}),
        guild: { id: 'guild123' },
        channel: { id: 'channel123' },
        message: { id: 'message123' }
      };

      // Mock VerificationService to return empty rules for testing
      mockVerificationService.getRulesByMessageId.mockResolvedValue([]);
      mockVerificationService.getAllRulesForServer.mockResolvedValue([]);

      if (interactionCallback) {
        await interactionCallback(buttonInteraction);
      }

      // Verify the interaction was deferred
      expect(buttonInteraction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    });

    it('should route to unified verification for all rule types', async () => {
      const buttonInteraction = {
        deferReply: jest.fn().mockResolvedValue({}),
        editReply: jest.fn().mockResolvedValue({}),
        guild: { id: 'guild123' },
        channel: { id: 'channel123' },
        message: { id: 'message123' }
      };

      // Mock VerificationService to return rules for channel
      mockVerificationService.getRulesForChannel.mockResolvedValue([
        { id: 1, slug: 'test_collection', role_id: 'role123' }
      ]);

      const handleUnifiedSpy = jest.spyOn(service, 'handleUnifiedVerification').mockResolvedValue();

      await service.handleVerificationRequest(buttonInteraction as any);

      expect(handleUnifiedSpy).toHaveBeenCalledWith(buttonInteraction);
      handleUnifiedSpy.mockRestore();
    });

    it('should route to unified verification transparently', async () => {
      const buttonInteraction = {
        deferReply: jest.fn().mockResolvedValue({}),
        editReply: jest.fn().mockResolvedValue({}),
        guild: { id: 'guild123' },
        channel: { id: 'channel123' },
        message: { id: 'message123' }
      };

      // Mock VerificationService to return no channel rules, fallback to server rules
      mockVerificationService.getRulesForChannel.mockResolvedValue([]);
      mockVerificationService.getAllRulesForServer.mockResolvedValue([
        { id: 1, slug: 'test_collection', role_id: 'role123' }
      ]);

      const handleUnifiedSpy = jest.spyOn(service, 'handleUnifiedVerification').mockResolvedValue();

      await service.handleVerificationRequest(buttonInteraction as any);

      expect(handleUnifiedSpy).toHaveBeenCalledWith(buttonInteraction);
      handleUnifiedSpy.mockRestore();
    });
  });
  describe('audit log dispatch', () => {
    it('registers a single autocomplete rule selector for editing', async () => {
      await service.registerSlashCommands();
      const setup=mockRest.put.mock.calls.at(-1)[1].body.find(command=>command.name==='setup');
      const edit=setup.options.find(command=>command.name==='edit-rule');
      expect(edit.options).toHaveLength(1);
      expect(edit.options[0]).toMatchObject({name:'rule_id',required:true,autocomplete:true,type:3});
    });
    it('routes edit commands through the existing administrator guard', async () => {
      const interaction: any={guildId:'guild',user:{id:'admin'},memberPermissions:{has:()=>true},options:{getSubcommand:()=> 'edit-rule'}};
      await service.handleSetup(interaction);expect(mockDiscordCommandsService.handleEditRule).toHaveBeenCalledWith(interaction);
      mockDiscordCommandsService.handleEditRule.mockClear();
      interaction.memberPermissions.has=()=>false;interaction.reply=jest.fn();
      await service.handleSetup(interaction);expect(mockDiscordCommandsService.handleEditRule).not.toHaveBeenCalled();
    });
    it.each(['modal','button','autocomplete'])('dispatches %s editing interactions independently of verification', async kind => {
      let callback: Function;
      mockClient.on.mockImplementation((event,listener)=>{if(event==='interactionCreate')callback=listener;});
      await service.createSlashCommands();
      const interaction: any={isModalSubmit:()=>kind==='modal',isAutocomplete:()=>kind==='autocomplete',isChatInputCommand:()=>false,
        isButton:()=>kind==='button',customId:kind==='modal'?'edit-rule-form-session':'edit-rule-save-session',
        commandName:'setup',options:{getSubcommand:()=> 'edit-rule'}};
      await callback(interaction);
      const delegate=kind==='modal'?mockDiscordCommandsService.handleEditRuleModal:kind==='button'?mockDiscordCommandsService.handleEditRuleButton:mockDiscordCommandsService.handleEditRuleAutocomplete;
      expect(delegate).toHaveBeenCalledWith(interaction);
    });
    it.each(['block-wallet', 'unblock-wallet', 'list-blocked-wallets'])('routes %s through the administrator guard', async command => {
      const interaction: any = { guildId: 'guild', user: { id: 'admin' }, memberPermissions: { has: () => true }, options: { getSubcommand: () => command } };
      await service.handleSetup(interaction);
      expect(mockDiscordCommandsService.handleWalletBlock).toHaveBeenCalledWith(interaction);
    });
    it('routes wallet block pages to their own handler', async () => {
      let callback: Function;
      mockClient.on.mockImplementation((event, listener) => { if (event === 'interactionCreate') callback = listener; });
      await service.createSlashCommands();
      const interaction: any = { isAutocomplete: () => false, isChatInputCommand: () => false, isButton: () => true,
        customId: 'wallet-blocks-next-0-585432476332064769-1369930881267142686' };
      await callback(interaction);
      expect(mockDiscordCommandsService.handleWalletBlockPagination).toHaveBeenCalledWith(interaction);
    });
    it('delegates the audit command to its paginated handler', async () => {
      const interaction: any = { guildId: 'guild', user: { id: 'admin' } };
      await service.handleAuditLog(interaction);
      expect(mockDiscordCommandsService.handleAuditLog).toHaveBeenCalledWith(interaction);
    });
    it('routes audit page buttons independently of verification and rule-list buttons', async () => {
      let callback: Function;
      mockClient.on.mockImplementation((event, listener) => {
        if (event === 'interactionCreate') callback = listener;
      });
      await service.createSlashCommands();
      const interaction: any = { isAutocomplete: () => false, isChatInputCommand: () => false,
        isButton: () => true, customId: 'audit-log-next-0-123456789012345678' };
      await callback(interaction);
      expect(mockDiscordCommandsService.handleAuditLogPagination).toHaveBeenCalledWith(interaction);
    });
  });

});
