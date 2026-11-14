import { Guild } from 'discord.js';

export const OUTSIDE_SERVER = 'Run this command in a server.';

/** Slash commands and buttons that act on a server must run inside one. */
export function requireGuildId(interaction: { guildId: string | null }): string {
  if (!interaction.guildId) throw new Error(OUTSIDE_SERVER);
  return interaction.guildId;
}

export function requireGuild(interaction: { guild: Guild | null }): Guild {
  if (!interaction.guild) throw new Error(OUTSIDE_SERVER);
  return interaction.guild;
}
