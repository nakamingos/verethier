import { Test, TestingModule } from '@nestjs/testing';
import { VerificationService } from '../src/services/verification.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { DbService } from '../src/services/db.service';

describe('VerificationService', () => {
  let service: VerificationService;
  let mockDbService: jest.Mocked<Partial<DbService>>;
  let mockVerificationEngine: jest.Mocked<Partial<VerificationEngine>>;

  beforeEach(async () => {
    mockDbService = {
      getRoleMappings: jest.fn(),
      getRulesByChannel: jest.fn(),
    };

    mockVerificationEngine = {
      verifyUserBulk: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerificationService,
        { provide: DbService, useValue: mockDbService },
        { provide: VerificationEngine, useValue: mockVerificationEngine },
      ],
    }).compile();

    service = module.get<VerificationService>(VerificationService);
  });

  describe('getAllRulesForServer', () => {
    it('should return all rules from unified database', async () => {
      const mockRules = [
        { id: 1, slug: 'collection1', server_id: 'server-123' },
        { id: 2, slug: 'special_collection', server_id: 'server-123' },
        { id: 3, slug: 'ALL', server_id: 'server-123' }
      ];

      mockDbService.getRoleMappings.mockResolvedValue(mockRules);

      const result = await service.getAllRulesForServer('server-123');

      expect(result).toEqual(mockRules);
      expect(mockDbService.getRoleMappings).toHaveBeenCalledWith('server-123');
    });
  });

  describe('getRulesForChannel', () => {
    it('should return the channel rules from the database', async () => {
      const mockRules = [{ id: 1, slug: 'collection1', server_id: 'server-123', channel_id: 'channel-123' }];
      mockDbService.getRulesByChannel.mockResolvedValue(mockRules as any);

      await expect(service.getRulesForChannel('server-123', 'channel-123')).resolves.toEqual(mockRules);
      expect(mockDbService.getRulesByChannel).toHaveBeenCalledWith('server-123', 'channel-123');
    });
  });

  describe('verifyUserBulk', () => {
    const mockResult = {
      userId: 'user-123',
      address: '0xabc',
      totalRules: 2,
      validRules: [],
      invalidRules: [],
      matchingAssetCounts: new Map(),
      results: []
    };

    it('should verify user against multiple rules using VerificationEngine', async () => {
      mockVerificationEngine.verifyUserBulk.mockResolvedValue(mockResult);

      const result = await service.verifyUserBulk('user-123', [1, 2], '0xabc');

      expect(result).toEqual(mockResult);
      expect(mockVerificationEngine.verifyUserBulk).toHaveBeenCalledWith('user-123', [1, 2], '0xabc');
    });

    it('passes preloaded rules and the shared check context through', async () => {
      mockVerificationEngine.verifyUserBulk.mockResolvedValue(mockResult);
      const rules = [{ id: 1 }] as any;
      const context = { checks: new Map() } as any;

      await service.verifyUserBulk('user-123', [1], '0xabc', context, rules);

      expect(mockVerificationEngine.verifyUserBulk).toHaveBeenCalledWith('user-123', [1], '0xabc', rules, context);
    });
  });
});
