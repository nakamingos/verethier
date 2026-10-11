import { ChatInputCommandInteraction, Role } from 'discord.js';
import { AdminFeedback } from '../../utils/admin-feedback.util';
import { AppLogger } from '@/utils/app-logger.util';

/**
 * Role Management Utilities
 * 
 * Functions for finding, creating, and managing Discord roles
 */

export function normalizeRoleName(roleName: string): string {
  // Accept the old autocomplete label if it is submitted instead of its value.
  const legacySuggestion = /^💡\uFE0F? Create new role: "([\s\S]*)"$/u.exec(roleName);
  const name = legacySuggestion ? legacySuggestion[1] : roleName;
  return name.startsWith('@') ? name.slice(1) : name;
}

/**
 * Finds an existing role or creates a new one
 * @returns Role and metadata if successful, null if there was an error (error already sent to user)
 */
export async function findOrCreateRole(
  interaction: ChatInputCommandInteraction, 
  roleName: string
): Promise<{ role: Role; wasNewlyCreated: boolean } | null> {
  const cleanRoleName = normalizeRoleName(roleName);
  
  // Try to find existing role (including ones we can't manage)
  let role = interaction.guild.roles.cache.find(r => 
    r.name.toLowerCase() === cleanRoleName.toLowerCase()
  );

  // If role exists, check if we can manage it or provide appropriate error
  if (role) {
    if (!role.editable) {
      await interaction.editReply({
        embeds: [AdminFeedback.error(
          'Role Hierarchy Issue',
          `A role named "${cleanRoleName}" already exists but is positioned higher than the bot's role. The bot cannot manage this role.`,
          [
            'Use a different role name',
            'Move the bot\'s role higher in the server settings',
            `Ask an admin to move the "${cleanRoleName}" role below the bot's role`
          ]
        )]
      });
      return null;
    }
    // Role exists and is manageable - we'll use it
    return { role, wasNewlyCreated: false };
  }

  // If role doesn't exist, create it
  // Double-check that no role with this name exists anywhere in the server
  const existingRoleWithName = interaction.guild.roles.cache.find(r => 
    r.name.toLowerCase() === cleanRoleName.toLowerCase()
  );
  
  if (existingRoleWithName) {
    await interaction.editReply({
      embeds: [AdminFeedback.error(
        'Duplicate Role Name',
        `A role named "${cleanRoleName}" already exists in this server.`,
        ['Choose a different name for the new role']
      )]
    });
    return null;
  }

  try {
    // Get bot member to determine role position
    const botMember = interaction.guild.members.me;
    let position = undefined;
    
    if (botMember) {
      // Create role below bot's highest role
      const botHighestPosition = botMember.roles.highest.position;
      position = Math.max(1, botHighestPosition - 1);
    }

    role = await interaction.guild.roles.create({
      name: cleanRoleName,
      color: 'Blue', // Default color
      position: position,
      reason: `Auto-created for verification rule by ${interaction.user.tag}`
    });

    return { role, wasNewlyCreated: true };
  } catch (error) {
    await interaction.editReply({
      embeds: [AdminFeedback.error(
        'Role Creation Failed',
        `Failed to create role "${cleanRoleName}": ${error.message}`,
        ['Try again with a different role name']
      )]
    });
    return null;
  }
}

/**
 * Attempts to clean up a newly created role if no longer needed
 */
export async function cleanupNewlyCreatedRole(
  interaction: any,
  roleId: string,
  serverId: string
): Promise<void> {
  try {
    const role = interaction.guild.roles.cache.get(roleId);
    if (role && role.editable) {
      // Check if role is used by other rules or has members
      // For now, we'll skip the cleanup to avoid accidental deletions
      // This could be enhanced to check for other rule usage
      AppLogger.debug(`Role cleanup skipped for safety: ${role.name}`, 'RoleManagement');
    }
  } catch (error) {
    AppLogger.error('Error during role cleanup:', error, 'RoleManagement');
  }
}
