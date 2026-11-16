import { PrivacyService, WalletCommunity } from '../src/portal/privacy.service';
import { MemberService } from '../src/portal/member.service';
import { DbService } from '../src/services/db.service';
import { MemberController } from '../src/portal/member.controller';
import { PortalService } from '../src/portal/portal.service';

const user='111111111111111111', server='222222222222222222', other='333333333333333333';
const address='0x'+'a'.repeat(40);
const scope: WalletCommunity={user_id:user,address,server_id:server,source:'verification',enabled:true,associated_at:'2026-11-01T00:00:00Z',shared_at:'2026-11-02T00:00:00Z',removed_at:null};
describe('Community wallet disclosure',()=>{
 it.each([
  ['solana','So11111111111111111111111111111111111111112','So11111111111111111111111111111111111111112'],
  ['bitcoin','1BoatSLRHtKNngkdXEeobR76b53LETtpyT','1BoatSLRHtKNngkdXEeobR76b53LETtpyT'],
  ['evm','0x'+'Aa'.repeat(20),'0x'+'aa'.repeat(20)],
 ])('records %s history using the same canonical address as the association',async(walletType,input,expected)=>{
  const upsert=jest.fn().mockResolvedValue({error:null});
  await new DbService({from:()=>({upsert})} as any).recordWalletVerification(user,input,{id:'event',source:'discord',serverId:server,walletType:walletType as any,provenAt:new Date().toISOString()});
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({address:expected}),expect.anything());
 });

 const privacy=new PrivacyService({} as any);
 it('requires an enabled association for current access and never treats removal as current',()=>{
  expect(privacy.communityAllows(undefined)).toBe(false);
  expect(privacy.communityAllows({...scope,enabled:false})).toBe(false);
  expect(privacy.communityAllows({...scope,removed_at:'2026-11-03T00:00:00Z'})).toBe(false);
  expect(privacy.communityAllows(scope)).toBe(true);
 });
 it('bounds historical access to the association and community while retaining grandfathered history',()=>{
  const removed={...scope,removed_at:'2026-11-03T00:00:00Z'};
  expect(privacy.communityAllows(removed,'2026-11-02T00:00:00Z',server)).toBe(true);
  expect(privacy.communityAllows(removed,'2026-11-02T00:00:00Z',other)).toBe(false);
  expect(privacy.communityAllows(removed,'2026-10-31T00:00:00Z',server)).toBe(false);
  expect(privacy.communityAllows(removed,'2026-11-04T00:00:00Z',server)).toBe(false);
  expect(privacy.communityAllows(removed,'invalid',server)).toBe(false);
  expect(privacy.communityAllows({...scope,source:'legacy'},'2026-10-01T00:00:00Z',other)).toBe(true);
 });
 it('fails closed when disclosure metadata cannot be read',async()=>{
  const q:any={select:jest.fn().mockReturnThis(),eq:jest.fn().mockReturnThis(),order:jest.fn().mockReturnThis(),range:jest.fn().mockResolvedValue({data:null,error:{message:'private database detail'}})};
  const service=new PrivacyService({from:jest.fn().mockReturnValue(q)} as any);
  await expect(service.walletCommunities(user,server)).rejects.toThrow('temporarily unavailable');
  expect(q.eq).toHaveBeenCalledWith('user_id',user);
  expect(q.eq).toHaveBeenCalledWith('server_id',server);
 });
 it('binds explicit sharing to the signed-in member and fresh Discord membership',async()=>{
  const fakePrivacy={setWalletCommunity:jest.fn().mockResolvedValue({ok:true})};
  const members={fetch:jest.fn().mockResolvedValue({id:user})};
  const service=new MemberService({} as any,{getBotClient:()=>({guilds:{cache:new Map([[server,{members}]])}})} as any,{} as any,{} as any,{} as any,{} as any,fakePrivacy as any);
  const dto={server,address,enabled:false,request_id:'aaaaaaaa-0000-4000-8000-000000000001'};
  await expect(service.walletSharing({user:{id:user}} as any,dto)).resolves.toEqual({ok:true});
  expect(fakePrivacy.setWalletCommunity).toHaveBeenCalledWith(user,server,address,false,dto.request_id);
  members.fetch.mockRejectedValue(Object.assign(new Error('unknown member'),{code:10007}));
  fakePrivacy.setWalletCommunity.mockClear();
  await expect(service.walletSharing({user:{id:user}} as any,dto)).rejects.toThrow('member of this community');
  expect(fakePrivacy.setWalletCommunity).not.toHaveBeenCalled();
 });
 it('rejects the member mutation before service access when CSRF validation fails',async()=>{
  const member={walletSharing:jest.fn()},auth={session:jest.fn().mockResolvedValue({user:{id:user}}),assertMutation:jest.fn(()=>{throw new Error('csrf');})};
  const controller=new MemberController(auth as any,member as any);
  await expect(controller.walletSharing({} as any,{} as any)).rejects.toThrow('csrf');
  expect(member.walletSharing).not.toHaveBeenCalled();
 });
});

describe('Community-scoped admin member lookup',()=>{
 function fixture(operator=false) {
  const now='2026-11-02T00:00:00Z';
  const saved=['shared','unrelated','revoked','old-permission'].map(name=>({address:name,wallet_type:'evm',last_verified_at:now}));
  const removed=[{address:'removed-shared',removed_at:'2026-11-03T00:00:00Z',last_verified_at:now},{address:'removed-unrelated',removed_at:now,last_verified_at:now}];
  const rows=[{...scope,address:'shared'}, {...scope,address:'revoked',enabled:false},
    {...scope,address:'old-permission',shared_at:'2026-10-01T00:00:00Z'},
    {...scope,address:'removed-shared',removed_at:'2026-11-03T00:00:00Z'}];
  const privacy=new PrivacyService({} as any);
  jest.spyOn(privacy,'isOperator').mockReturnValue(operator);
  jest.spyOn(privacy,'policy').mockResolvedValue({share_since:'2026-11-01T00:00:00Z'} as any);
  jest.spyOn(privacy,'walletCommunities').mockResolvedValue(rows);
  const inAddresses=jest.fn().mockResolvedValue({data:[],error:null});
  const db={from:jest.fn(table=>table==='user_wallets'
   ? {select:()=>({eq:async()=>({data:saved,error:null})})}
   : {select:()=>({eq:()=>({in:inAddresses})})})};
  const engine={evaluateRole:jest.fn().mockResolvedValue({status:'eligible'}),finishWalletChecks:jest.fn()};
  const walletChecks={statuses:jest.fn().mockResolvedValue([])};
  const service=Object.assign(Object.create(PortalService.prototype),{
   db,privacy,engine,walletChecks,
   rules:{getEarnedRoleAssignments:async()=>[{role_id:'role',last_checked:now}],getRoleMappings:async()=>[]},
   readAccess:async()=>({roles:{cache:new Map([['role',{name:'Role'}]])}}),
   resolveMember:async()=>({id:user,displayName:'Member',user:{username:'member'},displayAvatarURL:()=>null,roles:{cache:new Map()}}),
   removedWallets:async()=>removed,blockedAttempts:async()=>({items:[],total:0}),
  }) as PortalService;
  return {service,privacy,engine,walletChecks,inAddresses,saved,removed};
 }
 it('returns only permitted community wallets/history while private role eligibility still runs',async()=>{
  const f=fixture();
  const result=await f.service.member({user:{id:'admin'}} as any,server,user,true);
  expect(result.wallets.map(w=>w.address)).toEqual(['shared']);
  expect(result.removed_wallets.map(w=>w.address)).toEqual(['removed-shared']);
  expect(f.inAddresses).toHaveBeenCalledWith('address',['shared','removed-shared']);
  expect(f.walletChecks.statuses).toHaveBeenCalledWith(user,server,['shared']);
  expect(f.engine.evaluateRole).toHaveBeenCalledWith(user,server,'role',expect.anything());
  expect(result.roles[0].status).toBe('eligible');
  expect(f.privacy.walletCommunities).toHaveBeenCalledWith(user,server);
 });
 it('does not disclose account-wide saved-wallet existence when nothing is shared',async()=>{
  const f=fixture();
  jest.mocked(f.privacy.walletCommunities).mockResolvedValue([]);
  const result=await f.service.member({user:{id:'admin'}} as any,server,user,false);
  expect(result.wallets).toEqual([]);
  expect(result.removed_wallets).toEqual([]);
  expect(result.wallets_private).toBe(true);
  expect(f.inAddresses).not.toHaveBeenCalled();
  expect(f.walletChecks.statuses).not.toHaveBeenCalled();
 });
 it('preserves the operator override without depending on ordinary disclosure metadata',async()=>{
  const f=fixture(true);
  const result=await f.service.member({user:{id:'operator'}} as any,server,user,false);
  expect(result.wallets.map(w=>w.address)).toEqual(f.saved.map(w=>w.address));
  expect(result.removed_wallets.map(w=>w.address)).toEqual(f.removed.map(w=>w.address));
  expect(f.privacy.walletCommunities).not.toHaveBeenCalled();
  expect(f.privacy.policy).not.toHaveBeenCalled();
 });
});
