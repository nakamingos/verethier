import { OrdnetOwnershipService } from '../src/services/ordnet-ownership.service';
import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { RuleEditService } from '../src/services/rule-edit.service';
import { prepareRuleCriteria } from '../src/services/rule-create.util';
import { EnvironmentConfig } from '../src/config/environment.config';
import { inscriptionCriteria, inscriptionRuleScope } from '../src/utils/inscription-rule.util';
import { ruleCriteriaKey, ruleEditFields, ruleEditVersion } from '../src/utils/rule-edit.util';
import { NftCheckContext } from '../src/services/nft-ownership.service';
import { AssetOwnershipService } from '../src/services/asset-ownership.service';
import { VerificationEngine } from '../src/services/verification-engine.service';
import vectors from './fixtures/bip322-taproot.json';

const wallet=vectors.valid[0].address, other=vectors.valid[1].address;
const id=(n:number)=>'a'.repeat(64)+'i'+n;
const rule:any={id:1,server_id:'guild',channel_id:'verify',role_id:'holder',asset_type:'ordinal',slug:null,min_items:5,
  attribute_key:'ALL',attribute_value:'ALL',inscription_criteria:{kind:'numbers',ranges:[[100,101]],collection_slug:'pizza-comrades'}};
const item=(n:number,number=n+99,owner:string|null=wallet)=>({id:id(n),inscriptionId:id(n),inscription:number,
  collection:'pizza-comrades',collections:[],owner,traits:[]});
const page=(items:any[],cursor:string|null=null)=>({items,pagination:{pageSize:100,hasNext:cursor!==null,nextCursor:cursor}});
const run=():NftCheckContext=>({checks:new Map()});

describe('ord.net collection-scoped inscription numbers',()=>{
  let get:jest.Mock, service:OrdinalsOwnershipService, inventories:any, catalog:any;
  beforeEach(()=>{
    jest.replaceProperty(EnvironmentConfig,'ORDINALS_PROVIDER','xverse');
    jest.replaceProperty(EnvironmentConfig,'XVERSE_API_KEY',undefined);
    get=jest.fn().mockImplementation(async(path:string)=>path.startsWith('/collection-stats/')
      ? {success:true,data:[{slug:'pizza-comrades'}]} : page([item(1),item(2,101,other),item(3,500)]));
    inventories={inventory:jest.fn().mockRejectedValue(new Error('wallet providers offline'))};
    catalog={snapshot:jest.fn().mockRejectedValue(new Error('metadata owners are stale'))};
    service=new OrdinalsOwnershipService(new OrdnetOwnershipService({get} as any),undefined,undefined,catalog,inventories);
  });
  afterEach(()=>jest.restoreAllMocks());

  it('creates a canonical collection scope without requiring Xverse or expanding the range',async()=>{
    const result=await prepareRuleCriteria({asset_type:'ordinal',slug:' Pizza-Comrades ',inscription_numbers:'100-101',min_items:5},
      {data:null,nfts:null,ordinals:service});
    expect(result).toMatchObject({slug:null,minItems:5,assetFields:{inscription_criteria:rule.inscription_criteria}});
    expect(get).toHaveBeenCalledTimes(1);
    expect(inscriptionCriteria({...rule,...result.assetFields})).toEqual(rule.inscription_criteria);
    await service.checkSetupHealth(rule);
  });
  it.each(['all','https://ord.net/collection/pizza-comrades','bad/slug'])('rejects invalid collection slug %s',async slug=>{
    await expect(service.prepareInscriptionRule(null,'100',1,slug)).rejects.toThrow('collection slug');
    expect(get).not.toHaveBeenCalled();
  });
  it('rejects an unknown collection and does not enable collection scopes for IDs or Ethscriptions',async()=>{
    get.mockResolvedValue({success:true,data:[]});
    await expect(service.prepareInscriptionRule(null,'100',1,'missing')).rejects.toThrow('not found');
    await expect(prepareRuleCriteria({asset_type:'ethscription',slug:'pizza-comrades',inscription_numbers:'100'}, {data:null,nfts:null})).rejects.toThrow('Only Ordinals');
    await expect(prepareRuleCriteria({asset_type:'ordinal',slug:'pizza-comrades',inscription_ids:id(1)}, {data:null,nfts:null,ordinals:service})).rejects.toThrow('Only Ordinals');
  });
  it('checks fresh owners only for selected numbers, stacks wallets and shares one complete scan across rules and members',async()=>{
    const context=run();
    expect(await service.count(rule,[wallet,wallet],context)).toBe(1n);
    expect(await service.count(rule,[wallet,other],context)).toBe(2n);
    expect(await service.count({...rule,id:2,inscription_criteria:{...rule.inscription_criteria,ranges:[[500,500]]}},[wallet],context)).toBe(1n);
    expect([...await service.matchingAssets(rule,[wallet,other],context)]).toEqual([[id(1),1n],[id(2),1n]]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(inventories.inventory).not.toHaveBeenCalled();expect(catalog.snapshot).not.toHaveBeenCalled();
    expect(service.checkDetails(rule,[wallet],context)).toMatchObject({provider:'ordnet',source:'live'});
    // A new verification must observe a transfer, never reusing saved owners.
    get.mockResolvedValue(page([item(1,100,other),item(2,101,other)]));
    expect(await service.count(rule,[wallet],run())).toBe(0n);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('includes the collection in check keys so the same numeric selection cannot reuse a different collection',async()=>{
    const context=run();
    expect(await service.count(rule,[wallet],context)).toBe(1n);
    get.mockResolvedValue({items:[{...item(1),collection:'another-collection',owner:other}],pagination:{pageSize:100,hasNext:false,nextCursor:null}});
    const second={...rule,inscription_criteria:{...rule.inscription_criteria,collection_slug:'another-collection'}};
    expect(await service.count(second,[wallet],context)).toBe(0n);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('reads all pages and counts signed historical numbers without expanding huge ranges',async()=>{
    get.mockReset().mockResolvedValueOnce(page([item(1,-10)],'next')).mockResolvedValueOnce(page([item(2,Number.MAX_SAFE_INTEGER)]));
    const selected={...rule,inscription_criteria:{kind:'numbers',ranges:[[-10,-1],[100,Number.MAX_SAFE_INTEGER]],collection_slug:'pizza-comrades'}};
    expect(await service.count(selected,[wallet],run())).toBe(2n);
    expect(get.mock.calls[1][0]).toContain('cursor=next');
  });
  it.each(['missing number','fractional number','duplicate number','selected owner unknown','later page failed'])('keeps %s unavailable rather than granting or proving ineligibility',async problem=>{
    const items:any[]=[item(1),item(2)];
    if(problem==='missing number')delete items[1].inscription;
    if(problem==='fractional number')items[1].inscription=100.5;
    if(problem==='duplicate number')items[1].inscription=100;
    if(problem==='selected owner unknown')items[1].owner=null;
    get.mockReset().mockResolvedValueOnce(page(items,problem==='later page failed'?'next':null)).mockRejectedValue(new Error('Ordinals verification is temporarily unavailable.'));
    await expect(service.count(rule,[wallet],run())).rejects.toThrow('unavailable');
    expect(inventories.inventory).not.toHaveBeenCalled();
  });
  it('ignores unknown owners outside the selection, but accepts only a complete valid response as zero',async()=>{
    get.mockResolvedValue(page([item(1),item(3,500,null)]));
    expect(await service.count(rule,[wallet],run())).toBe(1n);
    get.mockResolvedValue(page([]));expect(await service.count(rule,[wallet],run())).toBe(0n);
  });
  it('exports matching IDs from a fresh response and fails closed during an outage',async()=>{
    expect([...await service.matchingAssets(rule,[wallet],{...run(),freshExport:true})]).toEqual([[id(1),1n]]);
    get.mockRejectedValue(new Error('offline'));
    await expect(service.matchingAssets(rule,[wallet],{...run(),freshExport:true})).rejects.toThrow();
    expect(catalog.snapshot).not.toHaveBeenCalled();
  });
  it('counts overlapping collection subsets only once in a combined role',async()=>{
    const second={...rule,id:2,inscription_criteria:{...rule.inscription_criteria,ranges:[[101,500]]}};
    const ownership=new AssetOwnershipService(undefined,undefined,service);
    const engine=new VerificationEngine({} as any,ownership,{getUserAddresses:async()=>[wallet,other]} as any,
      {allowedAddresses:async(_server,addresses)=>addresses} as any);
    const context=run();
    const checked=await engine.verifyUserBulk('member',[1,2],wallet,[rule,second],context);
    expect(checked.validRules).toHaveLength(0); // Three distinct matches do not meet five.
    expect(context.ordinalNeedsNumbers).not.toBe(true);
    const eligible=await engine.verifyUserBulk('member',[1,2],wallet,[{...rule,min_items:3},{...second,min_items:3}],run());
    expect(eligible.validRules.length).toBeGreaterThan(0);
    expect(get).toHaveBeenCalledTimes(2);
  });
  it('adds, preserves, edits and removes collection scope in the existing editor and duplicate definition',async()=>{
    const editor=new RuleEditService(null,null,service,null);
    const unscoped={...rule,inscription_criteria:{kind:'numbers',ranges:[[100,101]]}};
    const inputs={selection:'100-101',min_items:'5',collection_slug:'Pizza-Comrades'};
    const added=await editor.prepare(unscoped,inputs);
    expect(added.inscription_criteria).toEqual(rule.inscription_criteria);
    expect(ruleEditFields(added).find(f=>f.key==='collection_slug').value).toBe('pizza-comrades');
    expect(ruleEditVersion(added)).not.toBe(ruleEditVersion(unscoped));
    expect(ruleCriteriaKey(added)).not.toBe(ruleCriteriaKey(unscoped));
    expect(inscriptionRuleScope(added)).toContain('pizza-comrades');
    get.mockClear();
    expect((await editor.prepare(added,{selection:'100-101',min_items:'5',label:'New label'})).inscription_criteria).toEqual(rule.inscription_criteria);
    expect(get).not.toHaveBeenCalled();
    jest.replaceProperty(EnvironmentConfig,'XVERSE_API_KEY','mock');
    const removed=await editor.prepare(added,{...inputs,collection_slug:''});
    expect(removed.inscription_criteria).toEqual(unscoped.inscription_criteria);
  });
  it('rejects malformed or incompatible persisted scope instead of silently checking all numbers',()=>{
    for(const scope of [null,'all','Pizza-Comrades','pizza-comrades\n','bad slug',[],{}])expect(()=>inscriptionCriteria({...rule,inscription_criteria:{...rule.inscription_criteria,collection_slug:scope}})).toThrow();
    expect(()=>inscriptionCriteria({...rule,asset_type:'ethscription'})).toThrow();
    expect(()=>inscriptionCriteria({...rule,inscription_criteria:{kind:'ids',ids:[id(1)],collection_slug:'pizza-comrades'}})).toThrow();
  });
});
