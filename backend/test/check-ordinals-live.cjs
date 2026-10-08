// Explicit, read-only smoke test. Build first; these calls use backend API credits.
// Run from backend/: node test/check-ordinals-live.cjs
const assert = require('node:assert/strict');
const { OrdinalsOwnershipService } = require('../dist/services/ordinals-ownership.service');
const { EnvironmentConfig } = require('../dist/config/environment.config');
const vectors = require('./fixtures/bip322-taproot.json');

async function main() {
  assert.ok(EnvironmentConfig.XVERSE_API_KEY, 'Set XVERSE_API_KEY on the backend to run the live smoke test.');
  const service = new OrdinalsOwnershipService();
  const fields = await service.prepareRule('pizza-comrades');
  assert.equal(fields.asset_type, 'ordinal');
  assert.equal(fields.slug, 'pizza-comrades');
  assert.equal(fields.collection_name, 'Pizza Comrades');
  assert.equal(fields.chain_id, null);
  const rule = { ...fields, attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1 };
  const count = await service.count(rule, ['bc1pqq7gz5dnkmqa2w4c8tgt8j0wk2zl4umh49kmctykuf9njugp785srx2arl']);
  assert.ok(count > 0n, 'The known Pizza Comrades wallet must hold collection inscriptions.');
  assert.equal(await service.count(rule, [vectors.valid[0].address]), 0n);
  console.log(`PASS: Pizza Comrades metadata; holder count ${count}; empty test address count 0.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
