import { SetupHealthService } from '../src/services/setup-health.service';
import { PortalService } from '../src/portal/portal.service';
import { PortalController } from '../src/portal/portal.controller';
import { DiscordService } from '../src/services/discord.service';
import { ForbiddenException } from '@nestjs/common';
import { PermissionFlagsBits } from 'discord.js';

describe('Setup provider probes', () => {
  let service: SetupHealthService,
    data: any,
    nfts: any,
    metadata: any,
    ordinals: any,
    ethscriptions: any;
  beforeEach(() => {
    const probe = () => ({
      checkSetupHealth: jest.fn().mockResolvedValue(undefined),
    });
    data = probe();
    nfts = probe();
    metadata = probe();
    ordinals = probe();
    ethscriptions = probe();
    service = new SetupHealthService(
      data,
      nfts,
      metadata,
      ordinals,
      ethscriptions,
    );
  });
  it('deduplicates network probes while preserving affected rule IDs and checking metadata only when needed', async () => {
    const report = await service.check([
      { id: 1, asset_type: 'nft', chain_id: 1 },
      { id: 2, asset_type: 'erc20', chain_id: 1 },
      {
        id: 3,
        asset_type: 'nft',
        chain_id: 4663,
        attribute_key: 'Color',
        contract_address: '0xcontract',
      },
    ] as any);
    expect(nfts.checkSetupHealth.mock.calls).toEqual([[1], [4663]]);
    expect(metadata.checkSetupHealth).toHaveBeenCalledTimes(1);
    expect(report.find((p) => p.id === 'rpc:1').rule_ids).toEqual([1, 2]);
    expect(report.every((p) => p.status === 'healthy')).toBe(true);
  });
  it('reports a failing provider separately without leaking RPC URLs or credentials', async () => {
    nfts.checkSetupHealth.mockRejectedValue(
      new Error('https://private.example/secret-api-key'),
    );
    const report = await service.check([
      { id: 1, asset_type: 'nft', chain_id: 1 },
      { id: 2, asset_type: 'ethscription' },
    ] as any);
    expect(report.find((p) => p.id === 'rpc:1').status).toBe('unavailable');
    expect(report.find((p) => p.id === 'ethscriptions:data:false').status).toBe(
      'healthy',
    );
    expect(JSON.stringify(report)).not.toMatch(
      /private.example|secret-api-key/,
    );
  });
  it('does not present unchecked Ordinals number inventories as healthy', async () => {
    const report = await service.check([
      {
        id: 1,
        asset_type: 'ordinal',
        inscription_criteria: { kind: 'numbers', ranges: [[1, 100]] },
      },
    ] as any);
    expect(report[0].status).toBe('not_checked');
    expect(ordinals.checkSetupHealth).not.toHaveBeenCalled();
  });
  it('checks the protocol index for specific Ethscriptions rather than the collection database', async () => {
    await service.check([
      {
        id: 1,
        asset_type: 'ethscription',
        inscription_criteria: { kind: 'ids', ids: ['0x' + 'a'.repeat(64)] },
      },
    ] as any);
    expect(ethscriptions.checkSetupHealth).toHaveBeenCalledTimes(1);
    expect(data.checkSetupHealth).not.toHaveBeenCalled();
  });
});

describe('Setup authorization and mutation boundaries', () => {
  it('does not let echoed settings bypass the reviewed admin-channel choice', async () => {
    const service = Object.create(PortalService.prototype) as any;
    service.access = jest.fn().mockResolvedValue({ id: 'server' });
    service.settings = jest.fn().mockResolvedValue({});
    const upsert = jest.fn().mockResolvedValue({ error: null });
    service.db = { from: jest.fn(() => ({ upsert })) };
    await service.saveSettings({ user: { id: 'actor' } }, 'server', {
      background_checks_enabled: false,
      verification_channel_id: null,
      admin_channel_id: 'unreviewed',
    });
    expect(upsert.mock.calls[0][0]).not.toHaveProperty('admin_channel_id');
    expect(upsert.mock.calls[0][0].background_checks_enabled).toBe(false);
  });
  it('requires CSRF/origin validation for all setup probes, previews and confirmations', async () => {
    const session = { user: { id: 'actor' } };
    const auth = {
      session: jest.fn().mockResolvedValue(session),
      assertMutation: jest.fn(() => {
        throw new ForbiddenException();
      }),
    };
    const portal = {
      checkSetup: jest.fn(),
      setupChannels: jest.fn(),
      setupRecovery: jest.fn(),
      setupRequest: jest.fn(),
    };
    const controller = new PortalController(auth as any, portal as any);
    for (const action of [
      () => controller.checkSetup({} as any, 'server'),
      () => controller.setupChannels({} as any, 'server', {} as any),
      () => controller.setupRecovery({} as any, 'server', {} as any),
      () => controller.applySetup({} as any, 'server', 'request'),
    ]) {
      await expect(action()).rejects.toBeInstanceOf(ForbiddenException);
    }
    for (const method of Object.values(portal))
      expect(method).not.toHaveBeenCalled();
  });
  it('checks live admin authorization before exposing a report and again after slow probes', async () => {
    const service = Object.create(PortalService.prototype) as any;
    service.setup = { check: jest.fn().mockResolvedValue({ issues: [] }) };
    service.access = jest
      .fn()
      .mockResolvedValueOnce({ id: 'server' })
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.checkSetup({ user: { id: 'actor' } }, 'server'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.access).toHaveBeenCalledTimes(2);
  });
  it('rejects direct Discord Check Setup clicks after admin permission has been removed', async () => {
    const service = Object.create(DiscordService.prototype) as any;
    service.setupSvc = { check: jest.fn() };
    const interaction = {
      deferReply: jest.fn(),
      editReply: jest.fn(),
      user: { id: 'actor' },
      guild: {
        ownerId: 'owner',
        members: {
          fetch: jest.fn().mockResolvedValue({
            id: 'actor',
            permissions: { has: () => false },
          }),
        },
      },
    };
    await service.handleSetupCheck(interaction);
    expect(service.setupSvc.check).not.toHaveBeenCalled();
    expect(interaction.guild.members.fetch).toHaveBeenCalledWith({
      user: 'actor',
      force: true,
    });
  });
  it('uses live owner/admin checks for the Discord setup report', async () => {
    const service = Object.create(DiscordService.prototype) as any;
    service.setupSvc = {
      check: jest.fn().mockResolvedValue({ issues: [], providers: [] }),
    };
    const interaction = {
      deferReply: jest.fn(),
      editReply: jest.fn(),
      user: { id: 'actor' },
      guild: {
        ownerId: 'owner',
        members: {
          fetch: jest.fn().mockResolvedValue({
            id: 'actor',
            permissions: {
              has: (flag) => flag === PermissionFlagsBits.Administrator,
            },
          }),
        },
      },
    };
    await service.handleSetupCheck(interaction);
    expect(service.setupSvc.check).toHaveBeenCalledTimes(1);
    expect(interaction.guild.members.fetch).toHaveBeenCalledTimes(2);
  });
});
