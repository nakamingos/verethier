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

  it('transfers an address that is already linked to another user', async () => {
    mockSupabaseClient.order.mockResolvedValueOnce({
      data: [
        {
          id: 10,
          user_id: 'other-user',
          address: '0xabc',
          user_name: 'Other User',
          created_at: '2026-01-01T00:00:00.000Z',
          last_verified_at: '2026-01-02T00:00:00.000Z',
        },
      ],
      error: null,
    });
    mockSupabaseClient.single.mockResolvedValueOnce({
      data: {
        id: 10,
        user_id: 'current-user',
        address: '0xabc',
        user_name: 'Current User',
        created_at: '2026-01-01T00:00:00.000Z',
        last_verified_at: '2026-01-03T00:00:00.000Z',
      },
      error: null,
    });

    const result = await service.addUserAddress('current-user', '0xAbC', 'Current User');

    expect(result).toEqual({
      success: true,
      wallet: {
        id: 10,
        user_id: 'current-user',
        address: '0xabc',
        user_name: 'Current User',
        created_at: '2026-01-01T00:00:00.000Z',
        last_verified_at: '2026-01-03T00:00:00.000Z',
      },
      isNewAddress: false,
      wasTransferred: true,
      previousUserId: 'other-user',
      previousUserName: 'Other User',
    });
    expect(mockSupabaseClient.insert).not.toHaveBeenCalled();
    expect(mockSupabaseClient.update).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'current-user',
        user_name: 'Current User',
      })
    );
  });

  it('maps a unique constraint race to a wallet transfer', async () => {
    mockSupabaseClient.order
      .mockResolvedValueOnce({
        data: [],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: 11,
            user_id: 'other-user',
            address: '0xabc',
            user_name: 'Other User',
            created_at: '2026-01-01T00:00:00.000Z',
            last_verified_at: '2026-01-02T00:00:00.000Z',
          },
        ],
        error: null,
      });
    mockSupabaseClient.single.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "user_wallets_address_key"',
      },
    }).mockResolvedValueOnce({
      data: {
        id: 11,
        user_id: 'current-user',
        address: '0xabc',
        user_name: 'Current User',
        created_at: '2026-01-01T00:00:00.000Z',
        last_verified_at: '2026-01-03T00:00:00.000Z',
      },
      error: null,
    });

    const result = await service.addUserAddress('current-user', '0xAbC', 'Current User');

    expect(result).toEqual({
      success: true,
      wallet: {
        id: 11,
        user_id: 'current-user',
        address: '0xabc',
        user_name: 'Current User',
        created_at: '2026-01-01T00:00:00.000Z',
        last_verified_at: '2026-01-03T00:00:00.000Z',
      },
      isNewAddress: false,
      wasTransferred: true,
      previousUserId: 'other-user',
      previousUserName: 'Other User',
    });
  });
});
