import { VerificationEngine } from '../src/services/verification-engine.service';
import { DynamicRoleService } from '../src/services/dynamic-role.service';
import { DiscordVerificationService } from '../src/services/discord-verification.service';
import { interactiveWalletFamilies, ruleMatchesWalletScope } from '../src/utils/check-priority.util';

const address='0x'+'11'.repeat(20);
const definitions:any[]=[
  {id:1,asset_type:'nft',chain_id:1},{id:2,asset_type:'erc20',chain_id:4663},
  {id:3,asset_type:'nft',chain_id:8453},{id:4,asset_type:'ethscription'},
  {id:5,asset_type:'stamp'},{id:6,asset_type:'ordinal'},
  {id:7,asset_type:'solana_nft'},{id:8,asset_type:'solana_token'},
].map(rule=>({...rule,server_id:'server',channel_id:'channel',role_id:'role-'+rule.id,role_name:'Role '+rule.id,min_items:1,min_balance:'1',decimals:0}));
function setup() {
  const db:any={getRoleMappings:jest.fn().mockResolvedValue(definitions)};
  const ownership:any={count:jest.fn().mockResolvedValue(1n),matchingAssets:jest.fn(async rule=>new Map([['asset-'+rule.id,1n]]))};
  const wallets:any={getUserAddresses:jest.fn().mockResolvedValue([address])};
  const blocks:any={allowedAddresses:async(_server,addresses)=>addresses};
  return {db,ownership,wallets,blocks,engine:new VerificationEngine(db,ownership,wallets,blocks)};
}
describe('Interactive wallet-family isolation',()=>{
  it.each(['evm','bitcoin','solana'] as const)('checks only %s providers and saved wallet scopes',async walletType=>{
    const {engine,ownership,wallets}=setup();
    const context={checks:new Map(),verificationCheckFamilies:interactiveWalletFamilies(walletType)};
    await engine.verifyUserBulk('member',definitions.map(rule=>rule.id),address,definitions,context);
    const expected=definitions.filter(rule=>ruleMatchesWalletScope(rule,context.verificationCheckFamilies)).map(rule=>rule.id);
    expect(ownership.count.mock.calls.map(call=>call[0].id)).toEqual(expected);
    if(walletType==='evm') {
      expect(wallets.getUserAddresses.mock.calls.every(call=>call[1]!=='solana' && call[2]!==0)).toBe(true);
    }
  });
  it('keeps scheduled full checks on every family',async()=>{
    const {engine,ownership}=setup();
    await engine.verifyUserBulk('member',definitions.map(rule=>rule.id),address,definitions,{checks:new Map(),ordinalMode:'scheduled'});
    expect(ownership.count.mock.calls.map(call=>call[0].id)).toEqual(definitions.map(rule=>rule.id));
  });
  it('retains a mixed-family role when only its EVM alternative has failed, then permits a complete scheduled decision',async()=>{
    const {engine,db,ownership}=setup();
    const rules=[{...definitions[3],role_id:'mixed'},{...definitions[5],role_id:'mixed'}];
    db.getRoleMappings.mockResolvedValue(rules);ownership.count.mockResolvedValue(0n);
    const scoped={checks:new Map(),verificationCheckFamilies:interactiveWalletFamilies('evm')};
    expect((await engine.evaluateRole('member','server','mixed',scoped)).status).toBe('unavailable');
    expect(ownership.count.mock.calls.map(call=>call[0].asset_type)).toEqual(['ethscription']);
    ownership.count.mockClear();
    expect((await engine.evaluateRole('member','server','mixed',{checks:new Map(),ordinalMode:'scheduled'})).status).toBe('failed');
    expect(ownership.count.mock.calls.map(call=>call[0].asset_type)).toEqual(['ethscription','ordinal']);
  });
  it('still combines distinct same-family collections without using Bitcoin contributions',async()=>{
    const {engine,db,ownership}=setup();
    const rules=[{...definitions[3],id:11,role_id:'mixed',min_items:2},{...definitions[3],id:12,role_id:'mixed',min_items:2},
      {...definitions[5],id:13,role_id:'mixed',min_items:2}];
    db.getRoleMappings.mockResolvedValue(rules);
    expect((await engine.evaluateRole('member','server','mixed',{checks:new Map(),verificationCheckFamilies:interactiveWalletFamilies('evm')})).status).toBe('passed');
    expect(ownership.count.mock.calls.map(call=>call[0].id)).toEqual([11,12]);
    expect(ownership.matchingAssets.mock.calls.every(call=>call[0].asset_type==='ethscription')).toBe(true);
  });
  it('does not reconcile or mutate unrelated, mixed-family or orphaned earned roles during an EVM proof',async()=>{
    const {db}=setup();
    db.getRoleMappings.mockResolvedValue([
      {...definitions[3],role_id:'evm'},{...definitions[5],role_id:'bitcoin'},
      {...definitions[6],role_id:'solana'},{...definitions[3],role_id:'mixed'},{...definitions[5],role_id:'mixed'},
    ]);
    db.getEarnedRoleAssignments=jest.fn().mockResolvedValue(['evm','bitcoin','solana','mixed','orphan'].map(role_id=>({id:role_id,user_id:'member',server_id:'server',role_id,status:'active'})));
    db.saveRoleCheckDetails=jest.fn();db.updateRoleAssignmentStatus=jest.fn();
    const engine:any={evaluateRole:jest.fn().mockResolvedValue({status:'failed',results:[]}),finishWalletChecks:jest.fn()};
    const discord:any={removeUserRole:jest.fn().mockResolvedValue(true),addUserRoleDynamic:jest.fn()};
    const service=new DynamicRoleService(db,engine,discord);
    expect(await service.reverifyUserInServer('member','server',{checks:new Map(),verificationCheckFamilies:interactiveWalletFamilies('evm')})).toEqual({verified:0,revoked:1,errors:0});
    expect(engine.evaluateRole).toHaveBeenCalledTimes(1);
    expect(engine.evaluateRole.mock.calls[0][2]).toBe('evm');
    expect(db.updateRoleAssignmentStatus).toHaveBeenCalledWith('evm','revoked');
    expect(discord.removeUserRole).toHaveBeenCalledTimes(1);
  });
  it.each(['evm','bitcoin','solana'] as const)('restricts role recommendations to %s without extra provider reads',async walletType=>{
    const {db,ownership,wallets,blocks}=setup();
    const guild:any={members:{fetch:jest.fn().mockResolvedValue({roles:{cache:new Map()}})},roles:{fetch:jest.fn(async id=>({id,name:id}))}};
    const service=new DiscordVerificationService(db,{} as any,{} as any,wallets,ownership,blocks);
    service.initialize({guilds:{fetch:jest.fn().mockResolvedValue(guild)}} as any);
    const families=interactiveWalletFamilies(walletType);
    await service.analyzePotentialRoles('server','channel','member',[],address,{checks:new Map(),verificationCheckFamilies:families});
    expect(ownership.count.mock.calls.map(call=>call[0].id)).toEqual(definitions.filter(rule=>ruleMatchesWalletScope(rule,families)).map(rule=>rule.id));
  });
});
