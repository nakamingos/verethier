import { WalletService } from '../src/services/wallet.service';
import { WalletBlockService, WALLET_BLOCKED } from '../src/services/wallet-block.service';
import { PortalService } from '../src/portal/portal.service';
import { PrivacyService } from '../src/portal/privacy.service';
import { EnvironmentConfig } from '../src/config/environment.config';
const address = '0x' + 'a'.repeat(40);
const server = '111111111111111111', user = '222222222222222222';
const data = { userId: user, userTag: 'Member', discordId: server, discordName: 'Guild', address, nonce: 'private-proof-token', expiry: Math.floor(Date.now() / 1000) + 300, avatar: '', discordIcon: '' };
function walletFixture() {
    const context = { memberPortal: true, channelId: 'trusted-channel' };
    const nonces = { validateNonce: jest.fn().mockResolvedValue(true), getActiveNonce: jest.fn().mockResolvedValue(context), consumeNonce: jest.fn().mockResolvedValue(context) };
    const blocks = { assertAllowed: jest.fn().mockRejectedValue(new Error(WALLET_BLOCKED)), recordBlockedVerification: jest.fn().mockResolvedValue(undefined) };
    const addresses = { addUserAddress: jest.fn().mockResolvedValue({ success: true }) };
    const privacy = { assertActive: jest.fn(), choose: jest.fn() };
    const evm = { verify: jest.fn().mockResolvedValue({}) };
    const bitcoin = { verify: jest.fn().mockResolvedValue({ address: 'bc1p-test-proof', context }) };
    const solana = { verify: jest.fn().mockResolvedValue({ address: 'CaseSensitiveSolanaProof', context }) };
    const wallet = new WalletService(nonces as any, addresses as any, { getUser: jest.fn() } as any, { reverifyUser: jest.fn() } as any, blocks as any, bitcoin as any, privacy as any, evm as any, solana as any);
    return { wallet, nonces, blocks, addresses, privacy, evm, bitcoin, solana, context };
}
describe('Signed blocked verification activity', () => {
    it.each(['evm', 'bitcoin', 'solana'] as const)('records a verified %s proof with trusted source and channel before returning the block', async (walletType) => {
        const f = walletFixture();
        await expect(f.wallet.verifySignature({ ...data, walletType, chainId: walletType === 'evm' ? 8453 : undefined }, 'private-signature')).rejects.toThrow(WALLET_BLOCKED);
        const verifier = walletType === 'evm' ? f.evm : walletType === 'bitcoin' ? f.bitcoin : f.solana;
        const expected = walletType === 'evm' ? address : walletType === 'bitcoin' ? 'bc1p-test-proof' : 'CaseSensitiveSolanaProof';
        expect(f.blocks.recordBlockedVerification).toHaveBeenCalledWith({ userId: user, serverId: server, address: expected, walletType, source: 'portal', channelId: 'trusted-channel', ...(walletType === 'evm' ? { chainId: 8453 } : {}) });
        expect(verifier.verify.mock.invocationCallOrder[0]).toBeLessThan(f.blocks.recordBlockedVerification.mock.invocationCallOrder[0]);
        expect(f.addresses.addUserAddress).not.toHaveBeenCalled();
        expect(f.privacy.choose).not.toHaveBeenCalled();
        if (walletType === 'evm')
            expect(f.nonces.consumeNonce).not.toHaveBeenCalled();
    });
    it('records Discord context without trusting client-supplied source fields', async () => {
        const f = walletFixture();
        f.nonces.getActiveNonce.mockResolvedValue({ channelId: 'discord-channel' });
        await expect(f.wallet.verifySignature({ ...data, source: 'portal', channelId: 'spoofed' } as any, 'signature')).rejects.toThrow(WALLET_BLOCKED);
        expect(f.blocks.recordBlockedVerification).toHaveBeenCalledWith(expect.objectContaining({ source: 'discord', channelId: 'discord-channel' }));
    });
    it('does not record an association from an invalid signature', async () => {
        const f = walletFixture();
        f.evm.verify.mockRejectedValue(new Error('Invalid signature'));
        await expect(f.wallet.verifySignature(data, 'bad-signature')).rejects.toThrow('Invalid signature');
        expect(f.blocks.assertAllowed).not.toHaveBeenCalled();
        expect(f.blocks.recordBlockedVerification).not.toHaveBeenCalled();
    });
    it('does not misclassify a restriction lookup outage as a blocked wallet', async () => {
        const f = walletFixture();
        f.blocks.assertAllowed.mockRejectedValue(new Error('Could not check wallet restrictions'));
        await expect(f.wallet.verifySignature(data, 'signature')).rejects.toThrow('Could not check');
        expect(f.blocks.recordBlockedVerification).not.toHaveBeenCalled();
    });
    it.each(['storage', 'context'])('keeps refusing the wallet when audit %s is unavailable', async (failure) => {
        const f = walletFixture();
        if (failure === 'storage')
            f.blocks.recordBlockedVerification.mockRejectedValue(new Error('storage down'));
        else
            f.nonces.getActiveNonce.mockRejectedValue(new Error('expired context'));
        await expect(f.wallet.verifySignature(data, 'signature')).rejects.toThrow(WALLET_BLOCKED);
        expect(f.addresses.addUserAddress).not.toHaveBeenCalled();
        expect(f.nonces.consumeNonce).not.toHaveBeenCalled();
    });
    it('does not record allowed requests as blocked', async () => {
        const f = walletFixture();
        f.blocks.assertAllowed.mockResolvedValue(undefined);
        await f.wallet.verifySignature(data, 'signature');
        expect(f.blocks.recordBlockedVerification).not.toHaveBeenCalled();
        expect(f.addresses.addUserAddress).toHaveBeenCalledTimes(1);
    });
    it('stores only minimal approved fields and preserves Solana address casing', async () => {
        const insert = jest.fn().mockResolvedValue({ error: null });
        const db = { from: jest.fn().mockReturnValue({ insert }) };
        const blocks = new WalletBlockService(db as any);
        const solana = 'So11111111111111111111111111111111111111112';
        await blocks.recordBlockedVerification({ userId: user, serverId: server, address: solana, walletType: 'solana', source: 'discord', nonce: 'never-store', signature: 'never-store' } as any);
        expect(db.from).toHaveBeenCalledWith('verifier_blocked_verification_attempts');
        expect(insert).toHaveBeenCalledWith({ user_id: user, server_id: server, channel_id: null, address: solana, wallet_type: 'solana', source: 'discord', chain_id: null, outcome: 'blocked' });
        insert.mockResolvedValue({ error: { message: 'private database detail' } });
        await expect(blocks.recordBlockedVerification({ userId: user, serverId: server, address, walletType: 'evm', source: 'discord' })).rejects.toThrow('Could not save blocked verification activity');
    });
});
describe('Blocked attempt visibility', () => {
    function fixture(operator: boolean) {
        const items = [{ id: 'attempt', address, wallet_type: 'evm', source: 'discord', outcome: 'blocked', created_at: '2026-11-07T12:00:00Z' }];
        const query: any = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: items, error: null, count: 1 }) };
        const db = { from: jest.fn((table) => table === 'user_wallets' ? { select: () => ({ eq: async () => ({ data: [], error: null }) }) } : query) };
        const args = Array(12).fill({});
        args[0] = db;
        args[2] = { getEarnedRoleAssignments: async () => [] };
        const privacy = { isOperator: () => operator, policy: async () => ({ share_since: null }), visible: () => false };
        const service = new PortalService(...(args as [
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any,
            any
        ]), undefined, privacy as any);
        jest.spyOn(service, 'readAccess').mockResolvedValue({ roles: { cache: new Map() } } as any);
        jest.spyOn(service as any, 'resolveMember').mockResolvedValue({ id: user, displayName: 'Member', user: { username: 'member' }, roles: { cache: new Map() }, displayAvatarURL: () => '' });
        jest.spyOn(service as any, 'removedWallets').mockResolvedValue([]);
        return { service, db, query, items };
    }
    it('shows operators server-scoped attempts without manufacturing a saved wallet', async () => {
        const f = fixture(true);
        const result = await f.service.member({ user: { id: 'operator' } } as any, server, user, false);
        expect(result.wallets).toEqual([]);
        expect(result.blocked_attempts).toEqual({ items: f.items, total: 1 });
        expect(f.query.eq.mock.calls).toEqual([['server_id', server], ['user_id', user]]);
        expect(f.query.gt).toHaveBeenCalledWith('expires_at', expect.any(String));
        expect(f.query.limit).toHaveBeenCalledWith(25);
    });
    it('never queries or returns security associations to an ordinary server admin', async () => {
        const f = fixture(false);
        const result = await f.service.member({ user: { id: 'admin' } } as any, server, user, false);
        expect(result).not.toHaveProperty('blocked_attempts');
        expect(f.db.from).not.toHaveBeenCalledWith('verifier_blocked_verification_attempts');
    });
    it('expires audit events independently of ordinary wallet-removal history', async () => {
        const previous = EnvironmentConfig.IS_TEST;
        Object.defineProperty(EnvironmentConfig, 'IS_TEST', { value: false, configurable: true });
        try {
            const lt = jest.fn().mockResolvedValue({ error: null });
            const db = { rpc: jest.fn().mockResolvedValue({ data: {}, error: null }), from: jest.fn().mockReturnValue({ delete: () => ({ lt }) }) };
            await new PrivacyService(db as any).cleanup();
            expect(db.from).toHaveBeenCalledWith('verifier_blocked_verification_attempts');
            expect(lt).toHaveBeenCalledWith('expires_at', expect.any(String));
        }
        finally {
            Object.defineProperty(EnvironmentConfig, 'IS_TEST', { value: previous, configurable: true });
        }
    });
});
