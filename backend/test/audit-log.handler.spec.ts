import { PermissionFlagsBits } from 'discord.js';
import { AuditLogHandler } from '../src/services/discord-commands/handlers/audit-log.handler';

const address = '0x' + '1'.repeat(40);
const bitcoin = 'bc1p' + 'q'.repeat(58);
const listId = '123456789012345678';

describe('Audit log pagination', () => {
  let handler: AuditLogHandler;
  let db: any;
  function command(id = listId, days = 1): any {
    return { id, guildId: 'guild', guild: { name: 'NoMoreLabs' }, user: { id: 'admin' },
      options: { getInteger: jest.fn(() => days) }, deferReply: jest.fn(), editReply: jest.fn() };
  }
  function button(customId: string, overrides = {}): any {
    return { customId, guildId: 'guild', user: { id: 'admin' }, memberPermissions: { has: jest.fn(() => true) },
      reply: jest.fn(), update: jest.fn(), ...overrides };
  }
  function entry(id: number, extra = {}): any {
    return { id, user_name: `User${id}`, role_name: `Role${id}`, status: 'active',
      created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
      user_wallets: [{ address }], ...extra };
  }
  const buttons = (payload: any) => payload.components[0].toJSON().components;
  const embed = (payload: any) => payload.embeds[0].toJSON();

  beforeEach(() => {
    db = { getServerAuditLog: jest.fn() };
    handler = new AuditLogHandler(db);
  });
  afterEach(() => jest.useRealTimers());

  it('shows complete entries with Next/Previous, correct ranges, and disabled edge buttons', async () => {
    db.getServerAuditLog.mockResolvedValue(Array.from({ length: 25 }, (_, index) => entry(index + 1)));
    const interaction = command();
    await handler.handle(interaction);
    const first = interaction.editReply.mock.calls[0][0];
    expect(embed(first).title).toBe('Role Assignment Audit Log (Page 1/2)');
    expect(embed(first).description).toContain('User20');
    expect(embed(first).description).not.toContain('User21');
    expect(embed(first).footer.text).toContain('Showing 1–20 of 25');
    expect(buttons(first).map(item => item.disabled)).toEqual([true, false]);
    const next = button(buttons(first)[1].custom_id);
    await handler.handlePaginationButton(next);
    const second = next.update.mock.calls[0][0];
    expect(embed(second).title).toBe('Role Assignment Audit Log (Page 2/2)');
    expect(embed(second).footer.text).toContain('Showing 21–25 of 25');
    expect(buttons(second).map(item => item.disabled)).toEqual([false, true]);
    const previous = button(buttons(second)[0].custom_id);
    await handler.handlePaginationButton(previous);
    expect(embed(previous.update.mock.calls[0][0]).description).toBe(embed(first).description);
    expect(db.getServerAuditLog).toHaveBeenCalledTimes(1);
  });

  it('pages by character limits without dropping rows or splitting wallet links', async () => {
    db.getServerAuditLog.mockResolvedValue(Array.from({ length: 75 }, (_, index) => entry(index + 1, {
      user_name: `User${index + 1} ` + '_'.repeat(85), role_name: '*'.repeat(100),
      user_wallets: [{ address: bitcoin }],
    })));
    const interaction = command();
    await handler.handle(interaction);
    let payload = interaction.editReply.mock.calls[0][0];
    const seen: number[] = [];
    let pages = 0;
    for (;;) {
      const data = embed(payload);
      expect(data.description.length).toBeLessThanOrEqual(4096);
      expect(data.title.length + data.description.length + data.footer.text.length
        + data.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0)).toBeLessThanOrEqual(6000);
      expect(data.description).not.toContain('(truncated)');
      const ids = [...data.description.matchAll(/User(\d+)/g)].map(match => Number(match[1]));
      seen.push(...ids);
      expect(data.description.split(`](https://mempool.space/address/${bitcoin})`).length - 1).toBe(ids.length);
      pages++;
      const next = buttons(payload)[1];
      if (next.disabled) break;
      const click = button(next.custom_id);
      await handler.handlePaginationButton(click);
      payload = click.update.mock.calls[0][0];
    }
    expect(pages).toBeGreaterThan(4);
    expect(seen).toEqual(Array.from({ length: 75 }, (_, index) => index + 1));
  });

  it('keeps independently opened logs and time ranges separate', async () => {
    db.getServerAuditLog.mockResolvedValueOnce(Array.from({ length: 21 }, (_, index) => entry(index + 1)))
      .mockResolvedValueOnce([entry(99)]);
    await handler.handle(command());
    await handler.handle(command('223456789012345678', 7));
    const first = button(`audit-log-next-0-${listId}`);
    await handler.handlePaginationButton(first);
    expect(embed(first.update.mock.calls[0][0]).footer.text).toContain('Showing 21–21 of 21 entries │ Period: Last 1 day');
    const second = button('audit-log-next-0-223456789012345678');
    await handler.handlePaginationButton(second);
    expect(embed(second.update.mock.calls[0][0]).footer.text).toContain('Showing 1–1 of 1 entries │ Period: Last 7 days');
    expect(embed(second.update.mock.calls[0][0]).description).toContain('User99');
  });

  it.each([
    { user: { id: 'another-admin' } },
    { guildId: 'another-guild' },
    { memberPermissions: { has: () => false } },
  ])('restricts cached results to their administrator and server: %s', async overrides => {
    db.getServerAuditLog.mockResolvedValue([entry(1)]);
    await handler.handle(command());
    const click = button(`audit-log-next-0-${listId}`, overrides);
    await handler.handlePaginationButton(click);
    expect(click.update).not.toHaveBeenCalled();
    expect(click.reply).toHaveBeenCalledWith(expect.objectContaining({ flags: 64 }));
  });

  it('expires views after five minutes with a useful rerun message', async () => {
    jest.useFakeTimers();
    db.getServerAuditLog.mockResolvedValue([entry(1)]);
    await handler.handle(command());
    jest.advanceTimersByTime(5 * 60 * 1000);
    const click = button(`audit-log-next-0-${listId}`);
    await handler.handlePaginationButton(click);
    expect(click.update).not.toHaveBeenCalled();
    expect(click.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/setup audit-log') }));
  });

  it('handles malformed button IDs without exposing cached entries', async () => {
    const click = button('audit-log-next-not-a-page');
    await handler.handlePaginationButton(click);
    expect(click.update).not.toHaveBeenCalled();
    expect(click.reply).toHaveBeenCalled();
    expect(click.memberPermissions.has).toHaveBeenCalledWith(PermissionFlagsBits.Administrator);
  });

  it('preserves rows with missing wallets or invalid dates and shows expired status', async () => {
    db.getServerAuditLog.mockResolvedValue([entry(1, { user_wallets: [], created_at: 'bad', updated_at: 'bad', status: 'expired' }),
      entry(2, { user_wallets: [{ address: 'invalid](@everyone)' }], role_name: 'Role\n@everyone' })]);
    const interaction = command();
    await handler.handle(interaction);
    const payload = interaction.editReply.mock.calls[0][0];
    expect(embed(payload).description).toContain('⌛│User1');
    expect(embed(payload).description).toContain('Unknown time');
    expect(embed(payload).description).toContain('User2');
    expect(embed(payload).description).not.toContain('invalid]');
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });

  it('shows an empty state with no navigation', async () => {
    db.getServerAuditLog.mockResolvedValue([]);
    const interaction = command();
    await handler.handle(interaction);
    expect(interaction.editReply.mock.calls[0][0].components).toEqual([]);
    expect(embed(interaction.editReply.mock.calls[0][0]).description).toContain('No activity found');
  });

  it.each([0, 31, 1.5])('rejects invalid periods before reading data: %s', async days => {
    const interaction = command(listId, days);
    await handler.handle(interaction);
    expect(db.getServerAuditLog).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalled();
  });

  it('returns a useful error for a failed database read', async () => {
    db.getServerAuditLog.mockRejectedValue(new Error('database unavailable'));
    const interaction = command();
    await handler.handle(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('Failed to retrieve') }));
  });
});
