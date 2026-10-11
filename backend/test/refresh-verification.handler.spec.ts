import { ChannelType, ButtonStyle, MessageFlags } from 'discord.js';
import { RefreshVerificationHandler } from '../src/services/discord-commands/handlers/refresh-verification.handler';
import { DiscordMessageService } from '../src/services/discord-message.service';

describe('Refresh verification messages', () => {
  let handler: RefreshVerificationHandler;
  let channel: any;
  let interaction: any;
  let oldMessage: any;
  let rules: any[];
  let db: any;

  beforeEach(() => {
    oldMessage = {
      id: 'old-message', author: { id: 'bot' }, pinned: true,
      components: [{ type: 1, components: [{ type: 2, customId: 'requestVerification' }] }],
      edit: jest.fn(), delete: jest.fn()
    };
    channel = {
      id: 'channel', guild: { id: 'guild' }, type: ChannelType.GuildText,
      messages: {
        fetch: jest.fn().mockResolvedValue(new Map([['old-message', oldMessage]])),
        fetchPinned: jest.fn().mockResolvedValue(new Map())
      },
      send: jest.fn().mockResolvedValue({ id: 'new-message' })
    };
    interaction = {
      guild: { id: 'guild' }, deferred: false,
      options: { getChannel: jest.fn().mockReturnValue(channel), getBoolean: jest.fn().mockReturnValue(null) },
      deferReply: jest.fn().mockImplementation(async () => { interaction.deferred = true; }),
      editReply: jest.fn(), reply: jest.fn()
    };
    rules = [{ id: 1, asset_type: 'ethscription' }, { id: 2, asset_type: 'nft' }, { id: 3, asset_type: 'ordinal' }];
    db = { getRulesByChannel: jest.fn().mockResolvedValue(rules), addRoleMapping: jest.fn(), deleteRoleMapping: jest.fn() };
    const messages = new DiscordMessageService();
    messages.initialize({ user: { id: 'bot' } } as any);
    handler = new RefreshVerificationHandler(db, messages);
  });

  it('refreshes the original pinned message with the working verification button and all channel rules', async () => {
    await handler.handle(interaction);
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(oldMessage.edit).toHaveBeenCalledTimes(1);
    const edit = oldMessage.edit.mock.calls[0][0];
    expect(edit.content).toBeNull();
    expect(edit.embeds[0].toJSON()).toMatchObject({ title: 'Bouncer · Wallet Verification', color: 0x00FF73 });
    expect(edit.components[0].toJSON().components[0]).toMatchObject({ custom_id: 'requestVerification', style: ButtonStyle.Primary });
    expect(channel.send).not.toHaveBeenCalled();
    expect(oldMessage.delete).not.toHaveBeenCalled();
    expect(oldMessage.pinned).toBe(true);
    expect(db.getRulesByChannel).toHaveBeenCalledWith('guild', 'channel');
    expect(db.addRoleMapping).not.toHaveBeenCalled();
    expect(db.deleteRoleMapping).not.toHaveBeenCalled();
    expect(rules).toEqual([{ id: 1, asset_type: 'ethscription' }, { id: 2, asset_type: 'nft' }, { id: 3, asset_type: 'ordinal' }]);
    const feedback = interaction.editReply.mock.calls[0][0].embeds[0].toJSON();
    expect(feedback.description).toContain('/guild/channel/old-message');
    expect(feedback.fields.find(field => field.name === 'Active Rules').value).toContain('3 rules');
  });

  it('can post a new message while leaving the old one working and untouched', async () => {
    interaction.options.getBoolean.mockReturnValue(true);
    await handler.handle(interaction);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send.mock.calls[0][0].components[0].toJSON().components[0].custom_id).toBe('requestVerification');
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(oldMessage.delete).not.toHaveBeenCalled();
    expect(channel.messages.fetch).not.toHaveBeenCalled();
    expect(interaction.editReply.mock.calls[0][0].embeds[0].data.description).toContain('/guild/channel/new-message');
  });

  it('finds and refreshes an older pinned message outside the recent history', async () => {
    channel.messages.fetch.mockResolvedValue(new Map());
    channel.messages.fetchPinned.mockResolvedValue(new Map([['old-message', oldMessage]]));
    await handler.handle(interaction);
    expect(oldMessage.edit).toHaveBeenCalledTimes(1);
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('refreshes only the newest matching message when several verification messages coexist', async () => {
    const newerMessage = { ...oldMessage, id: 'newer-message', edit: jest.fn(), pinned: false };
    channel.messages.fetch.mockResolvedValue(new Map([['newer-message', newerMessage], ['old-message', oldMessage]]));
    await handler.handle(interaction);
    expect(newerMessage.edit).toHaveBeenCalledTimes(1);
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(oldMessage.delete).not.toHaveBeenCalled();
  });

  it.each(['other author', 'other button', 'missing message'])('does not edit unrelated messages or silently create replacements (%s)', async kind => {
    if (kind === 'other author') oldMessage.author.id = 'other-bot';
    if (kind === 'other button') oldMessage.components[0].components[0].customId = 'other-button';
    if (kind === 'missing message') channel.messages.fetch.mockResolvedValue(new Map());
    await handler.handle(interaction);
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('No verification message found') });
  });

  it.each(['read', 'pins', 'edit'])('reports %s failures without posting a replacement or deleting a message', async stage => {
    const error = new Error('Missing permissions');
    if (stage === 'read') channel.messages.fetch.mockRejectedValue(error);
    if (stage === 'pins') {
      channel.messages.fetch.mockResolvedValue(new Map());
      channel.messages.fetchPinned.mockRejectedValue(error);
    }
    if (stage === 'edit') oldMessage.edit.mockRejectedValue(error);
    await handler.handle(interaction);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Missing permissions') });
    expect(channel.send).not.toHaveBeenCalled();
    expect(oldMessage.delete).not.toHaveBeenCalled();
  });

  it.each(['no rules', 'other server', 'voice channel', 'missing channel'])('refuses to modify verification messages for invalid setup (%s)', async kind => {
    if (kind === 'no rules') db.getRulesByChannel.mockResolvedValue([]);
    if (kind === 'other server') channel.guild.id = 'other-guild';
    if (kind === 'voice channel') channel.type = ChannelType.GuildVoice;
    if (kind === 'missing channel') interaction.options.getChannel.mockReturnValue(null);
    await handler.handle(interaction);
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.any(String) });
  });

  it('reports a failed new-message post without altering the original message', async () => {
    interaction.options.getBoolean.mockReturnValue(true);
    channel.send.mockRejectedValue(new Error('Send failed'));
    await handler.handle(interaction);
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(oldMessage.delete).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Send failed') });
  });
});
