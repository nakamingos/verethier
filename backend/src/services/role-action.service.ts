import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { Guild, GuildMember } from 'discord.js';

@Injectable()
export class RoleActionService {
  constructor(@Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient) {}

  async blockedBy(member: GuildMember, role: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('verifier_role_actions')
      .select('trigger_role_id')
      .eq('server_id', member.guild.id)
      .contains('remove_role_ids', [role]);
    if (error || !Array.isArray(data))
      throw new Error('Could not check role actions. Try again shortly.');
    return data.some((policy) =>
      member.roles.cache.has(policy.trigger_role_id),
    );
  }

  async enforce(guild: Guild, user: string, trigger: string) {
    const result = { checked: 0, removed: 0, errors: 0 };
    const { data, error } = await this.db
      .from('verifier_role_actions')
      .select('remove_role_ids')
      .eq('server_id', guild.id)
      .eq('trigger_role_id', trigger)
      .maybeSingle();
    if (error) throw new Error('Could not load role action.');
    if (!data) return result;
    let member: GuildMember;
    try {
      member = await guild.members.fetch({ user, force: true });
    } catch (error) {
      if (error?.code === 10007) return result;
      throw error;
    }
    // An excluded trigger must not cascade removals before its own pending
    // action removes it.
    if (await this.blockedBy(member, trigger)) return result;
    await guild.roles.fetch();
    for (const id of data.remove_role_ids) {
      // Fetch current state again after each request; a removed trigger cancels
      // remaining work, and a deleted policy never authorizes new removals.
      const live = await this.db
        .from('verifier_role_actions')
        .select('remove_role_ids')
        .eq('server_id', guild.id)
        .eq('trigger_role_id', trigger)
        .maybeSingle();
      if (live.error) throw new Error('Could not confirm role action.');
      member = await guild.members.fetch({ user, force: true });
      if (
        !member.roles.cache.has(trigger) ||
        !live.data?.remove_role_ids.includes(id)
      )
        continue;
      result.checked++;
      try {
        if (member.roles.cache.has(id)) {
          const role = guild.roles.cache.get(id);
          if (!role?.editable || role.managed || role.id === guild.id)
            throw new Error('Role is not manageable.');
          await member.roles.remove(
            role,
            `Bouncer role action: gained ${trigger}`,
          );
          result.removed++;
        }
        const saved = await this.db
          .from('verifier_user_roles')
          .update({ status: 'revoked', updated_at: new Date().toISOString() })
          .eq('server_id', guild.id)
          .eq('user_id', user)
          .eq('role_id', id);
        if (saved.error) throw new Error('Could not record role action.');
      } catch {
        result.errors++;
      }
    }
    return result;
  }
}
