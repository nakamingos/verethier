import { DiscordVerificationService } from "../src/services/discord-verification.service";
import {
  PrivacyService,
  privacyChoice,
  privacyProof,
  PRIVACY_NOTICE,
} from "../src/portal/privacy.service";
import { PrivacyController } from "../src/portal/privacy.controller";
import { PortalService } from "../src/portal/portal.service";
import { WalletService } from "../src/services/wallet.service";
import { BitcoinSignatureService } from "../src/services/bitcoin-signature.service";
import { NonceService } from "../src/services/nonce.service";
import { EnvironmentConfig } from "../src/config/environment.config";
import { privateKeyToAccount } from "viem/accounts";
import { Signer } from "bip322-js";
import vectors from "./fixtures/bip322-taproot.json";
const operator = "111111111111111111",
  other = "222222222222222222",
  server = "333333333333333333";
const choice = {
  epoch: "00000000-0000-4000-8000-000000000001",
  share: true,
  exports: false,
  notice: PRIVACY_NOTICE,
};

describe("Privacy authority and input boundaries", () => {
  const prior = process.env.BOUNCER_OPERATOR_DISCORD_IDS;
  afterEach(() => {
    if (prior === undefined) delete process.env.BOUNCER_OPERATOR_DISCORD_IDS;
    else process.env.BOUNCER_OPERATOR_DISCORD_IDS = prior;
    jest.restoreAllMocks();
  });
  it("uses exact OAuth IDs, rejects malformed configuration and revokes existing sessions", () => {
    const p = new PrivacyService({} as any);
    for (const value of ["", operator + "x", operator + ",bad"]) {
      process.env.BOUNCER_OPERATOR_DISCORD_IDS = value;
      expect(p.isOperator(operator)).toBe(false);
    }
    process.env.BOUNCER_OPERATOR_DISCORD_IDS = operator + ", \n" + other;
    expect(p.isOperator(operator)).toBe(true);
    expect(p.isOperator(other)).toBe(true);
    expect(p.isOperator("333333333333333333")).toBe(false);
    process.env.BOUNCER_OPERATOR_DISCORD_IDS = other;
    expect(() => p.requireOperator(operator)).toThrow("Operator");
  });
  it("requires a successful access receipt before serving an operator read", async () => {
    process.env.BOUNCER_OPERATOR_DISCORD_IDS = operator;
    const insert = jest
      .fn()
      .mockResolvedValue({ error: { message: "unavailable" } });
    const p = new PrivacyService({ from: () => ({ insert }) } as any);
    await expect(p.audit(operator, server, "member")).rejects.toThrow(
      "temporarily unavailable",
    );
    await expect(p.audit(other, server, "member")).rejects.toThrow("Operator");
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it("canonicalizes signed choices and rejects ambiguous or outdated notices", () => {
    expect(privacyProof({ ...choice })).toBe(JSON.stringify(choice));
    expect(
      privacyChoice({
        notice: choice.notice,
        exports: false,
        share: true,
        epoch: choice.epoch,
      }),
    ).toEqual(choice);
    for (const value of [
      null,
      [],
      { ...choice, share: "true" },
      { ...choice, exports: undefined },
      { ...choice, notice: "old" },
      { ...choice, epoch: "no" },
      { ...choice, operator: true },
    ])
      expect(() => privacyChoice(value)).toThrow();
  });
  it("checks membership and same-origin CSRF before changing preferences", async () => {
    const session = { user: { id: other } } as any,
      auth = {
        session: jest.fn().mockResolvedValue(session),
        assertMutation: jest.fn<void, any[]>(() => {
          throw new Error("CSRF");
        }),
      };
    const member = { privacyMembership: jest.fn() },
      privacy = { choose: jest.fn() };
    const c = new PrivacyController(
      auth as any,
      {} as any,
      member as any,
      privacy as any,
      {} as any,
    );
    await expect(c.choose({} as any, server, choice)).rejects.toThrow("CSRF");
    expect(member.privacyMembership).not.toHaveBeenCalled();
    expect(privacy.choose).not.toHaveBeenCalled();
    auth.assertMutation.mockImplementation(() => {});
    member.privacyMembership.mockRejectedValue(new Error("not a member"));
    await expect(c.choose({} as any, server, choice)).rejects.toThrow(
      "not a member",
    );
    expect(privacy.choose).not.toHaveBeenCalled();
  });
  it("never turns operator inspection into authority to block wallets or fix roles", async () => {
    const s = new PortalService(
      ...(Array(12).fill({}) as [
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
        any,
      ]),
    );
    const access = jest
      .spyOn(s, "access")
      .mockRejectedValue(new Error("Administrator required"));
    const read = jest.spyOn(s, "member").mockResolvedValue({
      id: other,
      wallets: [],
      removed_wallets: [],
    } as any);
    await expect(
      s.fix({ user: { id: operator } } as any, server, other, "request"),
    ).rejects.toThrow("Administrator");
    await expect(
      s.walletBlock(
        { user: { id: operator } } as any,
        server,
        other,
        {} as any,
      ),
    ).rejects.toThrow("Administrator");
    expect(access).toHaveBeenCalledTimes(2);
    expect(read).not.toHaveBeenCalled();
  });
  it("returns only permission-filtered address matches and never queries raw history for an ordinary admin", async () => {
    const db = { from: jest.fn() },
      privacy = {
        isOperator: () => false,
        walletMatches: jest
          .fn()
          .mockResolvedValue([{ user_id: other, wallet_match: "current" }]),
      };
    const args = Array(12).fill({});
    args[0] = db;
    const s = new PortalService(
      ...(args as [any, any, any, any, any, any, any, any, any, any, any, any]),
      undefined,
      privacy as any,
    );
    const guild = {
      id: server,
      members: {
        fetch: jest.fn().mockResolvedValue({
          id: other,
          displayName: "Member",
          user: { username: "member" },
          displayAvatarURL: () => null,
        }),
      },
    } as any;
    jest.spyOn(s, "readAccess").mockResolvedValue(guild);
    expect(
      (
        await s.memberSuggestions(
          { user: { id: operator } } as any,
          server,
          "0x" + "a".repeat(40),
        )
      ).members.map((m) => m.id),
    ).toEqual([other]);
    expect(privacy.walletMatches).toHaveBeenCalledWith(
      server,
      "0x" + "a".repeat(40),
    );
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("Deletion and Discord grant sequencing", () => {
  function setup() {
    const role = { id: "role", name: "Holder" },
      member = {
        roles: { cache: new Map(), add: jest.fn(), remove: jest.fn() },
      };
    member.roles.add.mockResolvedValue(member);
    member.roles.remove.mockResolvedValue(member);
    const guild = {
      id: server,
      name: "Community",
      members: { fetch: async () => member },
      roles: { cache: new Map([["role", role]]), fetch: async () => role },
    };
    const privacy = { assertActive: jest.fn(), queueGrantRecheck: jest.fn() },
      db = { trackRoleAssignment: jest.fn() };
    const s = new DiscordVerificationService(
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      privacy as any,
    );
    (s as any).client = {
      guilds: { cache: new Map([[server, guild]]), fetch: async () => guild },
    };
    return { s, member, privacy, db };
  }
  it("denies a new grant while deletion is processing", async () => {
    const { s, member, privacy, db } = setup();
    privacy.assertActive.mockRejectedValue(new Error("deletion in progress"));
    await expect(
      s.addUserRole(other, "role", server, "reverification"),
    ).rejects.toThrow("deletion");
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(db.trackRoleAssignment).not.toHaveBeenCalled();
  });
  it("undoes a grant if deletion is approved during the Discord request", async () => {
    const { s, member, privacy, db } = setup();
    privacy.assertActive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("deletion in progress"));
    await expect(
      s.addUserRole(other, "role", server, "reverification"),
    ).rejects.toThrow("deletion");
    expect(member.roles.add).toHaveBeenCalled();
    expect(privacy.queueGrantRecheck).toHaveBeenCalledWith(
      other,
      server,
      "role",
    );
    expect(member.roles.remove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "role" }),
      "Bouncer account deletion in progress",
    );
    expect(db.trackRoleAssignment).not.toHaveBeenCalled();
  });
  it("also undoes an in-flight background grant during deletion", async () => {
    const { s, member, privacy } = setup();
    privacy.assertActive
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("deletion in progress"));
    expect(await s.addUserRoleDynamic(other, server, "role")).toBe(false);
    expect(member.roles.remove).toHaveBeenCalled();
  });
});

describe("Signed privacy choices", () => {
  const account = privateKeyToAccount(
    ("0x" + "11".repeat(32)) as `0x${string}`,
  );
  const data = {
    address: account.address,
    userId: other,
    userTag: "Member",
    avatar: "",
    discordId: server,
    discordName: "Server",
    discordIcon: "",
    nonce: "testnonce",
    expiry: Math.floor(Date.now() / 1000) + 300,
    privacy: choice,
  };
  function evm() {
    const nonce = {
        validateNonce: jest.fn().mockResolvedValue(true),
        consumeNonce: jest.fn().mockResolvedValue({}),
      },
      links = {
        addUserAddress: jest.fn().mockResolvedValue({ success: true }),
      };
    const privacy = { assertActive: jest.fn(), choose: jest.fn() };
    const service = new WalletService(
      nonce as any,
      links as any,
      { getUser: async () => ({ username: "member" }) } as any,
      {} as any,
      { assertAllowed: async () => {} } as any,
      undefined,
      privacy as any,
    );
    return { nonce, links, privacy, service };
  }
  async function signature() {
    return account.signTypedData({
      domain: { name: "Bouncer", version: "1", chainId: 1 },
      primaryType: "Verification",
      types: {
        Verification: [
          { name: "UserID", type: "string" },
          { name: "UserTag", type: "string" },
          { name: "ServerID", type: "string" },
          { name: "ServerName", type: "string" },
          { name: "Nonce", type: "string" },
          { name: "Expiry", type: "uint256" },
          { name: "Privacy", type: "string" },
        ],
      },
      message: {
        UserID: data.userId,
        UserTag: data.userTag,
        ServerID: data.discordId,
        ServerName: data.discordName,
        Nonce: data.nonce,
        Expiry: BigInt(data.expiry),
        Privacy: privacyProof(choice),
      },
    });
  }
  it("saves a cryptographically verified EVM choice after nonce consumption and before the new wallet proof", async () => {
    const { nonce, links, privacy, service } = evm();
    await service.verifySignature(data, await signature());
    expect(privacy.choose).toHaveBeenCalledWith(server, other, choice);
    expect(nonce.consumeNonce.mock.invocationCallOrder[0]).toBeLessThan(
      privacy.choose.mock.invocationCallOrder[0],
    );
    expect(privacy.choose.mock.invocationCallOrder[0]).toBeLessThan(
      links.addUserAddress.mock.invocationCallOrder[0],
    );
  });
  it.each(["change", "strip"])(
    "rejects a %s of signed EVM preferences without saving anything",
    async (mode) => {
      const { links, privacy, service } = evm(),
        tampered = {
          ...data,
          privacy: mode === "strip" ? undefined : { ...choice, exports: true },
        };
      await expect(
        service.verifySignature(tampered, await signature()),
      ).rejects.toThrow();
      expect(privacy.choose).not.toHaveBeenCalled();
      expect(links.addUserAddress).not.toHaveBeenCalled();
    },
  );
  it("does not link a proven wallet when deletion or preference validation fails", async () => {
    const { links, privacy, service } = evm();
    privacy.choose.mockRejectedValue(new Error("stale epoch"));
    await expect(
      service.verifySignature(data, await signature()),
    ).rejects.toThrow("stale epoch");
    expect(links.addUserAddress).not.toHaveBeenCalled();
  });
  it("stops EVM eligibility when a signed proof cannot be saved", async () => {
    const { links, service } = evm();
    links.addUserAddress.mockResolvedValue({
      success: false,
      error: "deletion in progress",
    } as any);
    await expect(
      service.verifySignature(data, await signature()),
    ).rejects.toThrow("Could not save wallet proof");
  });

  it("binds the Bitcoin preference to the exact signed challenge and rejects tampering before consuming its nonce", async () => {
    const entries = new Map(),
      nonces = new NonceService({
        get: async (k) => entries.get(k),
        set: async (k, v) => {
          entries.set(k, v);
        },
        del: async (k) => {
          entries.delete(k);
        },
      } as any);
    const bitcoin = new BitcoinSignatureService(nonces, {
      getRulesByChannel: async () => [{ asset_type: "ordinal" }],
    } as any);
    const base = EnvironmentConfig.BASE_URL;
    (EnvironmentConfig as any).BASE_URL = "https://bouncer.example.test";
    try {
      const nonce = await nonces.createNonce(
          other,
          server,
          "message",
          "channel",
        ),
        v = vectors.valid[0];
      const challenge = await bitcoin.createChallenge(
          other,
          server,
          nonce,
          v.address,
          choice,
        ),
        sig = Signer.sign(v.test_private_key, v.address, challenge.message);
      expect(challenge.message).toContain(privacyProof(choice));
      const payload = {
        ...data,
        nonce,
        address: v.address,
        walletType: "bitcoin" as const,
        expiry: challenge.expiry,
      };
      await expect(
        bitcoin.verify(
          { ...payload, privacy: { ...choice, exports: true } },
          sig,
        ),
      ).rejects.toThrow("challenge");
      await expect(
        bitcoin.verify({ ...payload, privacy: undefined }, sig),
      ).rejects.toThrow("challenge");
      expect((await bitcoin.verify(payload, sig)).address).toBe(v.address);
    } finally {
      (EnvironmentConfig as any).BASE_URL = base;
    }
  });
});
