const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { derive, summary, csvCell } = require('../scripts/holder-analysis.cjs');

describe('holder analysis', () => {
  it('caps Migration by rank, ETH assets, and retaining a Comrade', () => {
    assert.equal(derive(1,0,0,0).effective_migration_access, 0);
    assert.equal(derive(1,1,0,0).effective_migration_access, 1);
    assert.deepEqual([derive(1,0,4,0).calculated_role,derive(1,0,4,0).effective_migration_access], ['Gefreiter',1]);
    assert.equal(derive(3,0,7,0).effective_migration_access, 3);
    assert.equal(derive(0,0,10,0).effective_migration_access, 0);
  });

  it('keeps YONDER outside Comrade rank and Migration capacity', () => {
    const result = derive(1,0,0,12);
    assert.equal(result.total_comrades, 1);
    assert.equal(result.calculated_role, 'Comrade');
    assert.equal(result.effective_migration_access, 0);
    assert.equal(result.yonder_entitlement, 12);
    assert.equal(result.combined_launch_access_ceiling, 12);
  });

  it('reports Pizza theoretical and effective gains separately', () => {
    const values = [
      { cdc_count:1,cotd_count:0,pizza_count:4,yonder_count:0 },
      { cdc_count:0,cotd_count:0,pizza_count:10,yonder_count:2 },
    ];
    const rows = values.map(v => ({ ...v, ...derive(v.cdc_count,v.cotd_count,v.pizza_count,v.yonder_count),
      eth_wallet_count:1,btc_wallet_count:1,currently_in_server:null,verification_date:'',last_verification_date:'' }));
    const report = summary(rows,{ generated_at:'2026-11-05T00:00:00Z',server_id:'123',membership_available:false,
      slugs:{cdc:'cdc',cotd:'cotd',pizza:'pizza-comrades',yonder:'yonder'},warnings:[] });
    assert.match(report, /Extra theoretical access: 5/);
    assert.match(report, /Extra effective access: 1/);
    assert.match(report, /Verified YONDER entitlements: 2/);
    assert.match(report, /Currently in server: Unavailable/);
  });

  it('escapes spreadsheet formulas in CSV cells', () => {
    assert.equal(csvCell('=HYPERLINK("bad")'), '"\'=HYPERLINK(""bad"")"');
  });
});
