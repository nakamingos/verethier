import { WalletCheckService } from '../src/services/wallet-check.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { walletCheckNetwork, walletMatchesRule } from '../src/utils/wallet-check.util';
const address='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
const rule:any={id:1,server_id:'server',asset_type:'nft',chain_id:1,min_items:5,contract_address:'0x'+'3'.repeat(40)};
function fixture(rules=[rule]) {
 const rows={verifier_wallet_dormancy:[],user_wallets:[address,other].map(address=>({address,user_id:'member',wallet_type:'evm',last_verified_at:'2026-11-09T10:00:00Z',evm_chain_ids:null}))};
 const db:any={rpc:jest.fn(async()=>({data:true,error:null})),from:jest.fn(table=>{
  let filtered=[...rows[table]],error=null;
  const q:any={select:()=>q,eq:(key,value)=>{filtered=filtered.filter(row=>row[key]===value);return q;},in:(key,values)=>{filtered=filtered.filter(row=>values.includes(row[key]));return q;},then:(resolve)=>resolve({data:filtered,error})};return q;
 })};
 const mappings:any={getRoleMappings:jest.fn(async()=>rules)};
 const service=new WalletCheckService(db,mappings),context:any={checks:new Map(),ordinalMode:'scheduled'};
 const counter=jest.fn(async(_rule:any,_address:string):Promise<bigint>=>0n);
 const read=async(r=rule,addresses=[address],count=0n)=>{const active=await service.allowed(r,addresses,context);await service.observe(r,active,count,context,counter);return active;};
 return {db,rows,mappings,service,context,counter,read};
}
describe('Wallet dormancy completeness and retained proof',()=>{
 it('marks after one complete zero check without deleting or updating the wallet',async()=>{
  const f=fixture();await f.read();expect(f.db.rpc).not.toHaveBeenCalled();await f.service.finish(f.context);
  expect(f.db.rpc).toHaveBeenCalledWith('verifier_mark_wallet_dormant',expect.objectContaining({p_user:'member',p_server:'server',p_network:'ethereum',p_proven_at:'2026-11-09T10:00:00Z',p_rules:[rule]}));
  expect(f.counter).not.toHaveBeenCalled();expect(f.rows.user_wallets).toHaveLength(2);
 });
 it('does not mark stale zeros after slow unrelated work',async()=>{
  let clock=0;const now=jest.spyOn(Date,'now').mockImplementation(()=>clock);
  try {const f=fixture();await f.read();clock=61000;await f.service.finish(f.context);expect(f.db.rpc).not.toHaveBeenCalled();}
  finally {now.mockRestore();}
 });
 it('does not renew a fast zero timestamp while waiting for another wallet',async()=>{
  let clock=0;const now=jest.spyOn(Date,'now').mockImplementation(()=>clock);
  try {
   const f=fixture();let release:(count:bigint)=>void;
   f.counter.mockImplementation(async(_rule,a)=>a===address?0n:new Promise<bigint>(resolve=>release=resolve));
   const pending=f.read(rule,[address,other],2n);await new Promise(resolve=>setImmediate(resolve));clock=61000;release(2n);await pending;
   await f.service.finish(f.context);expect(f.db.rpc).not.toHaveBeenCalled();
  } finally {now.mockRestore();}
 });
 it('keeps unknown proof dates active rather than classifying them',async()=>{
  const f=fixture();(f.rows.user_wallets[0] as any).last_verified_at=null;await f.read();await f.service.finish(f.context);expect(f.db.rpc).not.toHaveBeenCalled();
 });
 it('does not delay interactive verification with additional emptiness scans',async()=>{
  const f=fixture([rule,{...rule,id:2}]);delete f.context.ordinalMode;await f.read();await f.service.finish(f.context);expect(f.counter).not.toHaveBeenCalled();expect(f.db.rpc).not.toHaveBeenCalled();
 });
 it('does not add individual wallet scans to interactive positive aggregate checks',async()=>{
  const f=fixture();delete f.context.ordinalMode;await f.read(rule,[address,other],2n);await f.service.finish(f.context);expect(f.counter).not.toHaveBeenCalled();expect(f.db.rpc).not.toHaveBeenCalled();
 });
 it('keeps one relevant item active even when the role needs five',async()=>{
  const f=fixture();await f.read(rule,[address],1n);await f.service.finish(f.context);expect(f.db.rpc).not.toHaveBeenCalled();expect(f.mappings.getRoleMappings).not.toHaveBeenCalled();
 });
 it('checks skipped requirements before deciding the network is empty',async()=>{
  const second={...rule,id:2,contract_address:other},f=fixture([rule,second]);await f.read();await f.service.finish(f.context);
  expect(f.counter).toHaveBeenCalledWith(second,address);expect(f.db.rpc).toHaveBeenCalled();
 });
 it('retains active state when another requirement has holdings',async()=>{
  const f=fixture([rule,{...rule,id:2}]);f.counter.mockResolvedValue(1n);await f.read();await f.service.finish(f.context);expect(f.db.rpc).not.toHaveBeenCalled();
 });
 it('never calls a skipped wallet empty or treats provider failure as zero',async()=>{
  const f=fixture([rule,{...rule,id:2}]);f.counter.mockRejectedValue(new Error('Incomplete inventory'));await f.read();await f.service.finish(f.context);expect(f.db.rpc).not.toHaveBeenCalled();
  const g=fixture();await g.service.allowed(rule,[address],g.context);await g.service.finish(g.context);expect(g.db.rpc).not.toHaveBeenCalled();
 });
 it('rechecks a changed rule rather than trusting its old zero',async()=>{
  const f=fixture();await f.read();f.mappings.getRoleMappings.mockResolvedValue([{...rule,token_ids:['12']}]);f.counter.mockResolvedValue(1n);await f.service.finish(f.context);expect(f.counter).toHaveBeenCalled();expect(f.db.rpc).not.toHaveBeenCalled();
 });
 it('requires successful coverage of all Ethereum protocols but not another chain',async()=>{
  const ethscript={...rule,id:2,asset_type:'ethscription',slug:'nakamingos'},base={...rule,id:3,chain_id:8453};
  const f=fixture([rule,ethscript,base]);await f.read();await f.service.finish(f.context);expect(f.counter).toHaveBeenCalledWith(ethscript,address);expect(f.counter).not.toHaveBeenCalledWith(base,address);
 });
 it('isolates an extra empty wallet without changing aggregate eligibility',async()=>{
  const f=fixture();f.counter.mockImplementation(async(_rule,a)=>a===other?0n:2n);await f.read(rule,[address,other],2n);await f.service.finish(f.context);
  expect(f.db.rpc).toHaveBeenCalledTimes(1);expect(f.db.rpc.mock.calls[0][1].p_address).toBe(other);
 });
 it('does not classify a wallet whose individual contribution is unavailable',async()=>{
  const f=fixture();f.counter.mockRejectedValue(new Error('provider down'));await f.read(rule,[address,other],2n);await f.service.finish(f.context);expect(f.db.rpc).not.toHaveBeenCalled();
 });
 it('filters only the affected community and network',async()=>{
  const f=fixture();f.rows.verifier_wallet_dormancy.push({address,user_id:'member',server_id:'server',network:'ethereum'});
  expect(await f.service.allowed(rule,[address],f.context)).toEqual([]);
  expect(await f.service.allowed({...rule,chain_id:8453},[address],f.context)).toEqual([address]);
  expect(await f.service.allowed({...rule,server_id:'another'},[address],f.context)).toEqual([address]);
 });
 it('exports can fresh-check dormant saved wallets without waking or marking them',async()=>{
  const f=fixture();f.context.freshExport=true;f.rows.verifier_wallet_dormancy.push({address,server_id:'server',network:'ethereum'});
  expect(await f.read()).toEqual([address]);await f.service.finish(f.context);expect(f.db.from).not.toHaveBeenCalled();expect(f.db.rpc).not.toHaveBeenCalled();
 });
 it('captures proof before reading holdings and retains that timestamp after a newer signature',async()=>{
  const f=fixture();await f.service.allowed(rule,[address],f.context);f.rows.user_wallets[0]={...f.rows.user_wallets[0],last_verified_at:'2026-11-09T11:00:00Z'};
  await f.service.observe(rule,[address],0n,f.context,f.counter);await f.service.finish(f.context);
  expect(f.db.rpc.mock.calls[0][1].p_proven_at).toBe('2026-11-09T10:00:00Z');
 });
 it('supplies the bulk worker lease for the database cancellation guard',async()=>{
  const f=fixture();f.context.dormancyJobId='job';f.context.dormancyWorker='worker';await f.read();await f.service.finish(f.context);expect(f.db.rpc.mock.calls[0][1]).toMatchObject({p_job:'job',p_worker:'worker'});
 });
 it('recommends review of extra dormant wallets while retaining one representative',async()=>{
  const f=fixture();f.rows.verifier_wallet_dormancy.push(...[address,other].map(address=>({address,user_id:'member',server_id:'server',network:'ethereum'})));
  const states=await f.service.statuses('member','server');expect(states.map(s=>s.review_recommended)).toEqual([false,true]);
  f.rows.verifier_wallet_dormancy.shift();expect((await f.service.statuses('member','server'))[0].review_recommended).toBe(true);
 });
 it('does not reveal hidden additional wallets through the admin review flag',async()=>{
  const f=fixture();f.rows.verifier_wallet_dormancy.push({address:other,user_id:'member',server_id:'server',network:'ethereum'});
  const states=await f.service.statuses('member','server',[other]);expect(states).toHaveLength(1);expect(states[0].review_recommended).toBe(false);
 });
 it('does not probe Ordinals with a non-Taproot Stamps wallet',()=>{
  expect(walletMatchesRule({asset_type:'ordinal'},'1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe(false);
  expect(walletMatchesRule({asset_type:'stamp'},'1BoatSLRHtKNngkdXEeobR76b53LETtpyT')).toBe(true);
  expect(walletCheckNetwork({asset_type:'ordinal'})).toBe(walletCheckNetwork({asset_type:'stamp'}));
 });
 it('does not replace an aggregate provider count with the sum of individual observations',async()=>{
  const f=fixture(),nft:any={count:jest.fn(async(_r,addresses)=>addresses.length===2?2n:2n)};
  const ownership=new AssetOwnershipService({} as any,nft,undefined,undefined,undefined,undefined,undefined,f.service);
  expect(await ownership.count(rule,[address,other],f.context)).toBe(2n);expect(nft.count).toHaveBeenCalledTimes(3);
 });
});
