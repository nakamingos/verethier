import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { SupabaseClient } from '@supabase/supabase-js';
import { ChannelType, Client, PermissionFlagsBits } from 'discord.js';
import { randomUUID } from 'crypto';
import { EnvironmentConfig } from '@/config/environment.config';
import { PrivacyService } from '@/portal/privacy.service';
import { BouncerLogKind, BouncerLogReason, BouncerLogSource } from '@/models/bouncer-log.interface';

@Injectable()
export class BouncerLogService {
  private client: Client | null = null;
  private running = false;
  private readonly worker = randomUUID();
  constructor(
    @Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient,
    private readonly privacy: PrivacyService,
  ) {}
  initialize(client: Client) { this.client = client; }

  // Logging cannot change the result of a verification or Discord role update.
  async record(server: string, user: string, kind: BouncerLogKind,
    source: BouncerLogSource, role?: string, reason?: BouncerLogReason) {
    try {
      const { error } = await this.db.rpc('verifier_enqueue_bouncer_log', {
        p_server: server, p_user: user, p_kind: kind, p_source: source,
        p_role: role || null, p_reason: reason || null,
      });
      if (error) throw new Error('enqueue');
    } catch { Logger.warn('Bouncer channel activity could not be queued.'); }
  }

  @Interval(10000)
  async run() {
    if (EnvironmentConfig.IS_TEST || this.running) return;
    this.running = true;
    try {
      const expired = await this.db.from('verifier_bouncer_log_queue').delete().lt('expires_at', new Date().toISOString());
      if (expired.error) throw new Error('cleanup');
      if (!this.client?.isReady()) return;
      for (let i = 0; i < 5; i++) {
        const claimed = await this.db.rpc('verifier_claim_bouncer_log', { p_worker: this.worker });
        if (claimed.error) throw new Error('claim');
        const job = claimed.data?.[0];
        if (!job) break;
        await this.process(job);
      }
    } catch { Logger.warn('Bouncer channel activity delivery is unavailable; queued events will be retried.'); }
    finally { this.running = false; }
  }

  private async process(job: any) {
    const heartbeat = setInterval(() => {
      void this.db.from('verifier_bouncer_log_queue')
        .update({ locked_until: new Date(Date.now() + 120000).toISOString() })
        .eq('id', job.id).eq('locked_by', this.worker)
        .then(result => { if (result.error) Logger.warn('Bouncer log lease could not be renewed.'); });
    }, 30000);
    try {
      await this.deliver(job);
      const done = await this.db.from('verifier_bouncer_log_queue').delete().eq('id', job.id).eq('locked_by', this.worker);
      if (done.error) throw new Error('finish');
    } catch {
      const retry = await this.db.from('verifier_bouncer_log_queue').update({
        locked_by: null, locked_until: null,
        available_at: new Date(Date.now() + Math.min(900, 15 * 2 ** Math.min(job.attempts, 6)) * 1000).toISOString(),
      }).eq('id', job.id).eq('locked_by', this.worker);
      if (retry.error) Logger.warn('Bouncer channel activity retry could not be scheduled.');
      Logger.warn('A Bouncer channel activity message could not be delivered; it remains queued for retry.');
    } finally { clearInterval(heartbeat); }
  }

  private async deliver(job: any) {
    const { data: settings, error } = await this.db.from('verifier_server_settings')
      .select('log_channel_id,log_events,log_version').eq('server_id', job.server_id).maybeSingle();
    if (error) throw new Error('settings');
    if (!settings || settings.log_version !== job.config_version || settings.log_channel_id !== job.channel_id
      || !settings.log_events?.includes(job.kind) || Date.parse(job.expires_at) <= Date.now()) return;
    const guild = this.client?.guilds.cache.get(job.server_id);
    if (!guild) throw new Error('guild');
    try { await guild.members.fetch({ user: job.user_id, force: true }); }
    catch (error) { if (error?.code === 10007) return; throw error; }
    try { await this.privacy.assertActive(job.user_id); }
    catch (error) { if (error?.getStatus?.() === 409) return; throw error; }
    if (job.kind === 'wallet_added' || job.kind === 'wallet_removed') {
      const policy = await this.privacy.policy(job.server_id, job.user_id);
      if (!this.privacy.visible(policy.share_since, job.occurred_at)) return;
    }
    const channel = await guild.channels.fetch(job.channel_id);
    if (!channel || channel.type !== ChannelType.GuildText || channel.guild.id !== guild.id) throw new Error('channel');
    const bot = await guild.members.fetchMe();
    if (!channel.permissionsFor(bot)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) throw new Error('permissions');
    const content = this.message(job);
    // Discord checks recent nonces to reduce duplicates after an interrupted send.
    const nonce = BigInt('0x' + job.id.replace(/-/g, '').slice(0, 20)).toString();
    await channel.send({ content, allowedMentions: { parse: [] }, nonce, enforceNonce: true });
  }

  private message(job: any): string {
    const user = `<@${job.user_id}>`, role = `<@&${job.role_id}>`;
    const source = job.source === 'portal' ? 'the member portal' : 'Discord';
    const reasons = {
      no_assets: 'No qualifying holdings were found.',
      provider_unavailable: 'An ownership provider is temporarily unavailable.',
      requirements_changed: 'No verification rules are configured for this request.',
      verification_failed: 'The verification could not be completed.',
    };
    const messages: Record<BouncerLogKind, string> = {
      verification_success: `✅ ${user} verified through ${source}.`,
      verification_failed: `⚠️ ${user}’s verification failed: ${reasons[job.reason] || reasons.verification_failed}`,
      verification_blocked: `🚫 ${user}’s verification was refused because a wallet is blocked in this server.`,
      wallet_added: `➕ ${user} added a saved wallet through ${source}.`,
      wallet_removed: `➖ ${user} no longer has a previously saved wallet linked to their account.`,
      role_added: `🔓 ${user} was granted ${role} by Bouncer.`,
      role_removed: `🔒 ${user} had ${role} removed by Bouncer.`,
    };
    const text = messages[job.kind];
    if (!text) throw new Error('event');
    return `${text} · <t:${Math.floor(Date.parse(job.occurred_at) / 1000)}:f>`;
  }
}
