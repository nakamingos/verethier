import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { RoleActionService } from '@/services/role-action.service';
import { Interval } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
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
            )
          : job.user_id
            ? await this.roles.reverifyUserInServer(job.user_id, job.server_id)
            : await this.roles.reverifyRoleInServer(job.server_id, job.role_id);
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
