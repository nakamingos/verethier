#!/usr/bin/env node
// Private, read-only holder snapshot. This file is intentionally not wired to Nest or Discord commands.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createClient } = require('@supabase/supabase-js');
const { derive, summary, csvCell } = require('./holder-analysis.cjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
process.umask(0o077);

function options(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--') || !args[i + 1]) throw new Error('Expected --name value arguments.');
    result[args[i].slice(2)] = args[i + 1];
  }
  if (!/^\d{17,22}$/.test(result.server || '')) throw new Error('Pass --server DISCORD_GUILD_ID.');
  for (const key of ['cdc-slug','cotd-slug','pizza-slug','yonder-slug']) {
    if (result[key] && !/^[a-z0-9][a-z0-9._-]{0,99}$/.test(result[key])) throw new Error(`Invalid --${key}.`);
  }
  return result;
}

function linkedServiceKey(databaseUrl) {
  const refFile = path.join(__dirname, '..', 'supabase', '.temp', 'project-ref');
  const ref = fs.readFileSync(refFile, 'utf8').trim();
  if (!/^[a-z]{20}$/.test(ref) || new URL(databaseUrl).hostname !== `${ref}.supabase.co`)
    throw new Error('The linked Supabase project does not match DB_SUPABASE_URL.');
  let keys;
  try {
    const output = execFileSync('supabase', ['projects','api-keys','--project-ref',ref,'--reveal','--output','json'],
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore','pipe','pipe'], maxBuffer: 1024 * 1024 });
    keys = JSON.parse(output);
  } catch {
    throw new Error('Could not read the linked Supabase service key through the CLI.');
  }
  const key = keys.find(entry => entry.id === 'service_role' || entry.name === 'service_role')?.api_key;
  if (typeof key !== 'string' || !key) throw new Error('Linked Supabase service-role key unavailable.');
  return key;
}

function checked(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result;
}

async function allRows(client, table, columns, filters = q => q) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const result = checked(await filters(client.from(table).select(columns)).order('id').range(offset, offset + 499), table);
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
  }
}

async function collectionSlug(client, provided, name) {
  if (provided) return provided;
  const rows = checked(await client.from('collections').select('slug,name,singleName').limit(1000), 'collections').data;
  const exact = rows.filter(row => [row.name,row.singleName,row.slug].some(value =>
    typeof value === 'string' && value.toLowerCase().replace(/[-_ ]+/g,' ').trim() === name.toLowerCase()));
  if (exact.length !== 1) throw new Error(`Could not uniquely identify ${name}; pass its exact collection slug explicitly.`);
  return exact[0].slug;
}

const MARKET = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a';
async function ethCount(client, wallet, slug) {
  const result = checked(await client.from('ethscriptions').select('hashId', { count: 'exact', head: true })
    .eq('slug', slug).or(`owner.eq.${wallet},and(owner.eq.${MARKET},prevOwner.eq.${wallet})`), `ETH ${slug} count`);
  if (!Number.isSafeInteger(result.count)) throw new Error(`Incomplete ETH ${slug} count.`);
  return result.count;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function api(url, headers, label) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
    } catch (error) {
      if (attempt === 3) throw new Error(`${label} unavailable: ${error.message}`);
      await pause(1000 * (attempt + 1));
      continue;
    }
    if (response.ok) return response.json();
    if (response.status === 404) throw new Error(`${label} not found.`);
    if (response.status !== 429 && response.status < 500) throw new Error(`${label} rejected request (${response.status}).`);
    if (attempt === 3) throw new Error(`${label} unavailable (${response.status}).`);
    const retry = Number(response.headers.get('retry-after'));
    await pause(Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 10000) : 1000 * (attempt + 1));
  }
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Incomplete ${label} response.`);
  return value;
}

async function ordnetOwnerIndex(slugs) {
  // This source returns complete collection ownership; linked user wallets stay local.
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.ordnet') });
  const { OrdnetApiService } = require('../dist/services/ordnet-api.service');
  const { OrdnetOwnershipService } = require('../dist/services/ordnet-ownership.service');
  const service = new OrdnetOwnershipService(new OrdnetApiService());
  const context = { checks: new Map() };
  const result = new Map();
  // The existing provider scheduler has unreferenced wait timers because Nest keeps
  // the bot alive. A standalone CLI needs a referenced handle until scans finish.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    for (const slug of slugs) {
      const snapshot = await service.snapshot(slug, context);
      const owners = new Map();
      for (const [id, item] of snapshot.items) {
        if (item.owner === null) throw new Error(`ord.net reported unknown ownership for ${slug}; export aborted.`);
        if (!owners.has(item.owner)) owners.set(item.owner, new Set());
        owners.get(item.owner).add(id);
      }
      result.set(slug, { owners, count: snapshot.items.size, fetched_at: snapshot.fetched_at });
    }
  } finally { clearInterval(keepAlive); }
  return result;
}

async function btcIds(wallet, slug, key) {
  const base = 'https://api.secretkeylabs.io/v1/ordinals/address/' + encodeURIComponent(wallet);
  const headers = { 'x-api-key': key, Accept: 'application/json' };
  const ids = new Set();
  let total, offset = 0;
  for (let page = 0; page < 40; page++) {
    // Match the bot's inscription-ID read so assets cannot be counted twice across wallets.
    const data = await api(`${base}/inscriptions/collection/${encodeURIComponent(slug)}?limit=25&offset=${offset}`,
      headers, `Xverse ${slug} inventory`);
    const nextTotal = integer(data.total, `Xverse ${slug} inventory`);
    const limit = integer(data.limit, `Xverse ${slug} inventory`);
    if (total !== undefined && total !== nextTotal || limit < 1 || limit > 25 || data.offset !== offset
      || data.collectionId !== slug || !Array.isArray(data.inscriptions)
      || data.inscriptions.length !== Math.min(limit, nextTotal - offset))
      throw new Error(`Incomplete Xverse ${slug} inventory.`);
    total = nextTotal;
    for (const item of data.inscriptions) {
      if (!item || !/^[0-9a-f]{64}i\d+$/.test(item.id) || ids.has(item.id)
        || !/^[0-9a-f]{64}:\d+:\d+$/.test(item.currentLocation))
        throw new Error(`Incomplete Xverse ${slug} inventory.`);
      ids.add(item.id);
    }
    offset += data.inscriptions.length;
    if (offset === total && ids.size === total) return ids;
  }
  throw new Error(`Xverse ${slug} inventory exceeded page limit.`);
}

async function discordMembers(server, token) {
  const base = `https://discord.com/api/v10/guilds/${server}`;
  const headers = { Authorization: `Bot ${token}`, Accept: 'application/json' };
  const roles = await api(base + '/roles', headers, 'Discord roles');
  const rankNames = new Set(['Comrade','Gefreiter','Korporal','Leutnant','Major']);
  const rankRoles = new Map();
  for (const role of roles) if (rankNames.has(role.name)) {
    if (rankRoles.has(role.name)) throw new Error(`Discord has duplicate ${role.name} roles.`);
    rankRoles.set(role.name, role.id);
  }
  const members = new Map();
  let after;
  for (let page = 0; page < 100; page++) {
    const url = base + '/members?limit=1000' + (after ? '&after=' + after : '');
    const batch = await api(url, headers, 'Discord member list');
    if (!Array.isArray(batch) || batch.length > 1000) throw new Error('Incomplete Discord member list.');
    for (const member of batch) {
      if (!member.user?.id || members.has(member.user.id)) throw new Error('Incomplete Discord member list.');
      members.set(member.user.id, member);
    }
    if (batch.length < 1000) return { members, rankRoles };
    after = batch.at(-1).user.id;
  }
  throw new Error('Discord member list exceeded 100 pages.');
}

function currentRole(member, rankRoles) {
  if (!member) return null;
  for (const name of ['Major','Leutnant','Korporal','Gefreiter','Comrade'])
    if (rankRoles.has(name) && member.roles.includes(rankRoles.get(name))) return name;
  return 'None';
}

function minDate(values) {
  const dates = values.filter(value => value && Number.isFinite(Date.parse(value))).sort();
  return dates[0] || '';
}
function maxDate(values) { return values.filter(value => value && Number.isFinite(Date.parse(value))).sort().at(-1) || ''; }

const CSV_FIELDS = [
  'discord_user_id','discord_username','discord_display_name','currently_in_server',
  'current_discord_role','stored_active_role_names','calculated_role','role_matches',
  'eth_wallets','btc_wallets','eth_wallet_counts','btc_wallet_counts',
  'cdc_count','cotd_count','pizza_count','yonder_count','has_yonder',
  'eth_comrades','pizza_comrades','total_comrades','rank_entitlement','migratable_eth_assets',
  'max_migratable_while_retaining_one','effective_migration_access','yonder_entitlement',
  'combined_launch_access_ceiling','verification_date','last_verification_date',
];

async function main() {
  const opts = options(process.argv.slice(2));
  const btcProvider = opts['btc-provider'] || 'ordnet';
  if (!['ordnet','xverse'].includes(btcProvider)) throw new Error('Use --btc-provider ordnet or xverse.');
  for (const name of ['DB_SUPABASE_URL','DATA_SUPABASE_URL','DATA_SUPABASE_ANON_KEY'])
    if (!process.env[name]) throw new Error(`Missing ${name}.`);
  if (btcProvider === 'xverse' && !process.env.XVERSE_API_KEY) throw new Error('Missing XVERSE_API_KEY.');
  const dbKey = opts.linked === 'true' ? linkedServiceKey(process.env.DB_SUPABASE_URL) : process.env.DB_SUPABASE_KEY;
  if (!dbKey) throw new Error('Missing DB_SUPABASE_KEY. Pass --linked true to use the linked Supabase CLI.');
  const db = createClient(process.env.DB_SUPABASE_URL, dbKey, { auth: { persistSession: false } });
  const data = createClient(process.env.DATA_SUPABASE_URL, process.env.DATA_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const slugs = {
    cdc: await collectionSlug(data, opts['cdc-slug'], 'Call Data Comrades'),
    cotd: await collectionSlug(data, opts['cotd-slug'], 'Comrades of the Dead'),
    pizza: opts['pizza-slug'] || 'pizza-comrades',
    yonder: opts['yonder-slug'] || 'yonder',
  };
  const wallets = await allRows(db, 'user_wallets', 'id,user_id,address,wallet_type,user_name,created_at,last_verified_at');
  const roleRows = await allRows(db, 'verifier_user_roles',
    'id,user_id,server_id,role_id,role_name,user_name,status,verified_at,last_checked,created_at,updated_at',
    q => q.eq('server_id', opts.server));
  const users = new Map();
  const get = id => {
    if (!users.has(id)) users.set(id, { id, wallets: [], roles: [] });
    return users.get(id);
  };
  for (const wallet of wallets) get(wallet.user_id).wallets.push(wallet);
  for (const role of roleRows) get(role.user_id).roles.push(role);
  if (!users.size) throw new Error('No on-record users found.');
  const warnings = [];
  const duplicate = new Set();
  for (const wallet of wallets) {
    const address = wallet.address.toLowerCase();
    if (duplicate.has(address)) throw new Error('One wallet is linked to multiple on-record users; resolve data quality before exporting.');
    duplicate.add(address);
    if (!['evm','bitcoin','solana'].includes(wallet.wallet_type)) throw new Error(`Unknown wallet type for wallet row ${wallet.id}.`);
  }
  const membership = process.env.DISCORD_BOT_TOKEN ? await discordMembers(opts.server, process.env.DISCORD_BOT_TOKEN)
    .catch(error => { warnings.push(`Discord membership and current roles unavailable: ${error.message}`); return null; }) : null;
  if (!membership) warnings.push('Current Discord role comparison is unavailable.');
  else if (membership.rankRoles.size < 5) warnings.push('Some named Comrade rank roles were not found in this Discord server; role comparison is unavailable.');
  let ordnet;
  if (btcProvider === 'ordnet') {
    ordnet = await ordnetOwnerIndex([slugs.pizza,slugs.yonder]);
    const cached = checked(await db.from('ordinal_collections').select('slug,item_count')
      .in('slug',[slugs.pizza,slugs.yonder]), 'ordinal_collections').data;
    for (const slug of [slugs.pizza,slugs.yonder]) {
      const prior = cached.find(row => row.slug === slug);
      if (prior && prior.item_count !== ordnet.get(slug).count)
        warnings.push(`${slug} live ord.net collection size differs from the bot's cached catalog (${ordnet.get(slug).count} vs ${prior.item_count}).`);
    }
  } else {
    for (const slug of [slugs.pizza, slugs.yonder]) {
      const record = await api(`https://api.secretkeylabs.io/v1/ordinals/collections/${encodeURIComponent(slug)}`,
        { 'x-api-key': process.env.XVERSE_API_KEY, Accept: 'application/json' }, `Xverse collection ${slug}`);
      if (record.id !== slug) throw new Error(`Xverse collection ${slug} returned a different ID.`);
    }
  }
  const ethCache = new Map(), btcCache = new Map();
  const rows = [];
  let processed = 0;
  for (const user of [...users.values()].sort((a,b) => a.id.localeCompare(b.id))) {
    const ethWallets = user.wallets.filter(w => w.wallet_type === 'evm');
    const btcWallets = user.wallets.filter(w => w.wallet_type === 'bitcoin');
    const ethDetails = [];
    for (const wallet of ethWallets) {
      const address = wallet.address.toLowerCase();
      if (!ethCache.has(address)) ethCache.set(address, Promise.all([ethCount(data,address,slugs.cdc),ethCount(data,address,slugs.cotd)]));
      const [cdc,cotd] = await ethCache.get(address);
      ethDetails.push({ address: wallet.address, cdc, cotd });
    }
    const btcDetails = [];
    const pizzaIds = new Set(), yonderIds = new Set();
    for (const wallet of btcWallets) {
      let ownedPizza, ownedYonder;
      if (btcProvider === 'ordnet') {
        ownedPizza = ordnet.get(slugs.pizza).owners.get(wallet.address) || new Set();
        ownedYonder = ordnet.get(slugs.yonder).owners.get(wallet.address) || new Set();
      } else {
        if (!btcCache.has(wallet.address)) btcCache.set(wallet.address, Promise.all([
          btcIds(wallet.address,slugs.pizza,process.env.XVERSE_API_KEY),
          btcIds(wallet.address,slugs.yonder,process.env.XVERSE_API_KEY),
        ]));
        [ownedPizza,ownedYonder] = await btcCache.get(wallet.address);
      }
      for (const id of ownedPizza) pizzaIds.add(id);
      for (const id of ownedYonder) yonderIds.add(id);
      btcDetails.push({ address: wallet.address, pizza: ownedPizza.size, yonder: ownedYonder.size });
    }
    const cdc = ethDetails.reduce((n,w) => n+w.cdc,0), cotd = ethDetails.reduce((n,w) => n+w.cotd,0);
    const pizza = pizzaIds.size, yonder = yonderIds.size;
    const member = membership?.members.get(user.id);
    const activeStored = user.roles.filter(role => role.status === 'active').map(role => role.role_name).filter(Boolean);
    const role = membership?.rankRoles.size === 5 ? currentRole(member, membership.rankRoles) : null;
    const dates = [...user.wallets.map(w => w.created_at), ...user.roles.map(r => r.created_at || r.verified_at)];
    const recent = [...user.wallets.map(w => w.last_verified_at), ...user.roles.map(r => r.last_checked || r.updated_at)];
    const names = [...user.roles].sort((a,b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const username = member?.user?.username || names.find(r => r.user_name)?.user_name
      || user.wallets.find(w => w.user_name)?.user_name || '';
    const derived = derive(cdc,cotd,pizza,yonder);
    rows.push({
      discord_user_id: user.id, discord_username: username,
      discord_display_name: member?.nick || member?.user?.global_name || '',
      currently_in_server: membership ? !!member : null,
      current_discord_role: role === null ? '' : role,
      stored_active_role_names: [...new Set(activeStored)].sort(),
      calculated_role: derived.calculated_role,
      role_matches: member && membership.rankRoles.size === 5 ? role === derived.calculated_role : null,
      eth_wallets: ethDetails.map(w => w.address), btc_wallets: btcDetails.map(w => w.address),
      eth_wallet_counts: ethDetails, btc_wallet_counts: btcDetails,
      eth_wallet_count: ethDetails.length, btc_wallet_count: btcDetails.length,
      cdc_count: cdc, cotd_count: cotd, pizza_count: pizza, yonder_count: yonder,
      ...derived, verification_date: minDate(dates), last_verification_date: maxDate(recent),
    });
    processed++;
    if (processed % 25 === 0) console.error(`Processed ${processed}/${users.size} Discord identities.`);
  }
  const generatedAt = new Date().toISOString();
  if (membership) {
    const mismatches = rows.filter(r => r.currently_in_server && r.role_matches === false).length;
    warnings.push(`${mismatches} current Discord Comrade roles differ from calculated rank.`);
  }
  const outputDir = path.resolve(opts['out-dir'] || path.join(__dirname,'..','temp','holder-analysis'));
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const stamp = generatedAt.replace(/[:.]/g,'-');
  const csvPath = path.join(outputDir, `holders-${opts.server}-${stamp}.csv`);
  const mdPath = path.join(outputDir, `holders-${opts.server}-${stamp}.md`);
  const csv = [CSV_FIELDS.join(','), ...rows.map(row => CSV_FIELDS.map(field => csvCell(row[field])).join(','))].join('\r\n') + '\r\n';
  const md = summary(rows,{ generated_at: generatedAt, server_id: opts.server, membership_available: !!membership,
    btc_source: btcProvider, slugs, warnings });
  fs.writeFileSync(csvPath, csv, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(mdPath, md, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ csv: csvPath, summary: mdPath, users: rows.length, warnings }));
}

main().catch(error => { console.error(`Holder export failed: ${error.message}`); process.exitCode = 1; });
