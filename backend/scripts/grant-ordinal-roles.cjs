// Explicit one-time maintenance. Does not start Nest, the Discord gateway, or cron jobs.
const { resolve, dirname } = require('node:path');
const { openSync, closeSync, writeSync, fsyncSync, mkdirSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { parseArgs } = require('node:util');
class MaintenanceError extends Error {}

async function main() {
  const { values } = parseArgs({ options: {
    server: { type: 'string' }, apply: { type: 'boolean', default: false },
    report: { type: 'string' }, 'data-workdir': { type: 'string' }, 'retry-report': { type: 'string' }, user: { type: 'string' },
    'collections-only': { type: 'boolean', default: false },
  } });
  if (!/^\d{17,20}$/.test(values.server || '')) {
    throw new MaintenanceError('Use --server DISCORD_SERVER_ID [--apply] [--report FILE] [--data-workdir LINKED_HOLDINGS_PROJECT]. The default is a dry run.');
  }
  if (values.user && !/^\d{17,20}$/.test(values.user)) throw new MaintenanceError('Invalid Discord user ID.');
  const dotenv = require('dotenv');
  // Exported variables take precedence; private local overrides precede defaults.
  dotenv.config({ path: resolve(__dirname, '../.env.local') });
  dotenv.config({ path: resolve(__dirname, '../.env.ordnet') });
  dotenv.config({ path: resolve(__dirname, '../.env') });
  if (!process.env.DISCORD_BOT_TOKEN) throw new MaintenanceError('Missing DISCORD_BOT_TOKEN.');

  require('reflect-metadata');
  const { Logger } = require('@nestjs/common');
  // Avoid raw SDK/provider errors, which can contain credential-bearing URLs.
  Logger.overrideLogger(false);
  const { REST, Routes, PermissionFlagsBits } = require('discord.js');
  const { NftMetadataService } = require('../dist/services/nft-metadata.service');
  const { NftOwnershipService } = require('../dist/services/nft-ownership.service');
  const { OrdnetApiService } = require('../dist/services/ordnet-api.service');
  const { OrdnetOwnershipService } = require('../dist/services/ordnet-ownership.service');
  const { OrdinalCollectionCacheService } = require('../dist/services/ordinal-collection-cache.service');
  const { OrdinalWalletInventoryService } = require('../dist/services/ordinal-wallet-inventory.service');
  const { OrdinalsRequestScheduler } = require('../dist/services/ordinals-request-scheduler.service');
  const { OrdinalsOwnershipService } = require('../dist/services/ordinals-ownership.service');
  const { EthscriptionsOwnershipService } = require('../dist/services/ethscriptions-ownership.service');
  const { AssetOwnershipService } = require('../dist/services/asset-ownership.service');
  const { VerificationEngine } = require('../dist/services/verification-engine.service');
  const { runOrdinalRoleGrants, ordinalGrantGroups } = require('../dist/maintenance/ordinal-role-grants');
  const { normalizeBitcoinAddress } = require('../dist/utils/wallet-address.util');

  const linked = require('./linked-ordinal-grant-data.cjs').linkedOrdinalGrantData(resolve(__dirname, '..'),
    values['data-workdir'] ? resolve(values['data-workdir']) : undefined);
  const db = linked.db;
  const requests = new OrdinalsRequestScheduler();
  const ordnet = new OrdnetOwnershipService(new OrdnetApiService(requests), requests);
  const catalog = new OrdinalCollectionCacheService(db, ordnet, requests);
  const ordinals = new OrdinalsOwnershipService(ordnet, db, requests, catalog, new OrdinalWalletInventoryService(requests, db));
  const engine = new VerificationEngine(db, new AssetOwnershipService(linked.data, new NftOwnershipService(new NftMetadataService(db)),
    ordinals, new EthscriptionsOwnershipService()), linked.addresses, linked.blocks);
  const rest = new REST({ version: '10', timeout: 15000 }).setToken(process.env.DISCORD_BOT_TOKEN);
  const serverId = values.server;
  let bot, guild, roles, botMember;
  try {
    bot = await rest.get(Routes.user('@me'));
    guild = await rest.get(Routes.guild(serverId));
    roles = await rest.get(Routes.guildRoles(serverId));
    botMember = await rest.get(Routes.guildMember(serverId, bot.id));
  } catch { throw new MaintenanceError('Discord preflight failed. Check the live bot token and server access.'); }
  const botRoles = roles.filter(role => role.id === serverId || botMember.roles.includes(role.id));
  const permissions = botRoles.reduce((bits, role) => bits | BigInt(role.permissions), 0n);
  if (!(permissions & (PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageRoles))) throw new MaintenanceError('The bot lacks Manage Roles.');
  const highest = botRoles.reduce((best, role) => role.position > best.position
    || (role.position === best.position && BigInt(role.id) < BigInt(best.id)) ? role : best);
  const manageable = role => role && role.id !== serverId && !role.managed
    && (role.position < highest.position || (role.position === highest.position && BigInt(role.id) > BigInt(highest.id)));

  const rules = (await linked.rules(serverId)).filter(rule => !values['collections-only'] || rule.asset_type !== 'ordinal' || !rule.inscription_criteria);
  if (!ordinalGrantGroups(rules).length) throw new MaintenanceError('This server has no Ordinals rules.');
  const wallets = await linked.wallets();
  const retryUsers = values['retry-report'] ? new Set(require('node:fs').readFileSync(resolve(values['retry-report']), 'utf8')
    .trim().split('\n').map(JSON.parse).filter(row => ['checks_unavailable', 'member_check_failed', 'member_refresh_failed', 'grant_failed'].includes(row.event))
    .map(row => row.userId)) : null;
  const members = wallets.filter(row => (!retryUsers || retryUsers.has(row.user_id)) && (!values.user || row.user_id === values.user))
    .map(row => ({ userId: row.user_id, address: normalizeBitcoinAddress(row.address) }));
  const runId = randomUUID();
  const report = resolve(values.report || resolve(__dirname, '../temp', `ordinal-role-grants-${runId}.jsonl`));
  mkdirSync(dirname(report), { recursive: true, mode: 0o700 });
  const fd = openSync(report, 'wx', 0o600);
  const record = event => { writeSync(fd, JSON.stringify({ at: new Date().toISOString(), runId, ...event }) + '\n'); fsyncSync(fd); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const host = new URL(typeof url === 'string' || url instanceof URL ? url : url.url).hostname;
    try {
      const response = await originalFetch(url, options);
      if (!response.ok) record({ event: 'provider_http_failure', host, status: response.status });
      return response;
    } catch (error) { record({ event: 'provider_connection_failure', host, kind: error.name }); throw error; }
  };
  console.log(JSON.stringify({ mode: values.apply ? 'apply' : 'dry-run', server: guild.name, users: new Set(members.map(member => member.userId)).size, report }));
  try {
    record({ event: 'start', serverId, apply: values.apply, ruleIds: rules.map(rule => rule.id) });
    const summary = await runOrdinalRoleGrants(members, rules, values.apply, {
      record,
      member: async userId => {
        try {
          const member = await rest.get(Routes.guildMember(serverId, userId));
          return { name: member.nick || member.user.global_name || member.user.username, roles: new Set(member.roles) };
        } catch (error) { if (error.code === 10007) return null; throw new Error('Member lookup failed.'); }
      },
      verify: async (userId, address, rules, context) => {
        // Unlike a signed interactive request, this task must never append a
        // wallet that was removed after the initial candidate list was read.
        const currentAddress = (await linked.addresses.getUserAddresses(userId)).find(wallet => /^bc1p/i.test(wallet));
        if (!currentAddress) {
          record({ event: 'bitcoin_wallet_no_longer_saved', userId });
          return { userId, address, totalRules: 0, validRules: [], invalidRules: [], matchingAssetCounts: new Map(), results: [] };
        }
        const result = await engine.verifyUserBulk(userId, rules.map(rule => rule.id), currentAddress, rules, context);
        const databaseErrors = result.results.filter(check => check.error?.startsWith('Linked database query failed')).map(check => check.error);
        if (databaseErrors.length) record({ event: 'database_check_failure', userId, errors: [...new Set(databaseErrors)] });
        return result;
      },
      add: async (userId, roleId) => {
        if (!manageable(roles.find(role => role.id === roleId))) throw new Error('Role is missing, managed, or above the bot.');
        // PUT adds one role without replacing or removing any existing roles.
        await rest.put(Routes.guildMemberRole(serverId, userId, roleId), { reason: `Bouncer: one-time Ordinals eligibility check (${runId})` });
      },
      track: async (userId, userName, rule, checks) => {
        const role = roles.find(role => role.id === rule.role_id);
        for (let attempt = 0; ; attempt++) {
          try {
            await db.trackRoleAssignment({ userId, serverId, roleId: rule.role_id, ruleId: String(rule.id), userName,
              serverName: guild.name, roleName: role.name,
              verificationData: { last_check_status: 'passed', matched_rule_ids: [...new Set(checks.filter(check => check.isValid).map(check => check.ruleId))],
                rule_checks: checks, one_time_ordinals_grant: { run_id: runId, checked_at: new Date().toISOString() } } });
            return;
          } catch { if (attempt >= 2) throw new Error('Assignment tracking failed.'); }
        }
      },
    });
    console.log(JSON.stringify(summary));
    if (summary.errors || summary.unavailableChecks) process.exitCode = 1;
  } finally { globalThis.fetch = originalFetch; closeSync(fd); }
}

// Provider pacing timers are unref'd for the web server. This standalone task
// must stay alive while a queued request is the only remaining work.
const keepAlive = setInterval(() => undefined, 1000);
main().catch(error => {
  // Only our own fixed messages are safe to expose; provider payloads stay private.
  console.error(error instanceof MaintenanceError || error.message.startsWith('Role granted but tracking failed.') ? error.message : 'One-time role check failed. Check credentials, server access, and the private report.');
  process.exitCode = 1;
}).finally(() => clearInterval(keepAlive));
