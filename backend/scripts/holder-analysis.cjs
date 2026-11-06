const RANKS = [
  ['Major', 69], ['Leutnant', 42], ['Korporal', 10], ['Gefreiter', 5], ['Comrade', 1],
];

function rank(total) {
  return RANKS.find(([, minimum]) => total >= minimum)?.[0] || 'None';
}

function entitlement(total) {
  return total >= 69 ? 5 : total >= 42 ? 4 : total >= 10 ? 3 : total >= 5 ? 2 : total >= 2 ? 1 : 0;
}

function derive(cdc, cotd, pizza, yonder) {
  const eth = cdc + cotd;
  const total = eth + pizza;
  const rankEntitlement = entitlement(total);
  const maxMigratable = Math.min(eth, Math.max(total - 1, 0));
  const effective = Math.min(rankEntitlement, maxMigratable);
  return {
    eth_comrades: eth, pizza_comrades: pizza, total_comrades: total,
    calculated_role: rank(total), rank_entitlement: rankEntitlement,
    migratable_eth_assets: eth, max_migratable_while_retaining_one: maxMigratable,
    effective_migration_access: effective, has_yonder: yonder > 0,
    yonder_entitlement: yonder, combined_launch_access_ceiling: effective + yonder,
  };
}

const sum = (rows, field) => rows.reduce((n, row) => n + row[field], 0);
const count = (rows, predicate) => rows.filter(predicate).length;
const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map(row => `| ${row.join(' | ')} |`),
].join('\n');

function summary(rows, meta) {
  const lines = [
    '# Verified holder analysis', '',
    `Generated: ${meta.generated_at}`, `Discord server ID: ${meta.server_id}`, '',
    'Counts are a current ownership snapshot for explicitly linked wallets. Access counts are ceilings, not predicted participation or guaranteed usage.', '',
    '## A. Discord verification coverage', '',
    `- Total on-record Discord identities: ${rows.length}`,
    `- Users still in server: ${meta.membership_available ? count(rows, r => r.currently_in_server === true) : 'Unavailable'}`,
    `- Connected ETH wallets: ${sum(rows, 'eth_wallet_count')}`,
    `- Connected BTC wallets: ${sum(rows, 'btc_wallet_count')}`,
    `- ETH only: ${count(rows, r => r.eth_wallet_count > 0 && r.btc_wallet_count === 0)}`,
    `- BTC only: ${count(rows, r => r.btc_wallet_count > 0 && r.eth_wallet_count === 0)}`,
    `- Both: ${count(rows, r => r.eth_wallet_count > 0 && r.btc_wallet_count > 0)}`,
    `- Neither: ${count(rows, r => r.eth_wallet_count === 0 && r.btc_wallet_count === 0)}`, '',
    '## B. Verified holdings', '',
    `- CDC: ${sum(rows, 'cdc_count')}`,
    `- CotD: ${sum(rows, 'cotd_count')}`,
    `- Pizza: ${sum(rows, 'pizza_count')}`,
    `- YONDER: ${sum(rows, 'yonder_count')}`,
    `- Comrades excluding YONDER: ${sum(rows, 'total_comrades')}`, '',
    '## C. Role distribution', '',
  ];
  const bands = [
    ['Comrade, 1', r => r.total_comrades === 1],
    ['Comrade, 2–4', r => r.total_comrades >= 2 && r.total_comrades <= 4],
    ['Gefreiter, 5–9', r => r.total_comrades >= 5 && r.total_comrades <= 9],
    ['Korporal, 10–41', r => r.total_comrades >= 10 && r.total_comrades <= 41],
    ['Leutnant, 42–68', r => r.total_comrades >= 42 && r.total_comrades <= 68],
    ['Major, 69+', r => r.total_comrades >= 69],
  ];
  lines.push(table(['Band', 'Users', 'Comrades', 'CDC', 'CotD', 'Pizza'], bands.map(([label, test]) => {
    const group = rows.filter(test);
    return [label, group.length, ...['total_comrades','cdc_count','cotd_count','pizza_count'].map(field => sum(group, field))];
  })), '', `- No Comrades: ${count(rows, r => r.total_comrades === 0)}`, '', '## D. Migration access', '');
  lines.push(table(['Effective access', 'Users'], [0,1,2,3,4,5].map(n => [n, count(rows, r => r.effective_migration_access === n)])), '');
  let cumulative = 0;
  lines.push(table(['Round', 'Additional spots', 'Cumulative spots'], [1,2,3,4,5].map(n => {
    const additional = count(rows, r => r.effective_migration_access >= n);
    cumulative += additional;
    return [n, additional, cumulative];
  })), '', '## E. Pizza impact', '');
  const without = rows.map(r => ({ row: r, prior: derive(r.cdc_count, r.cotd_count, 0, r.yonder_count) }));
  const promoted = name => count(without, ({row, prior}) => row.calculated_role === name && rankIndex(prior.calculated_role) < rankIndex(name));
  const rankUpNoCapacity = count(without, ({row, prior}) => rankIndex(row.calculated_role) > rankIndex(prior.calculated_role)
    && row.effective_migration_access === prior.effective_migration_access);
  lines.push(
    `- From 1 ETH Comrade to 2+ total with Pizza: ${count(rows, r => r.eth_comrades === 1 && r.total_comrades >= 2)}`,
    `- Newly gaining effective Migration eligibility: ${count(without, ({row, prior}) => prior.effective_migration_access === 0 && row.effective_migration_access > 0)}`,
    ...['Gefreiter','Korporal','Leutnant','Major'].map(name => `- Promoted to ${name}: ${promoted(name)}`),
    `- Rank increased, effective capacity unchanged: ${rankUpNoCapacity}`,
    `- Extra theoretical access: ${without.reduce((n, {row, prior}) => n + row.rank_entitlement - prior.rank_entitlement, 0)}`,
    `- Extra effective access: ${without.reduce((n, {row, prior}) => n + row.effective_migration_access - prior.effective_migration_access, 0)}`, '',
    table(['Measure', 'Without Pizza', 'With Pizza'], [
      ['Users with any effective Migration access',
        count(without, ({prior}) => prior.effective_migration_access > 0),
        count(rows, r => r.effective_migration_access > 0)],
      ...['Comrade','Gefreiter','Korporal','Leutnant','Major'].map(name => [name,
        count(without, ({prior}) => prior.calculated_role === name),
        count(rows, r => r.calculated_role === name)]),
    ]), '',
    '## F. YONDER distribution and overlap', '',
  );
  const holders = rows.filter(r => r.yonder_count > 0);
  lines.push(
    `- YONDER pieces: ${sum(rows, 'yonder_count')}`,
    `- Holders: ${holders.length}`,
    `- Average per holder: ${holders.length ? (sum(holders, 'yonder_count') / holders.length).toFixed(2) : '0.00'}`,
    `- Maximum per holder: ${Math.max(0, ...holders.map(r => r.yonder_count))}`,
    ...[['CDC',r=>r.cdc_count>0],['CotD',r=>r.cotd_count>0],['Pizza',r=>r.pizza_count>0],
      ['any Comrade',r=>r.total_comrades>0],['no Comrade',r=>r.total_comrades===0],
      ['Migration access',r=>r.effective_migration_access>0],
      ['no Migration access',r=>r.effective_migration_access===0]]
      .map(([label,test]) => `- YONDER holders with ${label}: ${count(holders,test)}`), '',
    table(['Access overlap', 'Users'], [
      ['Migration only',r=>r.effective_migration_access>0 && !r.has_yonder],
      ['YONDER only',r=>r.effective_migration_access===0 && r.has_yonder],
      ['Both',r=>r.effective_migration_access>0 && r.has_yonder],
      ['Neither',r=>r.effective_migration_access===0 && !r.has_yonder],
    ].map(([label,test]) => [label,count(rows,test)])), '',
    `- Verified Migration access ceiling: ${sum(rows, 'effective_migration_access')}`,
    `- Verified YONDER entitlements: ${sum(rows, 'yonder_entitlement')}`,
    `- Verified combined launch access ceiling: ${sum(rows, 'combined_launch_access_ceiling')}`, '',
    '## G. Multi-wallet aggregation', '',
    `- Users with 2+ ETH wallets: ${count(rows,r=>r.eth_wallet_count>1)}`,
    `- Users with 2+ BTC wallets: ${count(rows,r=>r.btc_wallet_count>1)}`,
    `- Users with both: ${count(rows,r=>r.eth_wallet_count>0&&r.btc_wallet_count>0)}`,
    `- Raw ETH wallets: ${sum(rows,'eth_wallet_count')}`,
    `- Raw BTC wallets: ${sum(rows,'btc_wallet_count')}`,
    `- Unique Discord identities: ${rows.length}`,
    `- Extra wallets beyond the first linked wallet per identity: ${rows.reduce((n,r)=>n+Math.max(r.eth_wallet_count+r.btc_wallet_count-1,0),0)}`, '',
    '## H. Verification recency', '',
  );
  const now = Date.parse(meta.generated_at);
  const age = r => r.verification_date ? (now-Date.parse(r.verification_date))/86400000 : NaN;
  lines.push(table(['Verification age', 'Users'], [
    ['0–30 days',r=>age(r)>=0&&age(r)<=30],
    ['31–90 days',r=>age(r)>30&&age(r)<=90],
    ['91–180 days',r=>age(r)>90&&age(r)<=180],
    ['181–365 days',r=>age(r)>180&&age(r)<=365],
    ['Over 365 days',r=>age(r)>365],
    ['Unavailable',r=>!r.verification_date],
  ].map(([label,test])=>[label,count(rows,test)])), '');
  for (const days of [30,90,180]) lines.push(`- Verified/updated within ${days} days: ${count(rows,r=>r.last_verification_date
    && now-Date.parse(r.last_verification_date)>=0 && now-Date.parse(r.last_verification_date)<=days*86400000)}`);
  lines.push(`- No verification timestamp: ${count(rows,r=>!r.verification_date)}`);
  lines.push(`- Still in server: ${meta.membership_available ? count(rows,r=>r.currently_in_server===true) : 'Unavailable'}`, '',
    '## I. Participation signals', '',
    `- All on-record verified users: ${rows.length}`,
    `- Currently in server: ${meta.membership_available ? count(rows,r=>r.currently_in_server===true) : 'Unavailable'}`,
    `- Any Migration access: ${count(rows,r=>r.effective_migration_access>0)}`,
    `- Any YONDER entitlement: ${holders.length}`,
    `- Either: ${count(rows,r=>r.effective_migration_access>0||r.has_yonder)}`,
    `- Both: ${count(rows,r=>r.effective_migration_access>0&&r.has_yonder)}`, '',
    '## Data notes', '',
    `- ETH collection slugs: CDC=${meta.slugs.cdc}, CotD=${meta.slugs.cotd}. BTC collection IDs: Pizza=${meta.slugs.pizza}, YONDER=${meta.slugs.yonder}.`,
    '- ETH counts include marketplace escrow when owner is the known marketplace address and prevOwner is the linked wallet, as in bot verification.',
    `- Current holdings were queried live from the Ethscriptions data source and ${meta.btc_source || 'the Ordinals provider'}; the bot stores wallet links and role checks, not durable collection balances.`,
    '- Users with only a linked Solana wallet appear in the ETH/BTC "neither" group.',
    '- Verification date is the earliest on-record wallet/role timestamp, which may postdate the original verification after a transfer or reactivation.',
    '- Last-check timestamps can be advanced by scheduled bot checks; recency is not a measure of Discord activity or event participation.',
    '- Current role is read from Discord when available; stored role history is retained separately and may be stale.',
    ...meta.warnings.map(w => `- WARNING: ${w}`), ''
  );
  return lines.join('\n');
}

function rankIndex(name) { return ['None','Comrade','Gefreiter','Korporal','Leutnant','Major'].indexOf(name); }
function csvCell(value) {
  const content = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
  return '"' + content.replace(/^\s*[=+@-]/, match => "'" + match).replace(/"/g,'""') + '"';
}

module.exports = { rank, entitlement, derive, summary, csvCell };
