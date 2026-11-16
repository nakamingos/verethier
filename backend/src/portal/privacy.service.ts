import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SupabaseClient } from "@supabase/supabase-js";
import { Interval } from "@nestjs/schedule";
import { EnvironmentConfig } from "@/config/environment.config";

export const PRIVACY_NOTICE = "2026-10-27";
export interface WalletCommunity {
  user_id: string;
  address: string;
  server_id: string;
  source: 'legacy' | 'verification' | 'member';
  enabled: boolean;
  associated_at: string;
  shared_at: string;
  removed_at: string | null;
}
export interface PrivacyChoice {
  epoch: string;
  share: boolean;
  exports: boolean;
  notice: string;
}
export function privacyChoice(value: unknown): PrivacyChoice {
  const v = value as PrivacyChoice;
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some(
      (k) => !["epoch", "share", "exports", "notice"].includes(k),
    ) ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      v.epoch,
    ) ||
    typeof v.share !== "boolean" ||
    typeof v.exports !== "boolean" ||
    v.notice !== PRIVACY_NOTICE
  )
    throw new BadRequestException(
      "Refresh the privacy notice before choosing.",
    );
  return {
    epoch: v.epoch,
    share: v.share,
    exports: v.exports,
    notice: v.notice,
  };
}
export const privacyProof = (v: unknown) => JSON.stringify(privacyChoice(v));

@Injectable()
export class PrivacyService {
  private cleaning = false;
  private readonly logger = new Logger(PrivacyService.name);
  constructor(@Inject("SUPABASE_CLIENT") private readonly db: SupabaseClient) {}
  isOperator(id: string): boolean {
    const ids = (process.env.BOUNCER_OPERATOR_DISCORD_IDS || "")
      .split(/[\s,]+/)
      .filter(Boolean);
    return (
      /^\d{17,22}$/.test(id || "") &&
      ids.length > 0 &&
      ids.every((value) => /^\d{17,22}$/.test(value)) &&
      ids.includes(id)
    );
  }
  requireOperator(id: string) {
    if (!this.isOperator(id))
      throw new ForbiddenException("Bouncer Operator access is required.");
  }
  checked<T extends { data: any; error: any }>(r: T): T["data"] {
    if (r.error)
      throw new ServiceUnavailableException(
        "Privacy controls are temporarily unavailable. Please retry.",
      );
    return r.data;
  }
  async audit(
    actor: string,
    server: string | null,
    operation: string,
    reason?: string,
    details: object = {},
  ) {
    this.requireOperator(actor);
    this.checked(
      await this.db.from("verifier_operator_access").insert({
        actor_id: actor,
        server_id: server,
        operation,
        reason: reason || null,
        details,
      }),
    );
  }
  async server(server: string) {
    this.checked(
      await this.db
        .from("verifier_privacy_servers")
        .upsert(
          { server_id: server },
          { onConflict: "server_id", ignoreDuplicates: true },
        ),
    );
    return this.checked(
      await this.db
        .from("verifier_privacy_servers")
        .select("server_id,sharing_enabled,epoch,updated_at")
        .eq("server_id", server)
        .single(),
    )!; // .single() errors on a missing row, and checked() throws on errors.
  }
  async policy(server: string, user: string) {
    const s = await this.server(server);
    const c = this.checked(
      await this.db
        .from("verifier_privacy_choices")
        .select("epoch,share_since,export_since,updated_at")
        .eq("server_id", server)
        .eq("user_id", user)
        .maybeSingle(),
    );
    const current = c && c.epoch === s.epoch ? c : null;
    return {
      ...s,
      notice: PRIVACY_NOTICE,
      has_saved_choice: !!c,
      share_since: current && s.sharing_enabled ? current.share_since : null,
      export_since: current ? current.export_since : null,
    };
  }
  async choose(server: string, user: string, value: unknown) {
    const v = privacyChoice(value);
    await this.assertActive(user);
    const r = await this.db.rpc("verifier_privacy_choose", {
      p_server: server,
      p_user: user,
      p_epoch: v.epoch,
      p_share: v.share,
      p_export: v.exports,
      p_notice: v.notice,
    });
    if (r.error)
      throw new ConflictException(
        "Privacy settings changed. Refresh and choose again.",
      );
    return this.policy(server, user);
  }
  async configure(server: string, actor: string, enabled: boolean) {
    if (typeof enabled !== "boolean")
      throw new BadRequestException(
        "Choose whether community sharing is enabled.",
      );
    return this.checked(
      await this.db.rpc("verifier_privacy_server", {
        p_server: server,
        p_actor: actor,
        p_enabled: enabled,
      }),
    );
  }
  visible(since: string | null, time: string | null) {
    return (
      !!since &&
      !!time &&
      Number.isFinite(Date.parse(time)) &&
      Date.parse(time) >= Date.parse(since)
    );
  }
  async walletCommunities(user: string, server?: string): Promise<WalletCommunity[]> {
    const rows: WalletCommunity[] = [];
    for (let offset = 0; ; offset += 1000) {
      let query = this.db.from('verifier_wallet_communities')
        .select('user_id,address,server_id,source,enabled,associated_at,shared_at,removed_at')
        .eq('user_id', user);
      if (server) query = query.eq('server_id', server);
      const batch = this.checked(await query.order('address').order('server_id').range(offset, offset + 999)) as WalletCommunity[];
      if (!Array.isArray(batch)) throw new ServiceUnavailableException('Privacy controls are temporarily unavailable. Please retry.');
      rows.push(...batch);
      if (batch.length < 1000) return rows;
    }
  }
  communityAllows(row: WalletCommunity | undefined, time?: string, eventServer?: string | null): boolean {
    if (!row?.enabled) return false;
    if (!time) return !row.removed_at;
    const at = Date.parse(time);
    return Number.isFinite(at) &&
      (row.source === 'legacy' || (at >= Date.parse(row.associated_at) && (!eventServer || eventServer === row.server_id))) &&
      (!row.removed_at || at <= Date.parse(row.removed_at));
  }
  async walletNoticeAllowed(server: string, user: string, event: string): Promise<boolean> {
    if (!event) return false;
    const action = this.checked(await this.db.from('verifier_member_actions')
      .select('address,server_id,created_at,kind').eq('id', event).eq('user_id', user).maybeSingle());
    if (!action) return false;
    const scopes = await this.walletCommunities(user, server);
    const scope = scopes.find(row=>row.address===action.address);
    return this.communityAllows(scope, action.created_at, action.server_id);
  }
  async setWalletCommunity(user: string, server: string, address: string, enabled: boolean, request: string) {
    await this.assertActive(user);
    return this.checked(await this.db.rpc('verifier_member_wallet_community', {
      p_user: user, p_address: address, p_server: server, p_enabled: enabled, p_request: request,
    }));
  }
  async assertActive(user: string) {
    const rows = this.checked(
      await this.db
        .from("verifier_privacy_deletions")
        .select("id")
        .eq("user_id", user)
        .eq("status", "processing")
        .limit(1),
    ) ?? [];
    if (rows.length)
      throw new ConflictException(
        "Account deletion is in progress. Contact nomorelabs@gmail.com before linking or verifying again.",
      );
  }
  async queueGrantRecheck(user: string, server: string, role: string) {
    this.checked(
      await this.db.rpc("verifier_privacy_recheck_grant", {
        p_user: user,
        p_server: server,
        p_role: role,
      }),
    );
  }
  async walletMatches(server: string, address: string) {
    return this.checked(
      await this.db.rpc("verifier_privacy_wallet_matches", {
        p_server: server,
        p_address: address,
      }),
    );
  }
  async deletions(user?: string) {
    let q = this.db
      .from("verifier_privacy_deletions")
      .select("id,user_id,status,created_at,reviewed_at,outcome,completed_at")
      .limit(100);
    if (user)
      q = q.eq("user_id", user).order("created_at", { ascending: false });
    else
      q = q
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: true });
    return this.checked(await q);
  }
  async requestDeletion(user: string, id: string) {
    const existing = this.checked(
      await this.db
        .from("verifier_privacy_deletions")
        .select("id,status")
        .eq("user_id", user)
        .in("status", ["pending", "processing"])
        .limit(1),
    ) ?? [];
    if (existing.length) return existing[0];
    return this.checked(
      await this.db
        .from("verifier_privacy_deletions")
        .insert({ id, user_id: user })
        .select("id,status")
        .single(),
    );
  }
  async review(
    actor: string,
    request: string,
    approve: boolean,
    outcome: string,
  ) {
    this.requireOperator(actor);
    if (
      typeof approve !== "boolean" ||
      typeof outcome !== "string" ||
      !outcome.trim() ||
      outcome.length > 500
    )
      throw new BadRequestException(
        "Explain the deletion review outcome (up to 500 characters).",
      );
    await this.audit(actor, null, "deletion_review", outcome, {
      request,
      approve,
    });
    return this.checked(
      await this.db.rpc("verifier_privacy_review", {
        p_request: request,
        p_actor: actor,
        p_approve: approve,
        p_outcome: outcome.trim(),
      }),
    );
  }
  @Interval(3600000)
  async cleanup() {
    if (this.cleaning || EnvironmentConfig.IS_TEST) return;
    this.cleaning = true;
    try {
      this.checked(
        await this.db.rpc("verifier_privacy_cleanup", {
          p_grace_seconds: Math.max(
            900,
            Math.ceil(EnvironmentConfig.NONCE_EXPIRY / 1000) + 60,
          ),
        }),
      );
      this.checked(
        await this.db.from('verifier_blocked_verification_attempts')
          .delete().lt('expires_at', new Date().toISOString()),
      );
    } catch {
      this.logger.error(
        "Scheduled privacy cleanup failed; retained records will be retried on the next run.",
      );
    } finally {
      this.cleaning = false;
    }
  }
}
