import {
  WalletExportService,
  csvCell,
  latestWallets,
} from "../src/portal/wallet-export.service";
import { PrivacyService } from "../src/portal/privacy.service";
const server = "111111111111111111",
  actor = "222222222222222222",
  user = "333333333333333333",
  role = "444444444444444444",
  channel = "555555555555555555";
const proof = new Date(Date.now() - 60000).toISOString(),
  address = "0x" + "a".repeat(40),
  other = "0x" + "b".repeat(40),
  session = { user: { id: actor } } as any;
function setup(filters: any = {}) {
  const walletRows = [
    {
      id: 1,
      user_id: user,
      address,
      wallet_type: "evm",
      last_verified_at: proof,
    },
    {
      id: 2,
      user_id: user,
      address: other,
      wallet_type: "evm",
      last_verified_at: proof,
    },
  ];
  const member = {
    id: user,
    user: { username: "Member" },
    joinedTimestamp: 0,
    roles: { cache: new Map([[role, {}]]) },
  };
  const guild = {
    members: { list: jest.fn().mockResolvedValue(new Map([[user, member]])) },
  };
  const rule = {
    id: 1,
    server_id: server,
    channel_id: channel,
    role_id: role,
    asset_type: "nft",
    chain_id: 1,
    min_items: 2,
    trait_filter: null,
    contract_address: "0x" + "c".repeat(40),
    token_standard: "erc721",
  };
  const queries: any[] = [];
  let stored: any;
  const db = {
    from: jest.fn((table: string) => {
      const q: any = {};
      for (const method of [
        "select",
        "eq",
        "in",
        "order",
        "range",
        "update",
        "insert",
      ])
        q[method] = jest.fn(() => q);
      q.then = (ok: any, bad: any) =>
        Promise.resolve({
          data:
            table === "user_wallets"
              ? walletRows
              : table === "verifier_wallet_exports"
                ? stored
                : [],
          error: null,
        }).then(ok, bad);
      q.maybeSingle = jest.fn(() => q);
      q.single = jest.fn(() => q);
      queries.push({ table, q });
      return q;
    }),
  };
  const real = new PrivacyService({} as any),
    privacy = {
      checked: real.checked.bind(real),
      visible: real.visible,
      policy: jest
        .fn()
        .mockResolvedValue({
          share_since: "2020-01-01",
          export_since: "2020-01-01",
        }),
      audit: jest.fn(),
      requireOperator: jest.fn(),
    };
  const portal = {
    access: jest.fn().mockResolvedValue(guild),
    readAccess: jest.fn().mockResolvedValue(guild),
  };
  const rules = { getRoleMappings: jest.fn().mockResolvedValue([rule]) };
  const engine = {
    verifyUserBulk: jest
      .fn()
      .mockResolvedValue({
        results: [{ isValid: true, status: "valid", rule }],
      }),
  };
  const ownership = { count: jest.fn().mockResolvedValue(1n) };
  const service = new WalletExportService(
    db as any,
    portal as any,
    privacy as any,
    rules as any,
    engine as any,
    ownership as any,
  );
  const job = {
    id: "00000000-0000-4000-8000-000000000001",
    actor_id: actor,
    server_id: server,
    worker: "worker",
    operator_override: false,
    filters: { exclude_blocked: true, ...filters },
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  return {
    service,
    db,
    privacy,
    portal,
    rules,
    engine,
    ownership,
    job,
    walletRows,
    member,
    rule,
    queries,
    setStored: (v: any) => (stored = v),
  };
}
describe("Fresh wallet exports", () => {
  it("evaluates combined holdings using all saved wallets in a fresh context, without altering roles or proof times", async () => {
    const t = setup(),
      result = await t.service.build(t.job);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.proof_at === proof)).toBe(true);
    const [id, ids, first, scope, context] = t.engine.verifyUserBulk.mock
      .calls[0] as any;
    expect(id).toBe(user);
    expect(ids).toEqual([1]);
    expect(first).toBe(address);
    expect(scope).toEqual([t.rule]);
    expect(context.freshExport).toBe(true);
    expect(await context.userAddresses.get(user)).toEqual([address, other]);
    expect(t.ownership.count).toHaveBeenCalledWith(t.rule, [address], context);
  });
  it("fails the entire snapshot when a required provider is unavailable", async () => {
    const t = setup();
    t.engine.verifyUserBulk.mockResolvedValue({
      results: [{ isValid: false, status: "unavailable", rule: t.rule }],
    } as any);
    await expect(t.service.build(t.job)).rejects.toThrow("unavailable");
  });
  it("omits nonconsenting members before invoking holdings providers", async () => {
    const t = setup();
    t.privacy.policy.mockResolvedValue({
      share_since: null,
      export_since: null,
    });
    expect((await t.service.build(t.job)).rows).toEqual([]);
    expect(t.engine.verifyUserBulk).not.toHaveBeenCalled();
  });
  it("requires both permissions for identity mode", async () => {
    const t = setup({ identities: true });
    t.privacy.policy.mockResolvedValue({
      share_since: null,
      export_since: "2020-01-01",
    });
    expect((await t.service.build(t.job)).rows).toEqual([]);
  });
  it("does not export a wallet that contributes no qualifying asset", async () => {
    const t = setup();
    t.ownership.count.mockImplementation(async (_r, a) =>
      a[0] === address ? 1n : 0n,
    );
    expect((await t.service.build(t.job)).rows.map((r) => r.address)).toEqual([
      address,
    ]);
  });
  it("cannot bypass an explicit rule filter by holding an unrelated manual role", async () => {
    const t = setup({ rule: "1", roles: ["999999999999999999"] });
    t.member.roles.cache.set("999999999999999999", {});
    t.engine.verifyUserBulk.mockResolvedValue({
      results: [{ isValid: false, status: "invalid", rule: t.rule }],
    } as any);
    expect((await t.service.build(t.job)).rows).toEqual([]);
  });
  it("keeps blockchain selection separate from a wallet address and filters contribution by rule chain", async () => {
    const t = setup({ network: "robinhood" });
    expect((await t.service.build(t.job)).rows).toEqual([]);
  });
  it("rejects rule changes during the scan", async () => {
    const t = setup();
    t.rules.getRoleMappings
      .mockResolvedValueOnce([t.rule])
      .mockResolvedValueOnce([{ ...t.rule, min_items: 3 }]);
    await expect(t.service.build(t.job)).rejects.toThrow("Rules changed");
  });
  it.each(["permission", "proof", "role", "membership", "rules", "expiry"])(
    "rejects download after %s changes",
    async (reason) => {
      const t = setup({ roles: [role], identities: true }),
        result = await t.service.build(t.job);
      const saved = {
        ...t.job,
        status: "completed",
        result,
        checked_at: result.started_at,
      };
      t.setStored(saved);
      if (reason === "permission")
        t.privacy.policy.mockResolvedValue({
          share_since: null,
          export_since: null,
        });
      if (reason === "proof")
        t.walletRows[0].last_verified_at = new Date().toISOString();
      if (reason === "role") t.member.roles.cache.clear();
      if (reason === "membership")
        (await t.portal.access(session, server)).members.list.mockResolvedValue(
          new Map(),
        );
      if (reason === "rules")
        t.rules.getRoleMappings.mockResolvedValue([
          { ...t.rule, min_items: 3 },
        ]);
      if (reason === "expiry")
        saved.expires_at = new Date(Date.now() - 1000).toISOString();
      await expect(
        t.service.download(session, server, saved.id),
      ).rejects.toThrow();
    },
  );
  it("downloads an address-only CSV with no Discord names or IDs or per-member proof times", async () => {
    const t = setup(),
      result = await t.service.build(t.job);
    t.setStored({
      ...t.job,
      status: "completed",
      result,
      checked_at: result.started_at,
    });
    const out = await t.service.download(session, server, t.job.id);
    expect(out.csv).toContain("wallet_address");
    expect(out.csv).not.toContain(user);
    expect(out.csv).not.toContain("Member");
    expect(out.csv).not.toContain(proof);
    expect(out.count).toBe(2);
  });
  it("rechecks operator authority and records the reason for an override download", async () => {
    const t = setup();
    t.job.operator_override = true;
    (t.job as any).reason = "Security review";
    t.privacy.policy.mockResolvedValue({
      share_since: null,
      export_since: null,
    });
    const result = await t.service.build(t.job);
    t.setStored({
      ...t.job,
      status: "completed",
      result,
      checked_at: result.started_at,
    });
    await t.service.download(session, server, t.job.id);
    expect(t.privacy.audit).toHaveBeenCalledWith(
      actor,
      server,
      "export_override_download",
      "Security review",
      expect.objectContaining({ count: 2 }),
    );
    t.privacy.requireOperator.mockImplementation(() => {
      throw new Error("Operator revoked");
    });
    await expect(t.service.download(session, server, t.job.id)).rejects.toThrow(
      "revoked",
    );
  });
  it("compares replay filters structurally despite JSONB key ordering", async () => {
    const t = setup(),
      dto = { request_id: t.job.id, family: "evm", identities: false };
    t.setStored({ ...t.job, filters: { identities: false, family: "evm" } });
    expect((await t.service.start(session, server, dto)).id).toBe(t.job.id);
    await expect(
      t.service.start(session, server, { ...dto, identities: true }),
    ).rejects.toThrow("already used");
  });
  it("selects one wallet per member per network after filters, breaking proof ties stably", () => {
    const r = [
      { user_id: user, network: "ethereum", address: other, proof_at: proof },
      { user_id: user, network: "ethereum", address, proof_at: proof },
      { user_id: user, network: "bitcoin", address: "btc", proof_at: proof },
    ];
    expect(latestWallets(r).map((r) => r.address)).toEqual([address, "btc"]);
  });
  it.each(['=HYPERLINK("x")', " +SUM(A1)", "@cmd", "-1", "\t=cmd"])(
    "escapes spreadsheet formulas in %s",
    (v) => expect(csvCell(v).startsWith("\"'")).toBe(true),
  );
});
