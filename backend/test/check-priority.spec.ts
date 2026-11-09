import { checkPriority, CHECK_PRIORITY } from '../src/utils/check-priority.util';
import { VerificationEngine } from '../src/services/verification-engine.service';
const rules:any[]=CHECK_PRIORITY.map((network,id)=>({id:id+1,server_id:'server',role_id:'role',channel_id:'verify',min_items:2,
 asset_type:network==='ordinals'?'ordinal':network==='stamps'?'stamp':network==='solana'?'solana_nft':network==='ethscriptions'?'ethscription':'nft',
 chain_id:network==='robinhood'?4663:network==='base'?8453:1,slug:network}));
function fixture() {
 const engine=new VerificationEngine({getRoleMappings:async()=>rules} as any,{} as any,{getUserAddresses:async()=>['wallet']} as any,{} as any);
 const verify=jest.spyOn(engine,'verifyUserBulk').mockImplementation(async(_user,_ids,_address,included)=>({validRules:[],results:included.map(rule=>({isValid:false,ruleId:rule.id,status:'failed'})),invalidRules:[],matchingAssetCounts:new Map()}) as any);
 return {engine,verify};
}
describe('Network qualification priority',()=>{
 it('uses the requested order for NFTs and tokens',()=>{
  expect(rules.map(checkPriority)).toEqual([0,1,2,3,4,5,6]);
  expect(checkPriority({asset_type:'erc20',chain_id:4663})).toBe(1);
  expect(checkPriority({asset_type:'solana_token'})).toBe(3);
 });
 it('walks cumulative tiers in order and keeps earlier combined contributions',async()=>{
  const f=fixture();await f.engine.evaluateRole('member','server','role',{checks:new Map(),bulkGrantOnly:true});
  expect(f.verify.mock.calls.map(call=>call[3].map(rule=>rule.id))).toEqual(rules.map((_rule,index)=>rules.slice(0,index+1).map(rule=>rule.id)));
 });
 it('stops before later networks once the role qualifies',async()=>{
  const f=fixture();f.verify.mockImplementation(async(_user,_ids,_address,included)=>({validRules:included.length>=3?[included[2]]:[],results:included.map(rule=>({isValid:included.length>=3,ruleId:rule.id})),invalidRules:[],matchingAssetCounts:new Map()}) as any);
  expect((await f.engine.evaluateRole('member','server','role',{checks:new Map(),bulkGrantOnly:true})).status).toBe('passed');
  expect(f.verify).toHaveBeenCalledTimes(3);expect(f.verify.mock.calls.flatMap(call=>call[3]).some(rule=>rule.asset_type==='ordinal')).toBe(false);
 });
 it('keeps later alternatives available when an earlier provider fails',async()=>{
  const f=fixture();f.verify.mockImplementation(async(_user,_ids,_address,included)=>({validRules:included.length===7?[included[6]]:[],results:[{isValid:included.length===7,status:'unavailable'}],invalidRules:[],matchingAssetCounts:new Map()}) as any);
  expect((await f.engine.evaluateRole('member','server','role',{checks:new Map(),bulkGrantOnly:true})).status).toBe('passed');expect(f.verify).toHaveBeenCalledTimes(7);
 });
 it('keeps complete evaluation for role reconciliation',async()=>{
  const f=fixture();await f.engine.evaluateRole('member','server','role',{checks:new Map()});expect(f.verify).toHaveBeenCalledTimes(1);expect(f.verify.mock.calls[0][3]).toHaveLength(7);
 });
});
