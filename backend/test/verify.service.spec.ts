import { RoleExcludedError } from '../src/utils/role-excluded-error.util';
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { VerifyService } from '../src/services/verify.service';
import { WalletService } from '../src/services/wallet.service';
import { NonceService } from '../src/services/nonce.service';
import { DiscordService } from '../src/services/discord.service';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { DataService } from '../src/services/data.service';
import { DbService } from '../src/services/db.service';
import { VerificationService } from '../src/services/verification.service';
import { OrdinalsRequestScheduler } from '../src/services/ordinals-request-scheduler.service';

const finishVerification = jest.fn();
const mockOrdinalRequests = { beginVerification: jest.fn().mockReturnValue(finishVerification) };

const mockWalletService = { verifySignature: jest.fn() };
const mockNonceService = { 
  invalidateNonce: jest.fn(),
  getNonceData: jest.fn().mockResolvedValue({ messageId: 'msg-id', channelId: 'ch-id' })
};
const mockDiscordService = {
  addUserRole: jest.fn(),
  throwError: jest.fn(),
  getUser: jest.fn().mockResolvedValue({ username: 'testuser' }),
  getGuild: jest.fn().mockResolvedValue({ name: 'Test Guild' }),
  getRole: jest.fn().mockResolvedValue({ name: 'Test Role' })
};
const releaseReply = jest.fn();
const mockDiscordVerificationService = {
  retainVerificationRequest: jest.fn().mockReturnValue(releaseReply),
  addUserRole: jest.fn().mockResolvedValue({
    roleId: 'test-role-id',
    roleName: 'Test Role',
    wasAlreadyAssigned: false
  }),
  throwError: jest.fn(),
  sendVerificationComplete: jest.fn(),
};
const mockDataService = { 
  getDetailedAssets: jest.fn(),
  checkAssetOwnership: jest.fn().mockResolvedValue(1),
  checkAssetOwnershipWithCriteria: jest.fn().mockResolvedValue(1)
};
const mockDbService = {
  recordWalletVerification:jest.fn().mockResolvedValue(undefined),
  getServerRole: jest.fn(),
  logUserRole: jest.fn(),
  getRoleMappings: jest.fn(),
  findRuleByMessageId: jest.fn().mockResolvedValue({ 
    id: 1, 
    role_id: 'role-id', 
    slug: 'test-collection',
    attribute_key: '',
    attribute_value: '',
    min_items: 1
  }),
  findRulesByMessageId: jest.fn().mockResolvedValue([])
};
const mockVerificationService = {
  getRulesByMessageId: jest.fn().mockResolvedValue([{
    id: 1,
    role_id: 'role-id',
    slug: 'test-collection',
    attribute_key: '',
    attribute_value: '',
    min_items: 1
  }]),
  getRulesForChannel: jest.fn().mockResolvedValue([{
    id: 1,
    role_id: 'role-id',
    slug: 'test-collection',
    attribute_key: '',
    attribute_value: '',
    min_items: 1
  }]),
  verifyUserBulk: jest.fn().mockResolvedValue({
    validRules: [{
      id: 1,
      role_id: 'role-id',
      slug: 'test-collection',
      attribute_key: '',
      attribute_value: '',
      min_items: 1
    }],
    invalidRules: [],
    matchingAssetCounts: new Map([['1', 1]])
  }),
  getAllRulesForServer: jest.fn().mockResolvedValue([{
    id: 1,
    role_id: 'role-id',
    slug: 'test-collection',
    attribute_key: '',
    attribute_value: '',
    min_items: 1
  }]),
  assignRoleToUser: jest.fn().mockResolvedValue(undefined)
};

describe('VerifyService', () => {
  let service: VerifyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VerifyService,
        { provide: WalletService, useValue: mockWalletService },
        { provide: NonceService, useValue: mockNonceService },
        { provide: DiscordService, useValue: mockDiscordService },
        { provide: DiscordVerificationService, useValue: mockDiscordVerificationService },
        { provide: DataService, useValue: mockDataService },
        { provide: DbService, useValue: mockDbService },
        { provide: VerificationService, useValue: mockVerificationService },
        { provide: OrdinalsRequestScheduler, useValue: mockOrdinalRequests },
      ],
    }).compile();
    service = module.get<VerifyService>(VerifyService);
    jest.clearAllMocks();
  });



  it('retains the original Discord reply before async signature work and releases it on completion', async () => {
    let finish: (value:any)=>void;
    const pending = new Promise(resolve=>{finish=resolve;});
    mockWalletService.verifySignature.mockReturnValueOnce(pending);
    const complete = jest.spyOn(service as any,'completeVerification').mockResolvedValue({assignedRoles:['holder']});
    const request = service.verifySignatureFlow({userId:'u',discordId:'g',nonce:'n'} as any,'sig');
    expect(mockDiscordVerificationService.retainVerificationRequest).toHaveBeenCalledWith('n','u','g');
    expect(releaseReply).not.toHaveBeenCalled();
    finish({address:'wallet',walletOwnershipTransferred:false});
    await request;
    expect(complete).toHaveBeenCalledTimes(1);
    expect(releaseReply).toHaveBeenCalledTimes(1);
    complete.mockRestore();
  });
  it('releases the retained reply on rejected signatures without starting eligibility checks', async () => {
    mockWalletService.verifySignature.mockRejectedValueOnce(new Error('bad signature'));
    await expect(service.verifySignatureFlow({userId:'u',discordId:'g',nonce:'n'} as any,'sig')).rejects.toThrow('bad signature');
    expect(releaseReply).toHaveBeenCalledTimes(1);
    expect(mockVerificationService.verifyUserBulk).not.toHaveBeenCalled();
    expect(mockOrdinalRequests.beginVerification).not.toHaveBeenCalled();
  });
  it('reports policy exclusions as skips while granting the remaining eligible role', async () => {
    mockWalletService.verifySignature.mockResolvedValueOnce({address:'wallet',walletOwnershipTransferred:false,nonceContext:{channelId:'channel'}});
    const rules=[{id:1,role_id:'lower'},{id:2,role_id:'higher'}];
    mockVerificationService.getRulesForChannel.mockResolvedValueOnce(rules);
    mockVerificationService.verifyUserBulk.mockResolvedValueOnce({validRules:rules,invalidRules:[],matchingAssetCounts:new Map()});
    mockDiscordVerificationService.addUserRole.mockRejectedValueOnce(new RoleExcludedError()).mockResolvedValueOnce({roleId:'higher',roleName:'Higher',wasAlreadyAssigned:false});
    const error = jest.spyOn(Logger,'error').mockImplementation(()=>{});
    const result=await service.verifySignatureFlow({userId:'u',discordId:'g',nonce:'n'} as any,'sig');
    expect(result.assignedRoles).toEqual(['higher']);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
  it('can verify a proven wallet when every eligible role is intentionally excluded', async () => {
    mockWalletService.verifySignature.mockResolvedValueOnce({address:'wallet',walletOwnershipTransferred:false,nonceContext:{channelId:'channel'}});
    mockVerificationService.getRulesForChannel.mockResolvedValueOnce([{id:1,role_id:'lower'}]);
    mockVerificationService.verifyUserBulk.mockResolvedValueOnce({validRules:[{id:1,role_id:'lower'}],invalidRules:[],matchingAssetCounts:new Map()});
    mockDiscordVerificationService.addUserRole.mockRejectedValueOnce(new RoleExcludedError());
    const result=await service.verifySignatureFlow({userId:'u',discordId:'g',nonce:'n'} as any,'sig');
    expect(result.assignedRoles).toEqual([]);
    expect(mockDiscordVerificationService.throwError).not.toHaveBeenCalled();
  });
  it('uses a validated member-portal proof for grants without expecting a Discord reply', async () => {
    mockWalletService.verifySignature.mockResolvedValueOnce({address:'wallet',walletOwnershipTransferred:false,nonceContext:{channelId:'channel'},activity:{source:'portal'}});
    mockVerificationService.getRulesForChannel.mockResolvedValueOnce([{id:1,role_id:'holder'}]);
    mockVerificationService.verifyUserBulk.mockResolvedValueOnce({validRules:[{id:1,role_id:'holder'}],invalidRules:[],matchingAssetCounts:new Map()});
    mockDiscordVerificationService.addUserRole.mockResolvedValueOnce({roleId:'holder',roleName:'Holder',wasAlreadyAssigned:false});
    const result=await service.verifySignatureFlow({userId:'u',discordId:'g',nonce:'n'} as any,'sig');
    expect(result.assignedRoles).toEqual(['holder']);
    expect(mockDiscordVerificationService.addUserRole.mock.calls[0][6].portalVerification).toEqual({userId:'u',guildId:'g',nonce:'n'});
    expect(mockDiscordVerificationService.sendVerificationComplete).not.toHaveBeenCalled();
  });
  it.each([
    ['evm',['ethereum','robinhood','base','ethscriptions'],[1,2,3,4]],
    ['bitcoin',['stamps','ordinals'],[5,6]],
    ['solana',['solana'],[7,8]],
  ])('limits %s proof checks, reconciliation and recommendations to that family', async (walletType,families,ids) => {
    const definitions=[
      {id:1,asset_type:'nft',chain_id:1},{id:2,asset_type:'erc20',chain_id:4663},
      {id:3,asset_type:'nft',chain_id:8453},{id:4,asset_type:'ethscription'},
      {id:5,asset_type:'stamp'},{id:6,asset_type:'ordinal'},
      {id:7,asset_type:'solana_nft'},{id:8,asset_type:'solana_token'},
    ].map(rule=>({...rule,role_id:'role-'+rule.id}));
    mockWalletService.verifySignature.mockResolvedValueOnce({address:'proven',walletOwnershipTransferred:false,nonceContext:{channelId:'channel'},activity:{walletType,source:'discord'}});
    mockVerificationService.getRulesForChannel.mockResolvedValueOnce(definitions);
    mockVerificationService.verifyUserBulk.mockImplementationOnce(async (_user,_ids,_address,_context,rules)=>({validRules:rules,invalidRules:[],matchingAssetCounts:new Map()}));
    const reconcile=jest.fn().mockResolvedValue({verified:0,revoked:0,errors:0});
    (service as any).earnedRoles={reverifyUserInServer:reconcile};
    await service.verifySignatureFlow({userId:'user',discordId:'server',nonce:'nonce',walletType} as any,'sig');
    const checked=mockVerificationService.verifyUserBulk.mock.calls[0];
    expect(checked[1]).toEqual(ids);
    expect([...checked[3].verificationCheckFamilies]).toEqual(families);
    expect(checked[4].map(rule=>rule.id)).toEqual(ids);
    expect(reconcile).toHaveBeenCalledWith('user','server',checked[3]);
    expect(mockDiscordVerificationService.sendVerificationComplete.mock.calls[0][4]).toBe(checked[3]);
    if(walletType==='bitcoin') {
      expect(mockOrdinalRequests.beginVerification).toHaveBeenCalledTimes(1);
      expect(finishVerification).toHaveBeenCalledTimes(1);
    } else expect(mockOrdinalRequests.beginVerification).not.toHaveBeenCalled();
  });
  it('handles multi-rule path', async () => {
    // Mock empty nonce data to trigger multi-rule path
    mockNonceService.getNonceData.mockResolvedValue({ messageId: null, channelId: null });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: false });
    
    // Mock verification service to return rules and successful verification
    mockVerificationService.getAllRulesForServer.mockResolvedValue([
      { id: 1, slug: 'ALL', channel_id: null, attribute_key: '', attribute_value: '', min_items: 0, role_id: 'r1' },
      { id: 2, slug: 'ALL', channel_id: null, attribute_key: '', attribute_value: '', min_items: 0, role_id: 'r2' },
    ]);
    mockVerificationService.verifyUserBulk.mockResolvedValue({
      validRules: [
        { id: 1, slug: 'ALL', channel_id: null, attribute_key: '', attribute_value: '', min_items: 0, role_id: 'r1' },
        { id: 2, slug: 'ALL', channel_id: null, attribute_key: '', attribute_value: '', min_items: 0, role_id: 'r2' },
      ],
      invalidRules: [],
      matchingAssetCounts: new Map([['1', 1], ['2', 1]])
    });
    
    const payload = { userId: 'u', discordId: 'g', nonce: 'n' };
    await service.verifySignatureFlow(payload as any, 'sig');
    expect(mockVerificationService.getAllRulesForServer).toHaveBeenCalled();
    expect(mockNonceService.getNonceData).toHaveBeenCalledWith('u', 'n');
    expect(mockNonceService.invalidateNonce).toHaveBeenCalledWith('n');
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledTimes(2);
  });
  it('records successful manual verification but not failed eligibility or bad signatures',async()=>{
    const activity={id:'event',source:'discord',serverId:'g',channelId:'ch',walletType:'evm',provenAt:'2026-01-01T00:00:00Z'};
    mockWalletService.verifySignature.mockResolvedValue({address:'0xabc',walletOwnershipTransferred:false,activity});
    const complete=jest.spyOn(service as any,'completeVerification').mockResolvedValue({assignedRoles:['holder']});
    await service.verifySignatureFlow({userId:'u'} as any,'sig');
    expect(mockDbService.recordWalletVerification).toHaveBeenCalledWith('u','0xabc',activity);
    mockDbService.recordWalletVerification.mockClear();complete.mockRejectedValueOnce(new Error('No matching holdings'));
    await expect(service.verifySignatureFlow({userId:'u'} as any,'sig')).rejects.toThrow('No matching holdings');
    expect(mockDbService.recordWalletVerification).not.toHaveBeenCalled();
    mockWalletService.verifySignature.mockRejectedValueOnce(new Error('bad signature'));
    await expect(service.verifySignatureFlow({userId:'u'} as any,'sig')).rejects.toThrow('bad signature');
    expect(mockDbService.recordWalletVerification).not.toHaveBeenCalled();
    complete.mockRestore();
  });

  it('throws error if no match', async () => {
    // Mock empty nonce data to trigger multi-rule path, but no matching assets
    mockNonceService.getNonceData.mockResolvedValue({ messageId: null, channelId: null });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: false });
    
    // Mock verification service to return empty rules  
    mockVerificationService.getAllRulesForServer.mockResolvedValue([]);
    
    const payload = { userId: 'u', discordId: 'g', nonce: 'n' };
    await expect(service.verifySignatureFlow(payload as any, 'sig')).rejects.toThrow('No verification rules found for this server');
    expect(mockDiscordVerificationService.throwError).toHaveBeenCalled();
  });

  it('handles message-based verification with single rule', async () => {
    // Mock nonce data with messageId and channelId to trigger message-based path
    mockNonceService.getNonceData.mockResolvedValue({ 
      messageId: 'msg-123', 
      channelId: 'ch-456' 
    });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: true });
    
    const mockRules = [{
      id: 1,
      role_id: 'role-123',
      slug: 'test-collection',
      attribute_key: 'trait',
      attribute_value: 'rare',
      min_items: 1
    }];
    
    // Mock verification service instead of DbService
    mockVerificationService.getRulesForChannel.mockResolvedValue(mockRules);
    mockVerificationService.verifyUserBulk.mockResolvedValue({
      validRules: mockRules,
      invalidRules: [],
      matchingAssetCounts: new Map([['1', 2]])
    });
    
    const payload = { 
      userId: 'user123', 
      discordId: 'guild123', 
      nonce: 'nonce123' 
    };
    
    const result = await service.verifySignatureFlow(payload as any, 'sig');
    
    expect(mockNonceService.getNonceData).toHaveBeenCalledWith('user123', 'nonce123');
    expect(mockNonceService.invalidateNonce).toHaveBeenCalledWith('nonce123');
    expect(mockVerificationService.getRulesForChannel).toHaveBeenCalledWith('guild123', 'ch-456');
    expect(mockOrdinalRequests.beginVerification).not.toHaveBeenCalled();
    expect(finishVerification).not.toHaveBeenCalled();
    const ownershipContext = mockVerificationService.verifyUserBulk.mock.calls[0][3];
    expect(ownershipContext.checks).toBeInstanceOf(Map);
    expect(mockVerificationService.verifyUserBulk).toHaveBeenCalledWith('user123', [1], '0xabc', ownershipContext, mockRules);
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledWith('user123', 'role-123', 'guild123', 'nonce123', '1', expect.objectContaining({ last_check_status: 'passed' }), expect.any(Map));
    expect(mockDiscordVerificationService.sendVerificationComplete).toHaveBeenCalledWith('guild123', 'nonce123', [{
      roleId: 'test-role-id',
      roleName: 'Test Role',
      wasAlreadyAssigned: false,
      ruleId: '1',
      matchingCount: 2
    }], '0xabc', ownershipContext);
    expect(result.message).toContain('message-based');
    expect(result.assignedRoles).toEqual(['test-role-id']);
    expect(result.walletOwnershipTransferred).toBe(true);
  });

  it('handles message-based verification with multiple rules', async () => {
    mockNonceService.getNonceData.mockResolvedValue({ 
      messageId: 'msg-123', 
      channelId: 'ch-456' 
    });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: false });
    
    const mockRules = [
      {
        id: 1,
        role_id: 'role-123',
        slug: 'collection1',
        attribute_key: null,
        attribute_value: null,
        min_items: 1
      },
      {
        id: 2,
        role_id: 'role-456',
        slug: 'collection2',
        attribute_key: 'trait',
        attribute_value: 'rare',
        min_items: 2
      }
    ];
    
    // Mock verification service to return both rules as valid
    mockVerificationService.getRulesForChannel.mockResolvedValue(mockRules);
    mockVerificationService.verifyUserBulk.mockResolvedValue({
      validRules: mockRules,
      invalidRules: [],
      matchingAssetCounts: new Map([['1', 5], ['2', 3]])
    });
    
    const payload = { 
      userId: 'user123', 
      discordId: 'guild123', 
      nonce: 'nonce123' 
    };
    
    const result = await service.verifySignatureFlow(payload as any, 'sig');
    
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledTimes(2);
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledWith('user123', 'role-123', 'guild123', 'nonce123', '1', expect.objectContaining({ last_check_status: 'passed' }), expect.any(Map));
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledWith('user123', 'role-456', 'guild123', 'nonce123', '2', expect.objectContaining({ last_check_status: 'passed' }), expect.any(Map));
    expect(mockDiscordVerificationService.sendVerificationComplete).toHaveBeenCalledWith('guild123', 'nonce123', [
      { roleId: 'test-role-id', roleName: 'Test Role', wasAlreadyAssigned: false, ruleId: '1', matchingCount: 5 },
      { roleId: 'test-role-id', roleName: 'Test Role', wasAlreadyAssigned: false, ruleId: '2', matchingCount: 3 }
    ], '0xabc', mockVerificationService.verifyUserBulk.mock.calls[0][3]);
    expect(result.assignedRoles).toEqual(['test-role-id']);
  });

  it('handles message-based verification when no rules found', async () => {
    mockNonceService.getNonceData.mockResolvedValue({ 
      messageId: 'msg-123', 
      channelId: 'ch-456' 
    });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: false });
    
    // Mock verification service to return empty rules
    mockVerificationService.getRulesForChannel.mockResolvedValue([]);
    
    const payload = { 
      userId: 'user123', 
      discordId: 'guild123', 
      nonce: 'nonce123' 
    };
    
    await expect(service.verifySignatureFlow(payload as any, 'sig'))
      .rejects.toThrow('No verification rules found for this channel');
    
    expect(mockDiscordVerificationService.throwError).toHaveBeenCalledWith('nonce123', 'No verification rules found for this channel');
    expect(finishVerification).not.toHaveBeenCalled();
  });

  it('handles message-based verification when user does not meet criteria', async () => {
    mockNonceService.getNonceData.mockResolvedValue({ 
      messageId: 'msg-123', 
      channelId: 'ch-456' 
    });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: false });
    
    const mockRules = [{
      id: 1,
      role_id: 'role-123',
      slug: 'test-collection',
      attribute_key: null,
      attribute_value: null,
      min_items: 1
    }];
    
    // Mock verification service to return rules but no valid matches
    mockVerificationService.getRulesForChannel.mockResolvedValue(mockRules);
    mockVerificationService.verifyUserBulk.mockResolvedValue({
      validRules: [],
      invalidRules: mockRules,
      matchingAssetCounts: new Map([['1', 0]])
    });
    
    const payload = { 
      userId: 'user123', 
      discordId: 'guild123', 
      nonce: 'nonce123' 
    };
    
    await expect(service.verifySignatureFlow(payload as any, 'sig'))
      .rejects.toThrow('Address does not own the required assets for collection: test-collection');
    
    expect(mockDiscordVerificationService.throwError).toHaveBeenCalledWith('nonce123', 'Address does not own the required assets for collection: test-collection');
    expect(mockDiscordVerificationService.addUserRole).not.toHaveBeenCalled();
  });

  it('handles message-based verification with some rules failing', async () => {
    mockNonceService.getNonceData.mockResolvedValue({ 
      messageId: 'msg-123', 
      channelId: 'ch-456' 
    });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: false });
    
    const mockRules = [
      {
        id: 1,
        role_id: 'role-123',
        slug: 'collection1',
        attribute_key: null,
        attribute_value: null,
        min_items: 1
      },
      {
        id: 2,
        role_id: 'role-456',
        slug: 'collection2',
        attribute_key: 'trait',
        attribute_value: 'rare',
        min_items: 5 // User doesn't have enough
      }
    ];
    
    // Mock verification service to return only the first rule as valid
    mockVerificationService.getRulesForChannel.mockResolvedValue(mockRules);
    mockVerificationService.verifyUserBulk.mockResolvedValue({
      validRules: [mockRules[0]], // Only first rule passes
      invalidRules: [mockRules[1]], // Second rule fails
      matchingAssetCounts: new Map([['1', 3], ['2', 2]])
    });
    
    const payload = { 
      userId: 'user123', 
      discordId: 'guild123', 
      nonce: 'nonce123' 
    };
    
    const result = await service.verifySignatureFlow(payload as any, 'sig');
    
    // Should only assign the first role
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledTimes(1);
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledWith('user123', 'role-123', 'guild123', 'nonce123', '1', expect.objectContaining({ last_check_status: 'passed' }), expect.any(Map));
    expect(result.assignedRoles).toEqual(['test-role-id']);
  });

  it('handles message-based verification with role assignment error', async () => {
    mockNonceService.getNonceData.mockResolvedValue({ 
      messageId: 'msg-123', 
      channelId: 'ch-456' 
    });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: false });
    
    const mockRules = [{
      id: 1,
      role_id: 'role-123',
      slug: 'test-collection',
      attribute_key: null,
      attribute_value: null,
      min_items: 1
    }];
    
    // Mock verification service
    mockVerificationService.getRulesForChannel.mockResolvedValue(mockRules);
    mockVerificationService.verifyUserBulk.mockResolvedValue({
      validRules: mockRules,
      invalidRules: [],
      matchingAssetCounts: new Map([['1', 1]])
    });
    mockDiscordVerificationService.addUserRole.mockRejectedValue(new Error('Discord error'));
    
    const payload = { 
      userId: 'user123', 
      discordId: 'guild123', 
      nonce: 'nonce123' 
    };
    
    await expect(service.verifySignatureFlow(payload as any, 'sig')).rejects.toThrow('Discord roles could not be assigned');
    expect(mockDiscordVerificationService.sendVerificationComplete).not.toHaveBeenCalled();
    expect(mockDiscordVerificationService.throwError).toHaveBeenCalledWith('nonce123',expect.stringContaining('request a new verification link'));
  });

  it('handles message-based verification with null role_id', async () => {
    mockNonceService.getNonceData.mockResolvedValue({ 
      messageId: 'msg-123', 
      channelId: 'ch-456' 
    });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: false });
    
    const mockRules = [
      {
        id: 1,
        role_id: null, // This should be skipped
        slug: 'collection1',
        attribute_key: null,
        attribute_value: null,
        min_items: 1
      },
      {
        id: 2,
        role_id: 'role-456',
        slug: 'collection2',
        attribute_key: null,
        attribute_value: null,
        min_items: 1
      }
    ];
    
    // Mock verification service - only return rule with role_id as valid
    mockVerificationService.getRulesForChannel.mockResolvedValue(mockRules);
    mockVerificationService.verifyUserBulk.mockResolvedValue({
      validRules: [mockRules[1]], // Only second rule (has role_id)
      invalidRules: [],
      matchingAssetCounts: new Map([['2', 1]])
    });
    mockDiscordVerificationService.addUserRole.mockResolvedValue({
      roleId: 'role-456',
      roleName: 'Test Role 456',
      wasAlreadyAssigned: false
    });
    
    const payload = { 
      userId: 'user123', 
      discordId: 'guild123', 
      nonce: 'nonce123' 
    };
    
    const result = await service.verifySignatureFlow(payload as any, 'sig');
    
    // Should only process the second rule
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledTimes(1);
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledWith('user123', 'role-456', 'guild123', 'nonce123', '2', expect.objectContaining({ last_check_status: 'passed' }), expect.any(Map));
    expect(result.assignedRoles).toEqual(['role-456']);
  });

  it('handles rule with min_items=0 correctly', async () => {
    const mockPayload = {
      userId: 'user123',
      discordId: 'guild123',
      nonce: 'nonce123',
      address: '0x123...abc',
      userTag: 'TestUser#1234',
      avatar: 'avatar.png',
      discordName: 'TestUser',
      discordIcon: 'guild-icon.png',
      expiry: Date.now() + 3600000
    };
    const mockSignature = 'signature123';
    const mockAddress = '0x123...abc';
    const mockMessageId = 'message123';
    const mockChannelId = 'channel123';

    // Mock the wallet verification
    mockWalletService.verifySignature.mockResolvedValue({ address: mockAddress, walletOwnershipTransferred: false });
    
    // Mock nonce service
    mockNonceService.getNonceData.mockResolvedValue({
      messageId: mockMessageId,
      channelId: mockChannelId
    });

    // Mock a rule with min_items=0
    const mockRules = [{
      id: 1,
      role_id: 'role123',
      role_name: 'Test Role',
      slug: 'test-collection',
      attribute_key: null,
      attribute_value: null,
      min_items: 0,  // This should allow assignment even with 0 assets
      server_id: 'guild123',
      server_name: 'TestGuild',
      channel_id: 'channel123',
      channel_name: 'test-channel'
    }];

    // Mock verification service
    mockVerificationService.getRulesForChannel.mockResolvedValue(mockRules);
    mockVerificationService.verifyUserBulk.mockResolvedValue({
      validRules: mockRules, // Rule passes because min_items=0
      invalidRules: [],
      matchingAssetCounts: new Map([['1', 0]]) // 0 assets but still valid
    });
    
    // Reset the mock for this test
    mockDiscordVerificationService.addUserRole.mockResolvedValue({
      roleId: 'role123',
      roleName: 'Test Role',
      wasAlreadyAssigned: false
    });

    const result = await service.verifySignatureFlow(mockPayload, mockSignature);

    // Should succeed even with 0 assets because min_items=0
    expect(result.message).toContain('Verification successful');
    expect(result.assignedRoles).toEqual(['role123']);
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledWith(
      'user123',
      'role123',
      'guild123',
      'nonce123',
      '1',
      expect.objectContaining({ last_check_status: 'passed' }), expect.any(Map)
    );
  });

  it.each([true, false])('assigns shared roles once and preserves every matching rule (channel=%s)', async channel => {
    mockNonceService.getNonceData.mockResolvedValue({ channelId: channel ? 'channel' : null });
    mockWalletService.verifySignature.mockResolvedValue({ address: '0xabc', walletOwnershipTransferred: false });
    const rules = [
      { id: 1, role_id: 'shared', asset_type: 'ethscription', min_items: 10 },
      { id: 2, role_id: 'shared', asset_type: 'ethscription', min_items: 10 },
      { id: 3, role_id: 'other', asset_type: 'ethscription', min_items: 1 },
    ];
    const checks = rules.map(rule => ({ rule, ruleId: rule.id, isValid: true }));
    mockVerificationService.getRulesForChannel.mockResolvedValue(rules);
    mockVerificationService.getAllRulesForServer.mockResolvedValue(rules);
    mockVerificationService.verifyUserBulk.mockResolvedValue({
      validRules: rules, invalidRules: [], results: checks,
      matchingAssetCounts: new Map([['1', 10], ['2', 10], ['3', 1]]),
    });
    mockDiscordVerificationService.addUserRole.mockImplementation(async (_user, roleId) => ({
      roleId, roleName: roleId, wasAlreadyAssigned: roleId === 'other',
    }));
    const result = await service.verifySignatureFlow({ userId: 'user', discordId: 'server', nonce: 'nonce' } as any, 'sig');
    expect(mockDiscordVerificationService.addUserRole).toHaveBeenCalledTimes(2);
    expect(mockDiscordVerificationService.addUserRole.mock.calls[0][5]).toEqual({
      last_check_status: 'passed', matched_rule_ids: [1, 2], rule_checks: checks.slice(0, 2),
    });
    expect(mockDiscordVerificationService.addUserRole.mock.calls[0][6])
      .toBe(mockDiscordVerificationService.addUserRole.mock.calls[1][6]);
    const displayed = mockDiscordVerificationService.sendVerificationComplete.mock.calls[0][2];
    expect(displayed.map(role => role.ruleId)).toEqual(['1', '2', '3']);
    expect(result.assignedRoles).toEqual(['shared', 'other']);
    expect(result.message).toContain('1 new roles assigned, 1 existing roles');
    expect(mockVerificationService.verifyUserBulk.mock.calls[0][4]).toEqual(rules);
  });
});
