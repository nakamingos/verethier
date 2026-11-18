import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { MemberRecheckService, RECHECK_BUTTON, RECHECK_SELECT } from '../src/services/member-recheck.service';

const evmA = '0x' + 'a'.repeat(40);
const evmB = '0x' + 'b'.repeat(40);
const smart = '0x' + 'c'.repeat(40);
const taproot = 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0';
const legacy = '1BoatSLRHtKNngkdXEeobR76b53LETtpyT';
const sol = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';

const rule = (id: number, extra: any) => ({ id, server_id: 'guild', channel_id: 'channel', role_id: `role-${id}`, ...extra });
const ethRule = rule(1, { asset_type: 'erc721', chain_id: 1 });
const baseRule = rule(2, { asset_type: 'erc721', chain_id: 8453 });
const ordinalRule = rule(3, { asset_type: 'ordinal' });
const stampRule = rule(4, { asset_type: 'stamp' });
const solRule = rule(5, { asset_type: 'solana_nft' });

/** Minimal Supabase query builder: resolves the table's rows for any filter chain. */
function supabase(tables: Record<string, any>) {
  return {
    from: jest.fn((table: string) => {
      const query: any = { select: () => query, eq: () => query, in: () => query,
        then: (resolve: any, reject: any) => Promise.resolve(tables[table]).then(resolve, reject) };
      return query;
    }),
  };
}

describe('MemberRecheckService', () => {
  let db: ReturnType<typeof supabase>;
  let verification: any;
  let discord: any;
  let blocks: any;
  let earned: any;
  let ordinals: any;
  let service: MemberRecheckService;
  let wallets: any[];
  let dormant: any[];

  beforeEach(() => {
    wallets = [
      { address: evmA, wallet_type: 'evm', evm_chain_ids: null },
      { address: evmB, wallet_type: 'evm', evm_chain_ids: null },
      { address: smart, wallet_type: 'evm', evm_chain_ids: [8453] },
      { address: taproot, wallet_type: 'bitcoin', evm_chain_ids: null },
      { address: legacy, wallet_type: 'bitcoin', evm_chain_ids: null },
      { address: sol, wallet_type: 'solana', evm_chain_ids: null },
    ];
    dormant = [];
    db = supabase({});
    db.from.mockImplementation((table: string) => {
      const rows = table === 'user_wallets' ? { data: wallets, error: null } : { data: dormant, error: null };
      const query: any = { select: () => query, eq: () => query, in: () => query,
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject) };
      return query;
    });
    verification = {
      getRulesForChannel: jest.fn().mockResolvedValue([ethRule, baseRule, ordinalRule, stampRule, solRule]),
      verifyUserBulk: jest.fn(async (_user: string, _ids: any[], _address: string, _context: any, rules: any[]) => ({
        validRules: rules.slice(0, 1), invalidRules: [], matchingAssetCounts: new Map(), results: [{ ruleId: rules[0].id, rule: rules[0], isValid: true }],
      })),
      finishWalletChecks: jest.fn().mockResolvedValue(undefined),
    };
    discord = {
      addUserRole: jest.fn(async (_user: string, roleId: string) => ({ roleId, roleName: roleId, wasAlreadyAssigned: false, ruleId: null })),
      throwError: jest.fn(),
      verificationSummary: jest.fn().mockResolvedValue('\n\n**🎉 New Roles Assigned:**\nrole-1'),
    };
    blocks = { allowedAddresses: jest.fn(async (_guild: string, addresses: string[]) => addresses.map(a => /^0x|^bc1/i.test(a) ? a.toLowerCase() : a)) };
    earned = { reverifyUserInServer: jest.fn().mockResolvedValue({ verified: 0, revoked: 0, left: 0, errors: 0 }) };
    ordinals = { beginVerification: jest.fn(() => jest.fn()) };
    service = new MemberRecheckService(db as any, {} as any, verification, discord, blocks, earned, ordinals);
  });

  describe('active wallets', () => {
    it('groups saved wallets by family and only counts wallets a rule would read', async () => {
      const active = await service.activeWallets('user', 'guild', [ethRule, ordinalRule, solRule]);
      // The Base-only smart wallet cannot be read by an Ethereum rule, and an
      // Ordinals rule reads Taproot addresses only.
      expect([...active]).toEqual([['evm', [evmA, evmB]], ['bitcoin', [taproot]], ['solana', [sol]]]);
      expect([...(await service.activeWallets('user', 'guild', [baseRule, stampRule]))])
        .toEqual([['evm', [evmA, evmB, smart]], ['bitcoin', [taproot, legacy]]]);
    });

    it('excludes blocked wallets and wallets inactive for the rule network in this server', async () => {
      blocks.allowedAddresses.mockImplementation(async (_g: string, addresses: string[]) => addresses.filter(a => a !== evmB));
      dormant = [{ address: evmA, network: 'ethereum' }, { address: taproot, network: 'bitcoin' }];
      const active = await service.activeWallets('user', 'guild', [ethRule, baseRule, ordinalRule]);
      // evmA is inactive on Ethereum but still active on Base.
      expect([...active]).toEqual([['evm', [evmA, smart]]]);
    });

    it('fails rather than guessing when checking state is unavailable', async () => {
      db.from.mockImplementation(() => {
        const query: any = { select: () => query, eq: () => query, in: () => query,
          then: (resolve: any) => Promise.resolve({ data: null, error: { message: 'down' } }).then(resolve) };
        return query;
      });
      await expect(service.activeWallets('user', 'guild', [ethRule])).rejects.toThrow('unavailable');
    });
  });

  describe('controls', () => {
    it('shows one button when only one family applies, and nothing without saved wallets', async () => {
      const single = await service.controls('user', 'guild', [solRule]);
      expect(single!.rows).toEqual([]);
      expect(single!.button.toJSON()).toMatchObject({ label: 'Re-check Solana wallets', custom_id: RECHECK_BUTTON + 'solana' });
      wallets = [];
      expect(await service.controls('user', 'guild', [solRule])).toBeNull();
    });

    it('adds a family dropdown that preselects the family with the most wallets', async () => {
      const controls = await service.controls('user', 'guild', [ethRule, stampRule, solRule]);
      expect(controls!.button.toJSON()).toMatchObject({ label: 'Re-check saved wallets', custom_id: RECHECK_BUTTON + 'evm' });
      const menu = controls!.rows[0].toJSON().components[0] as any;
      expect(menu.custom_id).toBe(RECHECK_SELECT);
      expect(menu.options.map((o: any) => [o.value, o.description, !!o.default])).toEqual([
        ['evm', '2 saved wallets', true], ['bitcoin', '2 saved wallets', false], ['solana', '1 saved wallet', false],
      ]);
    });
  });

  function message() {
    const link = new ButtonBuilder().setLabel('Verify Now').setURL('https://example.com/verify/x').setStyle(ButtonStyle.Link);
    const check = new ButtonBuilder().setCustomId(RECHECK_BUTTON + 'evm').setLabel('Re-check saved wallets').setStyle(ButtonStyle.Secondary);
    const menu = new StringSelectMenuBuilder().setCustomId(RECHECK_SELECT)
      .addOptions({ label: 'EVM', value: 'evm', default: true }, { label: 'Bitcoin', value: 'bitcoin' });
    const verify = new EmbedBuilder().setTitle('Wallet Verification').setDescription('Verify your wallet by clicking the unique link below. This link is personal and expires <t:1800000000:R>.');
    return { embeds: [verify], components: [new ActionRowBuilder().addComponents(link, check), new ActionRowBuilder().addComponents(menu)] };
  }

  it('keeps the chosen family in the private reply and on the Check button', async () => {
    const interaction: any = { values: ['bitcoin'], message: message(), update: jest.fn(), deferUpdate: jest.fn() };
    await service.handleSelect(interaction);
    const [buttons, select] = interaction.update.mock.calls[0][0].components;
    expect(buttons.components.map((c: any) => c.custom_id ?? c.url)).toEqual(['https://example.com/verify/x', RECHECK_BUTTON + 'bitcoin']);
    expect(select.components[0].options.map((o: any) => [o.value, o.default])).toEqual([['evm', false], ['bitcoin', true]]);

    const bad: any = { values: ['dogecoin'], message: message(), update: jest.fn(), deferUpdate: jest.fn() };
    await service.handleSelect(bad);
    expect(bad.update).not.toHaveBeenCalled();
  });

  describe('check', () => {
    function click(family = 'evm') {
      return { customId: RECHECK_BUTTON + family, guildId: 'guild', channelId: 'channel', guild: { name: 'Test Guild' },
        user: { id: 'user' }, message: message(), reply: jest.fn(), deferUpdate: jest.fn(), editReply: jest.fn() } as any;
    }
    const last = (interaction: any) => { const reply = interaction.editReply.mock.calls.at(-1)[0]; return { ...reply, embeds: reply.embeds.slice(1) }; };

    it('checks one family against active saved wallets and grants roles as the member\'s own check', async () => {
      const interaction = click('evm');
      await service.handleButton(interaction);
      const [, ids, address, context, rules] = verification.verifyUserBulk.mock.calls[0];
      expect(ids).toEqual([1, 2]);
      expect(rules).toEqual([ethRule, baseRule]);
      expect(address).toBe(evmA);
      expect([...context.verificationCheckFamilies]).toEqual(['ethereum', 'robinhood', 'base', 'ethscriptions']);
      expect(discord.addUserRole).toHaveBeenCalledWith('user', 'role-1', 'guild', 'recheck', '1', expect.anything(),
        expect.objectContaining({ memberRecheck: { userId: 'user', guildId: 'guild' } }));
      expect(earned.reverifyUserInServer).toHaveBeenCalledWith('user', 'guild', context);
      expect(verification.finishWalletChecks).toHaveBeenCalledWith(context);
      expect(ordinals.beginVerification).not.toHaveBeenCalled();
      const final = last(interaction);
      // The Verify Now embed and its expiry stay above the result.
      expect(interaction.editReply.mock.calls.at(-1)[0].embeds[0]).toMatchObject({ title: 'Wallet Verification', description: expect.stringContaining('expires <t:1800000000:R>') });
      expect(final.embeds[0].data).toMatchObject({ title: 'Wallet Check Complete' });
      expect(final.embeds[0].data.description).toContain('Checked your saved EVM wallets in Test Guild.');
      expect(final.embeds[0].data.description).toContain('New Roles Assigned');
      // Only the Verify Now link remains.
      expect(final.components).toEqual([expect.objectContaining({ components: [expect.objectContaining({ url: 'https://example.com/verify/x' })] })]);
    });

    it('applies a per-family cooldown, longer for Bitcoin', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z') });
      try {
        await service.handleButton(click('bitcoin'));
        expect(ordinals.beginVerification).toHaveBeenCalledTimes(1);
        const again = click('bitcoin');
        await service.handleButton(again);
        expect(again.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Bitcoin wallets again') }));
        expect(verification.verifyUserBulk).toHaveBeenCalledTimes(1);
        // Another family has its own cooldown.
        await service.handleButton(click('evm'));
        expect(verification.verifyUserBulk).toHaveBeenCalledTimes(2);
        jest.setSystemTime(new Date('2026-11-18T12:10:00Z'));
        const tooSoon = click('bitcoin');
        await service.handleButton(tooSoon);
        expect(tooSoon.reply).toHaveBeenCalled();
        jest.setSystemTime(new Date('2026-11-18T12:15:01Z'));
        await service.handleButton(click('bitcoin'));
        expect(verification.verifyUserBulk).toHaveBeenCalledTimes(3);
      } finally { jest.useRealTimers(); }
    });

    it('explains when there is nothing to check', async () => {
      verification.getRulesForChannel.mockResolvedValue([ethRule]);
      let interaction = click('solana');
      await service.handleButton(interaction);
      expect(last(interaction).embeds[0].data.description).toBe('This channel has no Solana requirements.');

      wallets = wallets.filter(wallet => wallet.wallet_type !== 'evm');
      interaction = click('evm');
      await service.handleButton(interaction);
      expect(last(interaction).embeds[0].data.description).toContain('no active saved EVM wallets');
      expect(verification.verifyUserBulk).not.toHaveBeenCalled();
    });

    it('reports removals, unavailable providers and failures without granting roles', async () => {
      verification.verifyUserBulk.mockResolvedValueOnce({ validRules: [], invalidRules: [], matchingAssetCounts: new Map(), results: [{ ruleId: 1, isValid: false, status: 'failed' }] });
      earned.reverifyUserInServer.mockResolvedValueOnce({ verified: 0, revoked: 1, left: 0, errors: 0 });
      let interaction = click('evm');
      await service.handleButton(interaction);
      expect(last(interaction).embeds[0].data.title).toBe('No Matching Roles');
      expect(last(interaction).embeds[0].data.description).toContain('Removed 1 role you no longer qualify for.');

      verification.verifyUserBulk.mockResolvedValueOnce({ validRules: [], invalidRules: [], matchingAssetCounts: new Map(), results: [{ ruleId: 3, isValid: false, status: 'unavailable' }] });
      interaction = click('solana');
      await service.handleButton(interaction);
      expect(last(interaction).embeds[0].data.title).toBe('Wallet Check Unavailable');

      verification.verifyUserBulk.mockRejectedValueOnce(new Error('provider exploded with secrets'));
      interaction = click('bitcoin');
      await service.handleButton(interaction);
      expect(last(interaction).embeds[0].data.title).toBe('Wallet Check Unavailable');
      expect(last(interaction).embeds[0].data.description).not.toContain('secrets');
      expect(discord.addUserRole).not.toHaveBeenCalled();
      expect(verification.finishWalletChecks).toHaveBeenCalledTimes(3);
    });
  });

  it('ignores malformed button ids', async () => {
    const interaction: any = { customId: RECHECK_BUTTON + 'nope', guildId: 'guild', channelId: 'channel', user: { id: 'user' }, deferUpdate: jest.fn(), reply: jest.fn() };
    await service.handleButton(interaction);
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(verification.getRulesForChannel).not.toHaveBeenCalled();
    expect(ComponentType.Button).toBe(2);
  });
});
