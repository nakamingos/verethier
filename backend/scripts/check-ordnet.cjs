// Read-only provider check. Authentication signs login messages, never transactions.
const { resolve } = require('node:path');
require('dotenv').config({ path: resolve(__dirname, '../.env.ordnet') });
require('dotenv').config({ path: resolve(__dirname, '../.env') });
const { OrdnetApiService } = require('../dist/services/ordnet-api.service');
const { OrdnetOwnershipService } = require('../dist/services/ordnet-ownership.service');
const { normalizeBitcoinAddress } = require('../dist/utils/wallet-address.util');
const { ordinalCollectionId } = require('../dist/utils/ordinal-rule.util');

async function main() {
  const collections = [];
  const wallets = [];
  for (let i=2;i<process.argv.length;i+=2) {
    if (!process.argv[i+1]) throw new Error('Use --collection SLUG and/or --wallet BC1P_ADDRESS.');
    if (process.argv[i] === '--collection') collections.push(ordinalCollectionId(process.argv[i+1]));
    else if (process.argv[i] === '--wallet') wallets.push(normalizeBitcoinAddress(process.argv[i+1]));
    else throw new Error('Use --collection SLUG and/or --wallet BC1P_ADDRESS.');
  }
  if (!collections.length) collections.push('pizza-comrades');
  if (!wallets.length) wallets.push('bc1pqq7gz5dnkmqa2w4c8tgt8j0wk2zl4umh49kmctykuf9njugp785srx2arl');
  const service = new OrdnetOwnershipService(new OrdnetApiService());
  const context = { checks: new Map() };
  for (const slug of new Set(collections)) {
    const started = Date.now();
    await service.prepareRule(slug);
    const snapshot = await service.snapshot(slug, context);
    const unknownOwners = [...snapshot.items.values()].filter(item=>item.owner===null).length;
    const missingTraits = [...snapshot.items.values()].filter(item=>item.traits===null).length;
    const traitBearingItems = [...snapshot.items.values()].filter(item=>item.traits?.length).length;
    const targets = new Set(wallets);
    const ownedTraitCounts = new Map();
    for (const item of snapshot.items.values()) {
      if (!targets.has(item.owner)) continue;
      for (const trait of item.traits || []) {
        const key = JSON.stringify([trait.type,trait.value]);
        ownedTraitCounts.set(key,(ownedTraitCounts.get(key)||0)+1);
      }
    }
    const ownedCount = unknownOwners ? null : String(await service.count(slug,wallets,context));
    console.log(JSON.stringify({ collection:slug, collectionItems:snapshot.items.size, wallets, ownedCount,
      unknownOwners, missingTraits, traitBearingItems,
      ownedTraitCounts:[...ownedTraitCounts].map(([key,count])=>{const [type,value]=JSON.parse(key);return {type,value,count};}),
      ownershipCheck:unknownOwners ? 'unavailable: collection contains unknown owners' : 'complete',
      seconds:Math.round((Date.now()-started)/1000) },null,2));
    if (unknownOwners) process.exitCode = 1;
  }
}

main().catch(error=>{
  // Never print network payloads, session tokens, keys, or signing-library errors.
  const safe = typeof error.message === 'string' && /^(ord\.net |Ordinals verification |This collection |Enter one |Use --)/.test(error.message);
  console.error(safe ? error.message : 'ord.net provider check failed. Verify the wallet configuration and retry.');
  process.exitCode = 1;
});
