import { AuditLogHandler } from '../src/services/discord-commands/handlers/audit-log.handler';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordCommandsService } from '../src/services/discord-commands.service';
import { DiscordMessageService } from '../src/services/discord-message.service';
import { DbService } from '../src/services/db.service';
import { DiscordService } from '../src/services/discord.service';
import { AddRuleHandler } from '../src/services/discord-commands/handlers/add-rule.handler';
import { RemoveRuleHandler } from '../src/services/discord-commands/handlers/remove-rule.handler';
import { ListRulesHandler } from '../src/services/discord-commands/handlers/list-rules.handler';
import { VerificationMessageHandler } from '../src/services/discord-commands/handlers/verification-message.handler';
import { RemovalUndoInteractionHandler } from '../src/services/discord-commands/interactions/removal-undo.interaction';
import { RestoreUndoInteractionHandler } from '../src/services/discord-commands/interactions/restore-undo.interaction';
import { RuleConfirmationInteractionHandler } from '../src/services/discord-commands/interactions/rule-confirmation.interaction';
import { DuplicateRuleConfirmationInteractionHandler } from '../src/services/discord-commands/interactions/duplicate-rule-confirmation.interaction';

const mockAddRuleHandler = {
  handle: jest.fn(),
};

const mockRemoveRuleHandler = {
  handle: jest.fn(),
};

const mockAuditLogHandler = { handle: jest.fn(), handlePaginationButton: jest.fn() };
const mockListRulesHandler = {
  handle: jest.fn(),
};

const mockVerificationMessageHandler = {
  handle: jest.fn(),
};

const mockRemovalUndoHandler = {
  setupRemovalButtonHandler: jest.fn(),
  setupRemovalButtonHandlerWithExtendedTimeout: jest.fn(),
};

const mockRestoreUndoHandler = {
  setupRestoreButtonHandler: jest.fn(),
};

const mockRuleConfirmationHandler = {
  storeConfirmationData: jest.fn(),
  createConfirmationButtons: jest.fn(),
  setupConfirmationButtonHandler: jest.fn(),
};

const mockDuplicateRuleConfirmationHandler = {
  storeRuleData: jest.fn(),
  getPendingRule: jest.fn(),
  deletePendingRule: jest.fn(),
  storeCancelledRule: jest.fn(),
  getCancelledRule: jest.fn(),
  deleteCancelledRule: jest.fn(),
  createDuplicateRuleButtons: jest.fn(),
  createUndoRemovalButton: jest.fn(),
  setupDuplicateRuleButtonHandler: jest.fn(),
  setupCancellationButtonHandler: jest.fn(),
  createRuleInfoFields: jest.fn(),
};

const mockDbService = {
  addRoleMapping: jest.fn(),
  deleteRoleMapping: jest.fn(),
  getRoleMappings: jest.fn(),
};

const mockDiscordMessageService = {
  findExistingVerificationMessage: jest.fn(),
  createVerificationMessage: jest.fn(),
};

const mockDiscordService = {
  getRole: jest.fn(),
};

describe('DiscordCommandsService (Refactored)', () => {
  let service: DiscordCommandsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordCommandsService,
        { provide: DbService, useValue: mockDbService },
        { provide: DiscordMessageService, useValue: mockDiscordMessageService },
        { provide: DiscordService, useValue: mockDiscordService },
        { provide: AddRuleHandler, useValue: mockAddRuleHandler },
        { provide: RemoveRuleHandler, useValue: mockRemoveRuleHandler },
        { provide: ListRulesHandler, useValue: mockListRulesHandler },
        { provide: AuditLogHandler, useValue: mockAuditLogHandler },
        { provide: VerificationMessageHandler, useValue: mockVerificationMessageHandler },
        { provide: RemovalUndoInteractionHandler, useValue: mockRemovalUndoHandler },
        { provide: RestoreUndoInteractionHandler, useValue: mockRestoreUndoHandler },
        { provide: RuleConfirmationInteractionHandler, useValue: mockRuleConfirmationHandler },
        { provide: DuplicateRuleConfirmationInteractionHandler, useValue: mockDuplicateRuleConfirmationHandler },
        { provide: DuplicateRuleConfirmationInteractionHandler, useValue: mockDuplicateRuleConfirmationHandler },
      ],
    }).compile();

    service = module.get<DiscordCommandsService>(DiscordCommandsService);
    jest.clearAllMocks();
  });

  describe('handleAddRule', () => {
    it.each(['nft', 'ordinal', 'ethscription'] as const)('passes the selected %s asset type to AddRuleHandler', async assetType => {
      const interaction = { id: 'typed-rule' } as any;
      await service.handleAddRule(interaction, assetType);
      expect(mockAddRuleHandler.handle).toHaveBeenCalledWith(interaction, assetType);
    });

    it('should delegate to AddRuleHandler', async () => {
      const mockInteraction = {
        id: 'interaction-123',
        guild: { id: 'guild-id', name: 'test-guild' },
        user: { tag: 'test-user#1234' },
        options: { getChannel: jest.fn(), getString: jest.fn(), getInteger: jest.fn() },
        deferReply: jest.fn(),
        editReply: jest.fn(),
      } as any;

      mockAddRuleHandler.handle.mockResolvedValue(undefined);

      await service.handleAddRule(mockInteraction);

      expect(mockAddRuleHandler.handle).toHaveBeenCalledWith(mockInteraction);
    });
  });

  describe('handleRemoveRule', () => {
    it('should delegate to RemoveRuleHandler', async () => {
      const mockInteraction = {
        options: {
          getString: jest.fn().mockReturnValue('1'),
        },
        guild: { id: 'test-guild' },
      } as any;

      await service.handleRemoveRule(mockInteraction);

      expect(mockRemoveRuleHandler.handle).toHaveBeenCalledWith(mockInteraction);
    });
  });

  describe('handleListRules', () => {
    it('should delegate to ListRulesHandler', async () => {
      const mockInteraction = {
        guild: { id: 'test-guild' },
      } as any;

      await service.handleListRules(mockInteraction);

      expect(mockListRulesHandler.handle).toHaveBeenCalledWith(mockInteraction);
    });
  });

  describe('verification messages', () => {
    it('delegates the unified command without overriding its selected action', async () => {
      const interaction = { id: 'verification' } as any;
      await service.handleVerification(interaction);
      expect(mockVerificationMessageHandler.handle).toHaveBeenCalledWith(interaction);
    });

  });

  describe('service initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should have access to the add rule handler', () => {
      expect(service.handleAddRule).toBeDefined();
      expect(typeof service.handleAddRule).toBe('function');
    });

    it('should have access to the remove rule handler', () => {
      expect(service.handleRemoveRule).toBeDefined();
      expect(typeof service.handleRemoveRule).toBe('function');
    });

    it('should have access to the list rules handler', () => {
      expect(service.handleListRules).toBeDefined();
      expect(typeof service.handleListRules).toBe('function');
    });
  });
  describe('audit log handler delegation', () => {
    it('delegates audit commands and page buttons', async () => {
      const interaction: any = { id: 'audit-request' };
      await service.handleAuditLog(interaction);
      await service.handleAuditLogPagination(interaction);
      expect(mockAuditLogHandler.handle).toHaveBeenCalledWith(interaction);
      expect(mockAuditLogHandler.handlePaginationButton).toHaveBeenCalledWith(interaction);
    });
  });

});
