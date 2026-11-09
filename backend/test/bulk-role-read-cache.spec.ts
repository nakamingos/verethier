import { VerificationEngine } from '../src/services/verification-engine.service';
import { BulkRoleReadCache, bulkRoleChecks } from '../src/portal/bulk-role-read-cache';
import { OrdnetOwnershipService } from '../src/services/ordnet-ownership.service';
import vectors from './fixtures/bip322-taproot.json';
const wallet=vectors.valid[0].address;
const snapshot=()=>({slug:'sample',items:new Map(),fetched_at:new Date().toISOString()});
const deferred=<T>()=>{let resolve:(value:T)=>void;const promise=new Promise<T>(done=>resolve=done);return {promise,resolve:(value:T)=>resolve(value)};};

describe('Fresh shared bulk collection reads',()=>{
 afterEach(()=>jest.restoreAllMocks());
 it('shares one complete live scan across members without sharing wallets, blocks or result caches',async()=>{
  const cache=new BulkRoleReadCache();
  const get=jest.fn().mockResolvedValue({items:[{id:'a'.repeat(64)+'i0',inscriptionId:'a'.repeat(64)+'i0',inscription:100,collection:'sample',collections:[],owner:wallet,traits:[]}],pagination:{pageSize:100,hasNext:false,nextCursor:null}});
  const ordnet=new OrdnetOwnershipService({get} as any);
  const members=Array.from({length:6},()=>cache.member('job:rules:run'));
  const counts=[];for(const member of members)counts.push(await ordnet.count('sample',[wallet],member.context));
  expect(counts).toEqual(Array(6).fill(1n));expect(get).toHaveBeenCalledTimes(1);
  get.mockClear();for(let i=0;i<6;i++)await ordnet.count('sample',[wallet],{checks:new Map()});
  expect(get).toHaveBeenCalledTimes(6); // The prior per-member context path redownloads each time.
  members[0].context.checks.set('private',Promise.resolve(10n));
  expect(members[1].context.checks.has('private')).toBe(false);
  expect(members[1].context.userAddresses).toBeUndefined();expect(members[1].context.walletBlocks).toBeUndefined();
 });
 it('expires responses after one minute and reports when earlier eligibility has become stale',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const cache=new BulkRoleReadCache(),read=jest.fn().mockImplementation(async()=>snapshot());
  const first=cache.member('job:v1:start');
  await first.context.ordinalCollectionRead('sample',read);
  clock=59999;await cache.member('job:v1:start').context.ordinalCollectionRead('sample',read);expect(read).toHaveBeenCalledTimes(1);
  clock=60000;expect(first.isFresh()).toBe(false);
  const next=cache.member('job:v1:start');await next.context.ordinalCollectionRead('sample',read);
  expect(read).toHaveBeenCalledTimes(2);expect(next.isFresh()).toBe(true);
 });
 it('does not expire unrelated role evidence when an earlier collection becomes stale',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const cache=new BulkRoleReadCache(),member=cache.member('job:rules:run');
  await member.context.ordinalCollectionRead('old',async()=>snapshot());
  clock=30000;await member.context.ordinalCollectionRead('new',async()=>snapshot());
  clock=61000;
  expect(member.isFresh()).toBe(false);
  expect(member.isFresh(new Set(['old']))).toBe(false);
  expect(member.isFresh(new Set(['new']))).toBe(true);
  expect(member.isFresh(new Set())).toBe(true);
 });
 it('shares a long in-flight scan, starts expiry at completion, and clears responses on resume or retry',async()=>{
  let clock=0;jest.spyOn(Date,'now').mockImplementation(()=>clock);
  const cache=new BulkRoleReadCache(),pending=deferred<any>(),read=jest.fn(()=>pending.promise);
  const a=cache.member('job:v1:start'),first=a.context.ordinalCollectionRead('sample',read);
  clock=120000;const second=cache.member('job:v1:start').context.ordinalCollectionRead('sample',read);
  expect(second).toBe(first);expect(read).toHaveBeenCalledTimes(1);pending.resolve(snapshot());await first;
  expect(a.isFresh()).toBe(true);clock+=59999;expect(a.isFresh()).toBe(true);
  cache.clear('job');await cache.member('job:v1:start').context.ordinalCollectionRead('sample',read);expect(read).toHaveBeenCalledTimes(2);
  await cache.member('job:v1:resume').context.ordinalCollectionRead('sample',read);expect(read).toHaveBeenCalledTimes(3);
 });
 it('does not keep failed requests or let an unrelated failure invalidate known good evidence',async()=>{
  const cache=new BulkRoleReadCache(),a=cache.member('job:v1:start');
  await expect(a.context.ordinalCollectionRead('bad',async()=>{throw new Error('offline');})).rejects.toThrow('offline');
  await a.context.ordinalCollectionRead('good',async()=>snapshot());expect(a.isFresh()).toBe(true);
  const recovered=jest.fn(async()=>snapshot());await cache.member('job:v1:start').context.ordinalCollectionRead('bad',recovered);
  expect(recovered).toHaveBeenCalledTimes(1);
 });
});

describe('Bounded role prefetch',()=>{
 it('keeps three reads active, refills as soon as one finishes and preserves ordered results',async()=>{
  const tasks=Array.from({length:6},()=>deferred<string>()),started:string[]=[];
  const checks=bulkRoleChecks(['0','1','2','3','4','5'],id=>{started.push(id);return tasks[Number(id)].promise;});
  expect(started).toEqual(['0','1','2']);
  tasks[1].resolve('second');await checks.results.get('1');await Promise.resolve();
  expect(started).toEqual(['0','1','2','3']);
  tasks[0].resolve('first');tasks[2].resolve('third');tasks[3].resolve('fourth');
  await Promise.all([checks.results.get('0'),checks.results.get('2'),checks.results.get('3')]);
  tasks[4].resolve('fifth');tasks[5].resolve('sixth');await checks.done;
  expect((await checks.results.get('0')).value).toBe('first');
  expect((await checks.results.get('1')).value).toBe('second');
 });
 it('stops queued reads and contains failures without unhandled rejections',async()=>{
  const pending=deferred<string>();const read=jest.fn(id=>id==='0'?Promise.reject(new Error('offline')):pending.promise);
  const checks=bulkRoleChecks(['0','1','2','3'],read,2);checks.stop();pending.resolve('done');await checks.done;
  expect((await checks.results.get('0')).error).toBeInstanceOf(Error);
  expect(await checks.results.get('2')).toEqual({stopped:true});expect(read).toHaveBeenCalledTimes(2);
 });
});


describe('Validated rule reuse',()=>{
 it('avoids reloading server rules for each role and never includes a foreign-server definition',async()=>{
  const db={getRoleMappings:jest.fn(async()=>{throw new Error('Redundant rules read');})};
  const ownership={count:jest.fn(async()=>1n),checkDetails:()=>undefined};
  const engine=new VerificationEngine(db as any,ownership as any,{getUserAddresses:async()=>[wallet]} as any,
   {allowedAddresses:async(_server,addresses)=>addresses} as any);
  const rule:any={id:1,server_id:'guild',role_id:'holder',asset_type:'ordinal',slug:'sample',attribute_key:'ALL',attribute_value:'ALL',min_items:1};
  expect((await engine.evaluateRole('member','guild','holder',{checks:new Map()},[rule])).status).toBe('passed');
  expect((await engine.evaluateRole('member','guild','holder',{checks:new Map()},[{...rule,server_id:'other-guild'}])).status).toBe('failed');
  expect(db.getRoleMappings).not.toHaveBeenCalled();expect(ownership.count).toHaveBeenCalledTimes(1);
 });
});
