import { ChannelType, ButtonStyle, MessageFlags } from 'discord.js';
import { VerificationMessageHandler } from '../src/services/discord-commands/handlers/verification-message.handler';
import { DiscordMessageService } from '../src/services/discord-message.service';

describe('Manage verification messages', () => {
  let handler: VerificationMessageHandler;
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
      options: { getChannel: jest.fn().mockReturnValue(channel), getString: jest.fn().mockReturnValue('refresh') },
      deferReply: jest.fn().mockImplementation(async () => { interaction.deferred = true; }),
      editReply: jest.fn(), reply: jest.fn()
    };
    rules = [{ id: 1, asset_type: 'ethscription' }, { id: 2, asset_type: 'nft' }, { id: 3, asset_type: 'ordinal' }];
    db = { getRulesByChannel: jest.fn().mockResolvedValue(rules), addRoleMapping: jest.fn(), deleteRoleMapping: jest.fn() };
    const messages = new DiscordMessageService();
    messages.initialize({ user: { id: 'bot' } } as any);
    handler = new VerificationMessageHandler(db, messages);
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
    interaction.options.getString.mockReturnValue('new');
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

  it('recovers a missing message using all existing channel rules', async () => {
    interaction.options.getString.mockReturnValue('recover');
    channel.messages.fetch.mockResolvedValue(new Map());
    await handler.handle(interaction);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(oldMessage.delete).not.toHaveBeenCalled();
    const feedback = interaction.editReply.mock.calls[0][0].embeds[0].toJSON();
    expect(feedback.title).toContain('Verification Message Recovered');
    expect(feedback.description).toContain('/guild/channel/new-message');
    expect(feedback.fields.find(field => field.name === 'Active Rules').value).toContain('3 rules');
    expect(db.addRoleMapping).not.toHaveBeenCalled();
    expect(db.deleteRoleMapping).not.toHaveBeenCalled();
  });

  it.each(['recent', 'pinned'])('does not recover over an existing %s verification message', async location => {
    interaction.options.getString.mockReturnValue('recover');
    if (location === 'pinned') {
      channel.messages.fetch.mockResolvedValue(new Map());
      channel.messages.fetchPinned.mockResolvedValue(new Map([['old-message', oldMessage]]));
    }
    await handler.handle(interaction);
    expect(channel.send).not.toHaveBeenCalled();
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(oldMessage.delete).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('already has a verification message') });
    expect(interaction.editReply.mock.calls[0][0].content).toContain('action:new');
  });

  it.each(['read', 'pins'])('does not create a recovery message when %s access fails', async stage => {
    interaction.options.getString.mockReturnValue('recover');
    if (stage === 'read') channel.messages.fetch.mockRejectedValue(new Error('Missing permissions'));
    else {
      channel.messages.fetch.mockResolvedValue(new Map());
      channel.messages.fetchPinned.mockRejectedValue(new Error('Missing permissions'));
    }
    await handler.handle(interaction);
    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Missing permissions') });
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

  it.each(['no rules', 'other server', 'voice channel', 'missing channel', 'missing server'])('refuses to modify verification messages for invalid setup (%s)', async kind => {
    if (kind === 'no rules') db.getRulesByChannel.mockResolvedValue([]);
    if (kind === 'other server') channel.guild.id = 'other-guild';
    if (kind === 'voice channel') channel.type = ChannelType.GuildVoice;
    if (kind === 'missing channel') interaction.options.getChannel.mockReturnValue(null);
    if (kind === 'missing server') interaction.guild = null;
    await handler.handle(interaction);
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.any(String) });
  });

  it.each([null, '', 'delete'])('requires a valid action before touching the database or channel (%s)', async action => {
    interaction.options.getString.mockReturnValue(action);
    await handler.handle(interaction);
    expect(db.getRulesByChannel).not.toHaveBeenCalled();
    expect(channel.messages.fetch).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Please select an action') });
  });

  it.each(['new', 'recover'])('requires existing rules before posting with action %s', async action => {
    interaction.options.getString.mockReturnValue(action);
    db.getRulesByChannel.mockResolvedValue([]);
    await handler.handle(interaction);
    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('No verification rules found') });
  });

  it('reports database failures without changing messages', async () => {
    db.getRulesByChannel.mockRejectedValue(new Error('Database unavailable'));
    await handler.handle(interaction);
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Database unavailable') });
  });

  it('reports errors before deferral with a private reply', async () => {
    interaction.deferReply.mockRejectedValue(new Error('Could not defer'));
    await handler.handle(interaction);
    expect(interaction.reply).toHaveBeenCalledWith({ content: expect.stringContaining('Could not defer'), flags: MessageFlags.Ephemeral });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('reports a failed new-message post without altering the original message', async () => {
    interaction.options.getString.mockReturnValue('new');
    channel.send.mockRejectedValue(new Error('Send failed'));
    await handler.handle(interaction);
    expect(oldMessage.edit).not.toHaveBeenCalled();
    expect(oldMessage.delete).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({ content: expect.stringContaining('Send failed') });
  });
});
