import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "crypto";
import { isDeepStrictEqual } from "util";
import { PortalService } from "./portal.service";
import { PrivacyService } from "./privacy.service";
import { PortalSession } from "./portal-auth.service";
import { WalletExportDto } from "./privacy.dto";
import { DbService } from "@/services/db.service";
import { VerificationEngine } from "@/services/verification-engine.service";
import { AssetOwnershipService } from "@/services/asset-ownership.service";
import { NftCheckContext } from "@/services/nft-ownership.service";
import { ruleEditVersion } from "@/utils/rule-edit.util";
import { EnvironmentConfig } from "@/config/environment.config";

export const csvCell = (v: unknown) =>
  '"' +
  String(v ?? "")
    .replace(/^[\s]*[=+@-]/, (m) => "'" + m)
    .replace(/"/g, '""') +
  '"';
export function latestWallets<
  T extends {
    user_id: string;
    network: string;
    address: string;
    proof_at: string;
  },
>(rows: T[]) {
  const map = new Map<string, T>();
  for (const r of rows) {
    const key = r.user_id + "|" + r.network,
      old = map.get(key);
    if (
      !old ||
      Date.parse(r.proof_at) > Date.parse(old.proof_at) ||
      (r.proof_at === old.proof_at && r.address < old.address)
    )
      map.set(key, r);
  }
  return [...map.values()];
}
@Injectable()
export class WalletExportService {
  private working = false;
  private readonly worker = randomUUID();
  constructor(
    @Inject("SUPABASE_CLIENT") private readonly db: SupabaseClient,
    private readonly portal: PortalService,
    private readonly privacy: PrivacyService,
    private readonly rules: DbService,
    private readonly engine: VerificationEngine,
    private readonly ownership: AssetOwnershipService,
  ) {}
  private session(actor: string): PortalSession {
    return {
      user: { id: actor, name: "", avatar: null },
      guilds: [],
      csrf: "",
      hash: "",
    };
  }
  private async authorize(
    session: PortalSession,
    server: string,
    override: boolean,
    reason?: string,
  ) {
    if (override) {
      this.privacy.requireOperator(session.user.id);
      if (!reason?.trim())
        throw new BadRequestException(
          "Give a reason for the operator export override.",
        );
      return this.portal.readAccess(
        session,
        server,
        "export_override_authorization",
      );
    }
    return this.portal.access(session, server);
  }
  async start(session: PortalSession, server: string, dto: WalletExportDto) {
    await this.authorize(session, server, !!dto.operator_override, dto.reason);
    if (
      (dto.family === "bitcoin" &&
        ["ethereum", "robinhood"].includes(dto.network)) ||
      (dto.family === "evm" && dto.network === "bitcoin")
    )
      throw new BadRequestException(
        "Choose a compatible wallet family and blockchain.",
      );
    if (dto.operator_override)
      await this.privacy.audit(
        session.user.id,
        server,
        "export_override_requested",
        dto.reason,
        { request: dto.request_id },
      );
    const { request_id, ...filters } = dto;
    const existing = this.privacy.checked(
      await this.db
        .from("verifier_wallet_exports")
        .select("*")
        .eq("id", request_id)
        .maybeSingle(),
    );
    if (existing) {
      if (
        existing.actor_id !== session.user.id ||
        existing.server_id !== server ||
        !isDeepStrictEqual(
          existing.filters,
          JSON.parse(JSON.stringify(filters)),
        )
      )
        throw new ConflictException("Export request ID already used.");
      return this.publicJob(existing);
    }
    return this.publicJob(
      this.privacy.checked(
        await this.db
          .from("verifier_wallet_exports")
          .insert({
            id: request_id,
            server_id: server,
            actor_id: session.user.id,
            filters,
            operator_override: !!dto.operator_override,
            reason: dto.reason?.trim() || null,
          })
          .select("*")
          .single(),
      ),
    );
  }
  private publicJob(job: any) {
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      total: job.total,
      created_at: job.created_at,
      checked_at: job.checked_at,
      expires_at: job.expires_at,
      error: job.error,
      count: job.status === "completed" ? job.result?.rows?.length : undefined,
      before_dedup:
        job.status === "completed" ? job.result?.before_dedup : undefined,
      operator_override: job.operator_override,
    };
  }
  private async job(session: PortalSession, server: string, id: string) {
    const job = this.privacy.checked(
      await this.db
        .from("verifier_wallet_exports")
        .select("*")
        .eq("id", id)
        .eq("server_id", server)
        .eq("actor_id", session.user.id)
        .maybeSingle(),
    );
    if (!job) throw new NotFoundException("Export not found.");
    await this.authorize(session, server, job.operator_override, job.reason);
    return job;
  }
  async status(session: PortalSession, server: string, id: string) {
    return this.publicJob(await this.job(session, server, id));
  }
  async retry(session: PortalSession, server: string, id: string) {
    const job = await this.job(session, server, id);
    if (!["failed", "expired"].includes(job.status))
      throw new ConflictException("This export is still active.");
    return this.start(session, server, {
      ...job.filters,
      request_id: randomUUID(),
    });
  }
  private async members(guild: any) {
    const members = new Map<string, any>();
    let after: string | undefined;
    for (let page = 0; ; page++) {
      if (page >= 100)
        throw new ServiceUnavailableException(
          "The export exceeds the supported member scan limit.",
        );
      const batch = await guild.members.list({
        limit: 1000,
        ...(after ? { after } : {}),
      });
      for (const [id, m] of batch) {
        if (members.has(id))
          throw new ServiceUnavailableException(
            "Discord returned an incomplete member scan. Retry the export.",
          );
        members.set(id, m);
      }
      if (batch.size < 1000) return members;
      after = [...batch.keys()]
        .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
        .at(-1);
    }
  }
  private memberMatches(m: any, f: any) {
    const roles = f.roles || [],
      held = roles.map((r: string) => m.roles.cache.has(r));
    return (
      !(f.exclude_roles || []).some((r: string) => m.roles.cache.has(r)) &&
      (!roles.length ||
        (f.role_match === "all" ? held.every(Boolean) : held.some(Boolean))) &&
      (!f.joined_before ||
        (m.joinedTimestamp && m.joinedTimestamp <= Date.parse(f.joined_before)))
    );
  }
  private async wallets(users: string[]) {
    const rows: any[] = [];
    for (let i = 0; i < users.length; i += 100)
      for (let offset = 0; ; offset += 1000) {
        const batch = this.privacy.checked(
          await this.db
            .from("user_wallets")
            .select("id,user_id,address,wallet_type,last_verified_at")
            .in("user_id", users.slice(i, i + 100))
            .order("id")
            .range(offset, offset + 999),
        );
        rows.push(...batch);
        if (batch.length < 1000) break;
      }
    return rows;
  }
  private family(wallet: any, f: any) {
    return (
      (!f.family || f.family === "all" || f.family === wallet.wallet_type) &&
      (!f.network ||
        f.network === "all" ||
        (f.network === "bitcoin") === (wallet.wallet_type === "bitcoin")) &&
      (!f.verified_since ||
        Date.parse(wallet.last_verified_at) >= Date.parse(f.verified_since))
    );
  }
  private network(rule: any) {
    return rule.asset_type === "ordinal"
      ? "bitcoin"
      : rule.chain_id === 4663
        ? "robinhood"
        : "ethereum";
  }
  private hash(rules: any[]) {
    return createHash("sha256")
      .update(
        JSON.stringify(
          rules
            .map((r) => [String(r.id), ruleEditVersion(r)])
            .sort((a, b) => a[0].localeCompare(b[0])),
        ),
      )
      .digest("hex");
  }
  private async blocked(server: string) {
    const set = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const rows = this.privacy.checked(
        await this.db
          .from("verifier_wallet_blocks")
          .select("address")
          .eq("server_id", server)
          .order("address")
          .range(offset, offset + 999),
      );
      for (const r of rows) set.add(r.address);
      if (rows.length < 1000) return set;
    }
  }
  private async eligibleWallets(
    server: string,
    user: string,
    wallets: any[],
    f: any,
    override: boolean,
  ) {
    const p = override ? null : await this.privacy.policy(server, user);
    return wallets.filter(
      (w) =>
        this.family(w, f) &&
        (override ||
          (this.privacy.visible(p.export_since, w.last_verified_at) &&
            (!f.identities ||
              this.privacy.visible(p.share_since, w.last_verified_at)))),
    );
  }
  @Interval(5000)
  async run() {
    if (this.working || EnvironmentConfig.IS_TEST) return;
    this.working = true;
    let job: any;
    let heartbeat: ReturnType<typeof setInterval>;
    try {
      const claimed = this.privacy.checked(
        await this.db.rpc("verifier_privacy_claim_export", {
          p_worker: this.worker,
        }),
      );
      job = claimed?.[0];
      if (!job) return;
      heartbeat = setInterval(() => {
        void this.db
          .from("verifier_wallet_exports")
          .update({ locked_until: new Date(Date.now() + 120000).toISOString() })
          .eq("id", job.id)
          .eq("worker", this.worker)
          .then(() => {});
      }, 30000);
      const result = await this.build(job);
      this.privacy.checked(
        await this.db
          .from("verifier_wallet_exports")
          .update({
            status: "completed",
            result,
            progress: result.scanned,
            total: result.scanned,
            checked_at: result.started_at,
            worker: null,
            locked_until: null,
          })
          .eq("id", job.id)
          .eq("worker", this.worker)
          .eq("status", "running"),
      );
    } catch {
      if (job)
        await this.db
          .from("verifier_wallet_exports")
          .update({
            status: "failed",
            result: null,
            worker: null,
            locked_until: null,
            error:
              "Fresh export checks could not finish. Permissions, membership or providers may have changed. Retry to build a new complete snapshot.",
          })
          .eq("id", job.id)
          .eq("worker", this.worker);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      this.working = false;
    }
  }
  async build(job: any) {
    const started = Date.now(),
      f = job.filters,
      s = this.session(job.actor_id);
    const guild = await this.authorize(
      s,
      job.server_id,
      job.operator_override,
      job.reason,
    );
    const members = await this.members(guild),
      allRules = await this.rules.getRoleMappings(job.server_id),
      hash = this.hash(allRules);
    if (
      (f.channel && !allRules.some((r) => r.channel_id === f.channel)) ||
      (f.rule && !allRules.some((r) => String(r.id) === f.rule))
    )
      throw new BadRequestException(
        "The selected export scope no longer exists.",
      );
    const candidates = [...members.values()].filter((m) =>
        this.memberMatches(m, f),
      ),
      wallets = await this.wallets(candidates.map((m) => m.id));
    const blocked = await this.blocked(job.server_id);
    const rows: any[] = [];
    // A fresh context pins RPC blocks and shares complete provider reads within this export only.
    const context: NftCheckContext = {
      checks: new Map(),
      userAddresses: new Map(),
      freshExport: true,
    };
    for (let i = 0; i < candidates.length; i++) {
      if (Date.now() - started > 12 * 60000)
        throw new ServiceUnavailableException(
          "Fresh snapshot time limit exceeded. Narrow the export filters.",
        );
      const m = candidates[i],
        all = wallets.filter((w) => w.user_id === m.id);
      const allowed = (
        await this.eligibleWallets(
          job.server_id,
          m.id,
          all,
          f,
          job.operator_override,
        )
      ).filter((w) => f.exclude_blocked === false || !blocked.has(w.address));
      if (allowed.length) {
        context.userAddresses.set(
          m.id,
          Promise.resolve(all.map((w) => w.address)),
        );
        let scope = allRules.filter(
          (r) => !f.channel || r.channel_id === f.channel,
        );
        if (f.rule) {
          const selected = allRules.find((r) => String(r.id) === f.rule);
          scope = scope.filter(
            (r) =>
              r.role_id === selected.role_id &&
              r.channel_id === selected.channel_id &&
              (selected.asset_type === "erc20"
                ? r.id === selected.id
                : r.asset_type !== "erc20" &&
                  r.min_items === selected.min_items),
          );
        } else if (f.roles?.length && !f.channel)
          scope = scope.filter((r) => f.roles.includes(r.role_id));
        const checked = scope.length
          ? await this.engine.verifyUserBulk(
              m.id,
              scope.map((r) => r.id),
              all[0].address,
              scope,
              context,
            )
          : null;
        if (
          checked?.results.some(
            (r) => r.status === "unavailable" || r.error || r.matchingAssetsIncomplete,
          )
        )
          throw new ServiceUnavailableException("Fresh holdings unavailable.");
        const passing =
          checked?.results.filter((r) => r.isValid).map((r) => r.rule) || [];
        const manualRoles = (f.roles || []).filter(
          (id: string) => !allRules.some((r) => r.role_id === id),
        );
        const explicitScope = !!f.rule || !!f.channel;
        const manualDestination = !explicitScope && manualRoles.length > 0;
        const qualifies = explicitScope
          ? passing.length > 0
          : !scope.length ||
            (f.role_match === "all" && f.roles?.length
              ? f.roles.every(
                  (id: string) =>
                    manualRoles.includes(id) ||
                    passing.some((r) => r.role_id === id),
                )
              : passing.length > 0 || manualDestination);
        if (qualifies)
          for (const w of allowed) {
            const networks = new Set<string>();
            if (!explicitScope && (!scope.length || manualDestination))
              networks.add(
                f.network && f.network !== "all"
                  ? f.network
                  : w.wallet_type === "bitcoin"
                    ? "bitcoin"
                    : "evm",
              );
            for (const rule of passing) {
              const network = this.network(rule);
              if (
                (f.network && f.network !== "all" && network !== f.network) ||
                (network === "bitcoin") !== (w.wallet_type === "bitcoin") ||
                (f.rule && String(rule.id) !== f.rule)
              )
                continue;
              if ((await this.ownership.count(rule, [w.address], context)) > 0n)
                networks.add(network);
            }
            for (const network of networks)
              rows.push({
                user_id: m.id,
                address: w.address,
                wallet_type: w.wallet_type,
                network,
                proof_at: w.last_verified_at,
              });
          }
      }
      if (i % 10 === 0)
        this.privacy.checked(
          await this.db
            .from("verifier_wallet_exports")
            .update({ progress: i + 1, total: candidates.length })
            .eq("id", job.id)
            .eq("worker", this.worker),
        );
    }
    await this.authorize(s, job.server_id, job.operator_override, job.reason);
    if (hash !== this.hash(await this.rules.getRoleMappings(job.server_id)))
      throw new ConflictException("Rules changed during the export.");
    const unique = [
      ...new Map(rows.map((r) => [r.network + "|" + r.address, r])).values(),
    ];
    return {
      rows: f.one_per_member ? latestWallets(unique) : unique,
      before_dedup: unique.length,
      scanned: candidates.length,
      started_at: new Date(started).toISOString(),
      rules_hash: hash,
    };
  }
  async download(session: PortalSession, server: string, id: string) {
    const job = await this.job(session, server, id);
    if (
      job.status !== "completed" ||
      !Array.isArray(job.result?.rows) ||
      Date.parse(job.expires_at) < Date.now() ||
      Date.now() - Date.parse(job.checked_at) > 15 * 60000
    )
      throw new ConflictException("Build a fresh export before downloading.");
    const guild = await this.authorize(
        session,
        server,
        job.operator_override,
        job.reason,
      ),
      f = job.filters;
    const [members, rules, blocked] = await Promise.all([
      this.members(guild),
      this.rules.getRoleMappings(server),
      this.blocked(server),
    ]);
    if (job.result.rules_hash !== this.hash(rules))
      throw new ConflictException("Rules changed. Build a fresh export.");
    const wallets = await this.wallets([
      ...new Set<string>(job.result.rows.map((r) => r.user_id)),
    ]);
    const values: any[] = [];
    for (const row of job.result.rows) {
      const member = members.get(row.user_id);
      const allowed = await this.eligibleWallets(
        server,
        row.user_id,
        wallets.filter((w) => w.user_id === row.user_id),
        f,
        job.operator_override,
      );
      if (
        !member ||
        !this.memberMatches(member, f) ||
        !allowed.some(
          (w) =>
            w.address === row.address && w.last_verified_at === row.proof_at,
        ) ||
        (f.exclude_blocked !== false && blocked.has(row.address))
      )
        throw new ConflictException(
          "Membership, wallet links or permissions changed. Build a fresh export.",
        );
      values.push([
        row.address,
        row.network,
        ...(f.identities ? [member.user.username, member.id] : []),
      ]);
    }
    const details = {
      export_id: id,
      count: values.length,
      identities: !!f.identities,
      filters: f,
    };
    if (job.operator_override)
      await this.privacy.audit(
        session.user.id,
        server,
        "export_override_download",
        job.reason,
        details,
      );
    else
      this.privacy.checked(
        await this.db
          .from("verifier_operator_access")
          .insert({
            actor_id: session.user.id,
            server_id: server,
            operation: "community_export_download",
            details,
          }),
      );
    const headers = [
      "wallet_address",
      "network",
      ...(f.identities ? ["discord_name", "discord_id"] : []),
    ];
    return {
      filename: `bouncer-wallets-${new Date(job.checked_at).toISOString().slice(0, 10)}.csv`,
      count: values.length,
      checked_at: job.checked_at,
      csv:
        [headers, ...values]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n") + "\r\n",
    };
  }
}
