import { WalletBlockService } from '../src/services/wallet-block.service';
import { Test, TestingModule } from '@nestjs/testing';
import { WalletService } from '../src/services/wallet.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { NonceService } from '../src/services/nonce.service';
import { UserAddressService } from '../src/services/user-address.service';
import { DiscordService } from '../src/services/discord.service';
import { DecodedData } from '../src/models/app.interface';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Mock viem functions
jest.mock('viem', () => ({
  ...jest.requireActual('viem'),
  recoverTypedDataAddress: jest.fn(),
}));

const mockRecoverTypedDataAddress = recoverTypedDataAddress as jest.MockedFunction<typeof recoverTypedDataAddress>;

const mockNonceService = {
  validateNonce: jest.fn(),
  consumeNonce: jest.fn(),
  isNonceUsed: jest.fn(),
  markNonceAsUsed: jest.fn(),
};

const mockUserAddressService = {
  addUserAddress: jest.fn(),
};

const mockDiscordService = {
  getUser: jest.fn(),
};

const mockDynamicRoleService = {
  reverifyUser: jest.fn(),
};

const baseData: DecodedData = {
  address: '0xabc',
  userId: 'u',
  userTag: 'tag',
  avatar: '',
  discordId: 'd',
  discordName: 'dn',
  discordIcon: '',
  nonce: 'n',
  expiry: Math.floor(Date.now() / 1000) + 1000,
};

describe('WalletService', () => {
  let service: WalletService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: WalletBlockService, useValue: { allowedAddresses: async (_serverId, wallets) => wallets, assertAllowed: jest.fn().mockResolvedValue(undefined) } },
        WalletService,
        { provide: NonceService, useValue: mockNonceService },
        { provide: UserAddressService, useValue: mockUserAddressService },
        { provide: DiscordService, useValue: mockDiscordService },
        { provide: DynamicRoleService, useValue: mockDynamicRoleService }
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    jest.clearAllMocks();
    mockNonceService.consumeNonce.mockResolvedValue({});
    mockUserAddressService.addUserAddress.mockResolvedValue({ success: true, isNewAddress: true });
    mockDiscordService.getUser.mockResolvedValue({ username: 'test-user', globalName: null });
    mockDynamicRoleService.reverifyUser.mockResolvedValue({ verified: 0, revoked: 0 });
  });

  describe('verifySignature', () => {
    it.each([[true,'portal'],[false,'discord']])('uses trusted nonce context for the activity source (%s)',async(memberPortal,source)=>{
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');
      mockNonceService.consumeNonce.mockResolvedValueOnce({memberPortal,channelId:'channel'});
      mockUserAddressService.addUserAddress.mockResolvedValueOnce({success:true,wasTransferred:true,reconciliationQueued:true});
      const result=await service.verifySignature(baseData,'sig');
      expect(result.activity).toMatchObject({source,serverId:'d',channelId:'channel',walletType:'evm'});
      expect(mockUserAddressService.addUserAddress).toHaveBeenCalledWith('u','0xabc','test-user','evm',result.activity);
      expect(mockDynamicRoleService.reverifyUser).not.toHaveBeenCalled();
    });
    it('consumes the EVM proof before linking and preserves its channel context', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');
      mockNonceService.consumeNonce.mockResolvedValueOnce({ channelId: 'chosen-channel' });
      expect(await service.verifySignature(baseData, 'sig')).toMatchObject({address:'0xabc',walletOwnershipTransferred:false,nonceContext:{channelId:'chosen-channel',messageId:undefined}});
      expect(mockNonceService.consumeNonce).toHaveBeenCalledWith('u','d','n');
      expect(mockNonceService.consumeNonce.mock.invocationCallOrder[0]).toBeLessThan(mockUserAddressService.addUserAddress.mock.invocationCallOrder[0]);
      mockNonceService.consumeNonce.mockRejectedValueOnce(new Error('Invalid or expired nonce.'));
      await expect(service.verifySignature(baseData,'sig')).rejects.toThrow('Invalid or expired nonce');
      expect(mockUserAddressService.addUserAddress).toHaveBeenCalledTimes(1);
    });
    it('rejects a blocked EVM wallet before saving or transferring its link', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');
      const blocks = (service as any).walletBlocks;
      blocks.assertAllowed.mockRejectedValueOnce(new Error('This wallet has been blocked from verification in this server.'));
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('blocked');
      expect(blocks.assertAllowed).toHaveBeenCalledWith('d', '0xabc');
      expect(mockUserAddressService.addUserAddress).not.toHaveBeenCalled();
      expect(mockDynamicRoleService.reverifyUser).not.toHaveBeenCalled();
    });

    it('stops EVM verification when the wallet restriction lookup fails', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');
      (service as any).walletBlocks.assertAllowed.mockRejectedValueOnce(new Error('Could not check wallet restrictions.'));
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('Could not check');
      expect(mockUserAddressService.addUserAddress).not.toHaveBeenCalled();
    });
    it('throws error when validateNonce returns false', async () => {
      mockNonceService.validateNonce.mockResolvedValue(false);
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('Invalid or expired nonce.');
    });

    it('throws error when validateNonce returns null', async () => {
      mockNonceService.validateNonce.mockResolvedValue(null);
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('Invalid or expired nonce.');
    });

    it('throws error when signature is expired', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      const expiredData = { ...baseData, expiry: Math.floor(Date.now() / 1000) - 1000 };
      await expect(service.verifySignature(expiredData, 'sig')).rejects.toThrow('Verification has expired.');
    });

    it('throws error when signature recovery fails', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockRejectedValue(new Error('Recovery failed'));
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('Recovery failed');
    });

    it('throws error when recovered address does not match', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xother');
      await expect(service.verifySignature(baseData, 'sig')).rejects.toThrow('Invalid signature.');
    });

    it('returns address when verification succeeds', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');
      
      const result = await service.verifySignature(baseData, 'sig');
      
      expect(result).toMatchObject({
        address: '0xabc',
        walletOwnershipTransferred: false,
      });
      expect(mockNonceService.validateNonce).toHaveBeenCalledWith('u', 'd', 'n');
    });

    it('uses correct EIP-712 typed data structure', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');
      
      await service.verifySignature(baseData, 'sig');
      
      // Verify that the unified EIP-712 structure is used (without legacy fields)
      expect(mockRecoverTypedDataAddress).toHaveBeenCalledWith({
        domain: {
          name: 'Bouncer',
          version: '1',
          chainId: 1,
        },
        types: {
          Verification: [
            { name: 'UserID', type: 'string' },
            { name: 'UserTag', type: 'string' },
            { name: 'ServerID', type: 'string' },
            { name: 'ServerName', type: 'string' },
            { name: 'Nonce', type: 'string' },
            { name: 'Expiry', type: 'uint256' },
          ]
        },
        primaryType: 'Verification',
        message: {
          UserID: 'u',
          UserTag: 'tag',
          ServerID: 'd',
          ServerName: 'dn',
          Nonce: 'n',
          Expiry: baseData.expiry,
        },
        signature: 'sig',
      });
    });

    it.each(['Bouncer', 'verethier', 'unrelated-app'])('checks a real signature from the %s domain', async name => {
      const account = privateKeyToAccount(('0x' + '1'.repeat(64)) as `0x${string}`);
      const data = { ...baseData, address: account.address };
      const signature = await account.signTypedData({
        domain: { name, version: '1', chainId: 1 },
        types: { Verification: [
          { name: 'UserID', type: 'string' }, { name: 'UserTag', type: 'string' },
          { name: 'ServerID', type: 'string' }, { name: 'ServerName', type: 'string' },
          { name: 'Nonce', type: 'string' }, { name: 'Expiry', type: 'uint256' },
        ] },
        primaryType: 'Verification',
        message: { UserID: data.userId, UserTag: data.userTag, ServerID: data.discordId,
          ServerName: data.discordName, Nonce: data.nonce, Expiry: BigInt(data.expiry) },
      });
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockImplementation(jest.requireActual('viem').recoverTypedDataAddress);

      if (name === 'unrelated-app') {
        await expect(service.verifySignature(data, signature)).rejects.toThrow('Invalid signature.');
        expect(mockUserAddressService.addUserAddress).not.toHaveBeenCalled();
      } else {
        await expect(service.verifySignature(data, signature)).resolves.toMatchObject({
          address: account.address, walletOwnershipTransferred: false,
        });
      }
    });

    it('handles verification with minimal data', async () => {
      const minimalData: DecodedData = {
        address: '0x123',
        userId: 'user1',
        userTag: '',
        avatar: '',
        discordId: 'guild1',
        discordName: '',
        discordIcon: '',
        nonce: 'nonce1',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };

      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0x123');

      const result = await service.verifySignature(minimalData, 'sig');
      
      expect(result).toMatchObject({
        address: '0x123',
        walletOwnershipTransferred: false,
      });
      expect(mockNonceService.validateNonce).toHaveBeenCalledWith('user1', 'guild1', 'nonce1');
    });

    it('handles verification with complete data', async () => {
      const completeData: DecodedData = {
        address: '0x456',
        userId: 'user2',
        userTag: 'User#1234',
        avatar: 'avatar_url',
        discordId: 'guild2',
        discordName: 'Test Guild',
        discordIcon: 'icon_url',
        nonce: 'nonce2',
        expiry: Math.floor(Date.now() / 1000) + 7200,
      };

      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0x456');

      const result = await service.verifySignature(completeData, 'valid_sig');
      
      expect(result).toMatchObject({
        address: '0x456',
        walletOwnershipTransferred: false,
      });
      expect(mockNonceService.validateNonce).toHaveBeenCalledWith('user2', 'guild2', 'nonce2');
      expect(mockNonceService.validateNonce).toHaveBeenCalledTimes(1);
    });

    it('validates nonce exactly once per call', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');

      await service.verifySignature(baseData, 'sig');
      
      expect(mockNonceService.validateNonce).toHaveBeenCalledTimes(1);
      expect(mockNonceService.validateNonce).toHaveBeenCalledWith('u', 'd', 'n');
    });

    it('transfers wallet ownership and re-verifies the previous owner when another user previously owned the wallet', async () => {
      mockNonceService.validateNonce.mockResolvedValue(true);
      mockRecoverTypedDataAddress.mockResolvedValue('0xabc');
      mockUserAddressService.addUserAddress.mockResolvedValue({
        success: true,
        isNewAddress: false,
        wasTransferred: true,
        previousUserId: 'previous-user',
      });

      await expect(service.verifySignature(baseData, 'sig')).resolves.toMatchObject({
        address: '0xabc',
        walletOwnershipTransferred: true,
      });
      expect(mockDynamicRoleService.reverifyUser).toHaveBeenCalledWith('previous-user');
    });
  });
});
