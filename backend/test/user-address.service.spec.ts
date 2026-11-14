import { Test, TestingModule } from '@nestjs/testing';

import { UserAddressService } from '../src/services/user-address.service';

describe('UserAddressService', () => {
  let service: UserAddressService;
  let mockSupabaseClient: any;

  beforeEach(async () => {
    mockSupabaseClient = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn(),
      single: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAddressService,
        {
          provide: 'SUPABASE_CLIENT',
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    service = module.get<UserAddressService>(UserAddressService);
    jest.clearAllMocks();
  });

  it('distinguishes an empty wallet list from a failed database read', async () => {
    mockSupabaseClient.order.mockResolvedValueOnce({ data: [], error: null });
    expect(await service.getUserAddresses('user')).toEqual([]);
    mockSupabaseClient.order.mockResolvedValueOnce({ data: null, error: new Error('Database unavailable') });
    await expect(service.getUserAddresses('user')).rejects.toThrow('Database unavailable');
  });
  it('records verification-driven wallet changes atomically with trusted source/channel context',async()=>{
    mockSupabaseClient.rpc=jest.fn().mockResolvedValue({data:{success:true,wasTransferred:true,reconciliationQueued:true},error:null});
    const activity={id:'event',source:'discord' as const,serverId:'server',channelId:'channel',walletType:'evm' as const,provenAt:'2026-01-01T00:00:00Z'};
    expect(await service.addUserAddress('member','0xABC','Collector','evm',activity)).toMatchObject({success:true,wasTransferred:true,reconciliationQueued:true});
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('verifier_link_verified_wallet',expect.objectContaining({p_user:'member',p_address:'0xabc',p_type:'evm',p_source:'discord',p_server:'server',p_channel:'channel'}));
    expect(mockSupabaseClient.from).not.toHaveBeenCalled();
    mockSupabaseClient.rpc.mockResolvedValueOnce({error:{message:'private database error'}});
    expect(await service.addUserAddress('member','0xABC','Collector','evm',activity)).toEqual({success:false,error:'Could not save wallet verification.'});
  });

  it('reports a generic failure when the wallet link call throws', async () => {
    mockSupabaseClient.rpc = jest.fn().mockRejectedValue(new Error('socket hang up'));
    const activity = { id: 'event', source: 'portal' as const, serverId: 'server', walletType: 'bitcoin' as const, provenAt: '2026-01-01T00:00:00Z' };
    expect(await service.addUserAddress('member', 'bc1qexample', null, 'bitcoin', activity))
      .toEqual({ success: false, error: 'Could not save wallet verification.' });
  });
});
