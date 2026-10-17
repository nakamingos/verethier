// Restricted database operations for the one-time pass, using the existing CLI
// login. No database passwords or service keys are retrieved or exported.
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const execute = promisify(execFile);
const literal = value => value == null ? 'NULL' : "'" + String(value).replace(/'/g, "''") + "'";

async function query(workdir, sql) {
  const directory = await mkdtemp(join(tmpdir(), 'bouncer-role-query-'));
  try {
    const file = join(directory, 'query.sql');
    await writeFile(file, sql, { mode: 0o600 });
    const { stdout } = await execute('supabase', ['db', 'query', '--linked', '--workdir', workdir, '--file', file],
      { timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.rows)) throw new Error('Unexpected CLI result.');
    return result.rows;
  } catch (error) {
    const status = String(error.stderr || error.stdout || '').match(/unexpected status (\d{3})/)?.[1];
    throw new Error(`Linked database query failed${status ? ` (HTTP ${status})` : ''}.`);
  }
  finally { await rm(directory, { recursive: true, force: true }); }
}

function linkedOrdinalGrantData(appDirectory, dataDirectory) {
  const app = sql => query(appDirectory, sql);
  const scalar = async sql => (await app(sql))[0].value;
  const inventories = new Map();
  const savedAddresses = new Map();
  const restrictions = new WeakMap();
  async function matching(addresses, slug = 'ALL', key = 'ALL', value = 'ALL') {
    if (!dataDirectory) throw new Error('A linked holdings database is required for combined Ethscription counts.');
    if (slug.includes(',')) throw new Error('Use one collection per rule.');
    addresses = [...new Set((Array.isArray(addresses) ? addresses : [addresses]).map(address => address.toLowerCase()))].sort();
    if (!addresses.length) return [];
    const cacheKey = JSON.stringify(addresses);
    if (!inventories.has(cacheKey)) {
      const wallets = addresses.map(literal).join(',');
      inventories.set(cacheKey, query(dataDirectory, `SELECT e."hashId", e.slug, a.values AS attributes
        FROM public.ethscriptions e LEFT JOIN public.attributes_new a ON a.sha = e.sha
        WHERE e.owner IN (${wallets}) OR (e.owner = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a' AND e."prevOwner" IN (${wallets}));`));
    }
    const rows = await inventories.get(cacheKey);
    const trait = key !== 'ALL' || value !== 'ALL';
    return [...new Set(rows.filter(row => (!slug || slug === 'ALL' || slug === 'all-collections' || row.slug === slug)
      && (!trait || (row.attributes && Object.entries(row.attributes).some(([type, entry]) =>
        (key === 'ALL' || type.toLowerCase() === key.toLowerCase())
        && (!value || value === 'ALL' || (entry != null && String(entry).toLowerCase() === value.toLowerCase()))))))
      .map(row => row.hashId.toLowerCase()))];
  }
  return {
    rules: serverId => app(`SELECT * FROM public.verifier_rules WHERE server_id = ${literal(serverId)} ORDER BY id;`),
    wallets: () => app("SELECT user_id, address FROM public.user_wallets WHERE wallet_type = 'bitcoin' ORDER BY id;"),
    addresses: { getUserAddresses: userId => {
      if (!savedAddresses.has(userId)) savedAddresses.set(userId,
        app(`SELECT address FROM public.user_wallets WHERE user_id = ${literal(userId)} ORDER BY created_at DESC;`).then(rows => rows.map(row => row.address)));
      return savedAddresses.get(userId);
    } },
    blocks: { allowedAddresses: async (serverId, addresses, context) => {
      if (!restrictions.has(context)) restrictions.set(context,
        app(`SELECT address FROM public.verifier_wallet_blocks WHERE server_id = ${literal(serverId)};`).then(rows => new Set(rows.map(row => row.address))));
      const blocked = await restrictions.get(context);
      return [...new Set(addresses.map(address => address.toLowerCase()))].filter(address => !blocked.has(address));
    } },
    data: { matchingAssetIdsWithCriteria: matching,
      checkAssetOwnershipWithCriteria: async (addresses, slug, key, value, minimum = 1) => {
        const ids = await matching(addresses, slug, key, value);
        return ids.length >= minimum ? ids.length : 0;
      } },
    db: {
      getOrdinalCollection: slug => scalar(`SELECT public.get_ordinal_collection(${literal(slug)}) AS value;`),
      replaceOrdinalCollection: (slug, fetchedAt, items) => scalar(`SELECT public.replace_ordinal_collection(${literal(slug)}, ${literal(fetchedAt)}::timestamptz, ${literal(JSON.stringify(items))}::jsonb) AS value;`),
      reserveOrdinalProviderRequest: () => scalar('SELECT public.reserve_ordinal_provider_request() AS value;'),
      trackRoleAssignment: assignment => app(`INSERT INTO public.verifier_user_roles AS previous
        (user_id, server_id, role_id, rule_id, user_name, server_name, role_name, verification_data, status, verified_at, last_checked, expires_at, updated_at)
        VALUES (${[assignment.userId, assignment.serverId, assignment.roleId, assignment.ruleId, assignment.userName,
          assignment.serverName, assignment.roleName].map(literal).join(',')}, ${literal(JSON.stringify(assignment.verificationData))}::jsonb, 'active', now(), now(), NULL, now())
        ON CONFLICT (user_id, server_id, role_id) DO UPDATE SET
          rule_id = EXCLUDED.rule_id, user_name = EXCLUDED.user_name, server_name = EXCLUDED.server_name, role_name = EXCLUDED.role_name,
          verification_data = coalesce(previous.verification_data, '{}'::jsonb) || EXCLUDED.verification_data,
          status = 'active', verified_at = CASE WHEN previous.status IN ('revoked', 'expired') THEN now() ELSE previous.verified_at END,
          last_checked = now(), expires_at = NULL, updated_at = now() RETURNING id;`),
    },
  };
}

module.exports = { linkedOrdinalGrantData };
