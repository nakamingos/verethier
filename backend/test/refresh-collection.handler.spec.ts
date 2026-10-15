import { RefreshCollectionHandler } from '../src/services/discord-commands/handlers/refresh-collection.handler';

describe('manual Ordinals metadata refresh', () => {
  let db: any;
  let ordinals: any;
  let interaction: any;
  beforeEach(() => {
    db = { getRoleMappings: jest.fn().mockResolvedValue([{ asset_type: 'ordinal', slug: 'pizza-comrades' }]) };
    ordinals = { refreshCollection: jest.fn().mockResolvedValue({ slug: 'pizza-comrades', count: 3000 }) };
    interaction = { guildId: 'guild', options: { getString: jest.fn().mockReturnValue('pizza-comrades') },
      deferReply: jest.fn(), editReply: jest.fn() };
  });

  it('refreshes a collection configured in the requesting server and reports success privately', async () => {
    await new RefreshCollectionHandler(db, ordinals).handle(interaction);
    expect(db.getRoleMappings).toHaveBeenCalledWith('guild');
    expect(ordinals.refreshCollection).toHaveBeenCalledWith('pizza-comrades');
    expect(interaction.editReply.mock.calls.at(-1)[0].embeds[0].data.title).toContain('Refreshed');
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
  });

  it('does not refresh a collection merely because another server uses it', async () => {
    db.getRoleMappings.mockResolvedValue([{ asset_type: 'ordinal', slug: 'yonder' }]);
    await new RefreshCollectionHandler(db, ordinals).handle(interaction);
    expect(ordinals.refreshCollection).not.toHaveBeenCalled();
    expect(interaction.editReply.mock.calls.at(-1)[0].content).toContain('no Ordinals collection rule');
  });

  it('reports failed refreshes without claiming the saved metadata changed', async () => {
    ordinals.refreshCollection.mockRejectedValue(new Error('Ordinals collection metadata is temporarily unavailable. Please try again.'));
    await new RefreshCollectionHandler(db, ordinals).handle(interaction);
    expect(interaction.editReply.mock.calls.at(-1)[0].content).toContain('unavailable');
  });
});
