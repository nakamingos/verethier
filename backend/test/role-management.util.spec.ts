import { Collection } from 'discord.js';
import { findOrCreateRole } from '../src/services/discord-commands/utils/role-management.util';

describe('Role name handling', () => {
  function interactionFor(roles = []) {
    return {
      guild: {
        roles: {
          cache: new Collection(roles.map(role => [role.id, role])),
          create: jest.fn(options => Promise.resolve({ id: 'created-role', name: options.name, editable: true }))
        },
        members: { me: { roles: { highest: { position: 5 } } } }
      },
      user: { tag: 'admin' }, editReply: jest.fn()
    } as any;
  }

  it.each([
    ['Cosmic Oven-Lord', 'Cosmic Oven-Lord'],
    ['@Cosmic Oven-Lord', 'Cosmic Oven-Lord'],
    ['💡 Create new role: "Cosmic Oven-Lord"', 'Cosmic Oven-Lord'],
    ['💡️ Create new role: "Cosmic Oven-Lord"', 'Cosmic Oven-Lord'],
    ['💡 Create new role: "Cosmic "Oven"-Lord"', 'Cosmic "Oven"-Lord'],
    ['🪐 Cosmic "Oven"-Lord', '🪐 Cosmic "Oven"-Lord'],
    ['Create new role: Cosmic Oven-Lord', 'Create new role: Cosmic Oven-Lord']
  ])('creates the intended name for %s', async (submitted, expected) => {
    const interaction = interactionFor();
    const result = await findOrCreateRole(interaction, submitted);
    expect(interaction.guild.roles.create).toHaveBeenCalledWith(expect.objectContaining({ name: expected }));
    expect(result).toEqual({ role: expect.objectContaining({ name: expected }), wasNewlyCreated: true });
  });

  it.each([true, false])('finds the existing clean role and preserves hierarchy checks (editable: %s)', async editable => {
    const role = { id: 'existing-role', name: 'Cosmic Oven-Lord', editable };
    const interaction = interactionFor([role]);
    const result = await findOrCreateRole(interaction, '💡 Create new role: "Cosmic Oven-Lord"');
    expect(interaction.guild.roles.create).not.toHaveBeenCalled();
    if (editable) {
      expect(result).toEqual({ role, wasNewlyCreated: false });
    } else {
      expect(result).toBeNull();
      expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({
        embeds: [expect.objectContaining({ data: expect.objectContaining({ title: expect.stringContaining('Role Hierarchy Issue') }) })]
      }));
    }
  });
});
