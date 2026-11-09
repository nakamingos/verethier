import { VerificationEngine } from '../src/services/verification-engine.service';
import { NftCheckContext } from '../src/services/nft-ownership.service';
const base:any={server_id:'guild',role_id:'holder',channel_id:'verify',min_items:2};
const eth:any={...base,id:1,asset_type:'ethscription',slug:'nakamingos'};
const ord:any={...base,id:2,asset_type:'ordinal',slug:'dabl'};
function fixture(ethCount=2n,ordinalCount=0n){
 const ownership:any={count:jest.fn(async(rule)=>rule.asset_type==='ethscription'?ethCount:ordinalCount),checkDetails:()=>undefined,
  matchingAssets:jest.fn(async(rule)=>new Map(Array.from({length:Number(rule.asset_type==='ethscription'?ethCount:ordinalCount)},(_,i)=>[rule.asset_type+i,1n])))};
 const rules=[eth,ord],db:any={getRoleMappings:async()=>rules};
 const engine=new VerificationEngine(db,ownership,{getUserAddresses:async()=>['wallet']} as any,{allowedAddresses:async(_server,addresses)=>addresses} as any);
 return {ownership,engine,rules};
}
describe('Database-backed qualification before bulk Ordinals scans',()=>{
 it('grants through sufficient database holdings without requesting Ordinals',async()=>{
  const f=fixture();const context:NftCheckContext={checks:new Map(),ordinalMode:'scheduled',bulkGrantOnly:true};
  const result=await f.engine.evaluateRole('member','guild','holder',context);
  expect(result.status).toBe('passed');expect(result.results.every(r=>r.rule.asset_type==='ethscription')).toBe(true);
  expect(f.ownership.count.mock.calls.some(([r])=>r.asset_type==='ordinal')).toBe(false);
 });
 it('still combines both protocols when database holdings alone are insufficient',async()=>{
  const f=fixture(1n,1n);const result=await f.engine.evaluateRole('member','guild','holder',{checks:new Map(),bulkGrantOnly:true});
  expect(result.status).toBe('passed');expect(f.ownership.count.mock.calls.some(([r])=>r.asset_type==='ordinal')).toBe(true);
 });
 it('does not turn a failed database-only subset into a complete role failure',async()=>{
  const f=fixture(0n,0n);const result=await f.engine.evaluateRole('member','guild','holder',{checks:new Map(),bulkGrantOnly:true});
  expect(result.status).toBe('failed');expect(f.ownership.count.mock.calls.some(([r])=>r.asset_type==='ordinal')).toBe(true);
 });
 it('preserves uncertainty when the remaining Ordinals requirement is unavailable',async()=>{
  const f=fixture(0n,0n);f.ownership.count.mockImplementation(async rule=>{if(rule.asset_type==='ordinal')throw new Error('Provider unavailable');return 0n;});
  expect((await f.engine.evaluateRole('member','guild','holder',{checks:new Map(),bulkGrantOnly:true})).status).toBe('unavailable');
 });
 it('keeps complete evaluation for reconciliation and ordinary callers',async()=>{
  const f=fixture();await f.engine.evaluateRole('member','guild','holder',{checks:new Map(),ordinalMode:'scheduled'});
  expect(f.ownership.count.mock.calls.some(([r])=>r.asset_type==='ordinal')).toBe(true);
 });
});
