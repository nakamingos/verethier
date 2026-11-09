import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RoleActionService } from '@/services/role-action.service';
import { Interval } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { NftCheckContext } from '@/services/nft-ownership.service';
import { DynamicRoleService } from '@/services/dynamic-role.service';
import { DiscordService } from '@/services/discord.service';
import { EnvironmentConfig } from '@/config/environment.config';

@Injectable()
export class PortalJobsService {
  private running = false;
  private readonly worker = randomUUID();
  constructor(
    @Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient,
    private readonly roles: DynamicRoleService,
    private readonly discord: DiscordService,
    @Optional() private readonly roleActions?: RoleActionService,
  ) {}
  @Interval(10000)
  async run() {
    if (
      this.running ||
      EnvironmentConfig.IS_TEST ||
      !this.discord.getBotClient()
    )
      return;
    this.running = true;
    let job: any;
    let heartbeat: ReturnType<typeof setInterval>;
    try {
      const claimed = await this.db.rpc('verifier_portal_claim_job', {
        p_worker: this.worker,
      });
      if (claimed.error) throw new Error('claim');
      job = claimed.data?.[0];
      if (!job) return;
      heartbeat = setInterval(() => {
        void this.db
          .from('verifier_reconciliation_jobs')
          .update({
            locked_until: new Date(Date.now() + 15 * 60000).toISOString(),
          })
          .eq('id', job.id)
          .eq('locked_by', this.worker)
          .eq('status', 'running')
          .then((result) => {
            if (result.error) Logger.warn('Portal job lease renewal failed.');
          });
      }, 30000);
      let roleActionTargets: string[] | undefined;
      // Old role-action receipts queued broad member rechecks. Derive the
      // affected targets at dispatch time so already queued jobs are narrowed too.
      if (job.action_id && job.user_id && !job.role_action_role_id) {
        const action = await this.db.from('verifier_portal_actions')
          .select('kind, before_rule, after_rule').eq('id', job.action_id).eq('server_id', job.server_id).maybeSingle();
        if (action.error || !action.data) throw new Error('action');
        if (['role_action_set', 'role_action_delete'].includes(action.data.kind)) {
          const snapshots = [action.data.before_rule, action.data.after_rule].filter(Boolean);
          if (!snapshots.length || snapshots.some(snapshot => !Array.isArray(snapshot.remove_role_ids)
            || snapshot.remove_role_ids.some(id => typeof id !== 'string' || !/^\d{17,22}$/.test(id)))) throw new Error('role action scope');
          roleActionTargets = [...new Set<string>(snapshots.flatMap(snapshot => snapshot.remove_role_ids))];
        }
      }
      let ruleSave = job.ordinal_provider_policy === 'ordnet-only';
      // Existing rule-save jobs also receive the policy without rewriting their rows.
      if (!ruleSave && job.action_id && job.role_id && !job.user_id && !job.role_action_role_id) {
        const action = await this.db.from('verifier_portal_actions').select('kind').eq('id', job.action_id).eq('server_id', job.server_id).maybeSingle();
        if (action.error) throw new Error('action');
        ruleSave = ['create', 'edit', 'delete', 'reverse'].includes(action.data?.kind);
      }
      const context: NftCheckContext = ruleSave
        ? { checks: new Map(), ordinalMode: 'scheduled', ordinalProviderPolicy: 'ordnet-only' } : undefined;
      const result = job.role_action_role_id
        ? await this.roleActions.enforce(
            await this.discord.getBotClient().guilds.fetch(job.server_id),
            job.user_id,
            job.role_action_role_id,
          )
        : job.rule_id && Array.isArray(job.member_ids)
          ? await this.roles.reverifyRoleChangeInServer(
              job.server_id,
              job.role_id,
              String(job.rule_id),
              job.member_ids,
              ...(context ? [context] : []),
            )
          : job.user_id
            ? roleActionTargets !== undefined
              ? await this.roles.reverifyUserRolesInServer(job.user_id, job.server_id, roleActionTargets)
              : await this.roles.reverifyUserInServer(job.user_id, job.server_id)
            : await this.roles.reverifyRoleInServer(job.server_id, job.role_id, ...(context ? [context] : []));
      const status = result.errors
        ? job.attempts < 3
          ? 'pending'
          : 'failed'
        : 'completed';
      const saved = await this.db
        .from('verifier_reconciliation_jobs')
        .update({
          status,
          result,
          locked_by: null,
          locked_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('locked_by', this.worker);
      if (saved.error) throw new Error('save');
    } catch {
      Logger.warn(
        'Portal reconciliation job could not finish; it will be retried.',
      );
      if (job)
        await this.db
          .from('verifier_reconciliation_jobs')
          .update({
            status: job.attempts < 3 ? 'pending' : 'failed',
            locked_by: null,
            locked_until: null,
            result: {
              error: 'Role check unavailable. Retry from Member Lookup.',
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('locked_by', this.worker);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.running = false;
    }
  }
  @Interval(3600000)
  async cleanSessions() {
    if (EnvironmentConfig.IS_TEST) return;
    for (const table of ['verifier_oauth_states', 'verifier_web_sessions']) {
      const { error } = await this.db
        .from(table)
        .delete()
        .lt('expires_at', new Date().toISOString());
      if (error) Logger.warn('Expired portal sessions could not be cleared.');
    }
  }
}
