// Load the project-scoped production token locally without printing it or
// putting it in command arguments. The global source-account login is retained.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(root, '.env') });
const token = process.env.SUPABASE_TARGET_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;
let ref;
try { ref = new URL(process.env.DB_SUPABASE_URL).hostname.match(/^([a-z]{20})\.supabase\.co$/)?.[1]; }
catch { /* Report a configuration error below, without exposing credentials. */ }
let linked = '';
try { linked = fs.readFileSync(path.join(root, 'supabase/.temp/project-ref'), 'utf8').trim(); }
catch { /* Missing CLI metadata is handled by the guard below. */ }
if (!token || !ref || linked !== ref) {
  console.error('Production token, database URL and linked project must be configured and agree.');
  process.exit(1);
}
const result = spawnSync('supabase', [...process.argv.slice(2), '--workdir', root], {
  env: { ...process.env, SUPABASE_ACCESS_TOKEN: token }, stdio: 'inherit',
});
if (result.error) console.error('Could not start the Supabase CLI.');
process.exit(result.status ?? 1);
