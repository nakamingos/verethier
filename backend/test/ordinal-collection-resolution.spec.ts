import { ordinalCollectionSpellings, resolveOrdinalCollection } from '../src/utils/ordinal-collection-resolution.util';
import { OrdinalCollectionNotFoundError } from '../src/utils/ordinal-collection-not-found.util';
import { RuleInputError } from '../src/utils/rule-input-error';
import { OrdnetOwnershipService } from '../src/services/ordnet-ownership.service';
import { OrdinalsOwnershipService } from '../src/services/ordinals-ownership.service';
import { RuleEditService } from '../src/services/rule-edit.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { OrdnetUnavailableError } from '../src/utils/ordnet-error.util';

const absent=()=>new OrdinalCollectionNotFoundError('ord.net');
describe('Separator-aware Ordinals collection lookup',()=>{
 afterEach(()=>jest.restoreAllMocks());
 it('generates a small, unique set without changing word order or other punctuation',()=>{
  expect(ordinalCollectionSpellings(' Pizza  Comrades ')).toEqual(['pizza-comrades','pizza_comrades','pizzacomrades']);
  expect(ordinalCollectionSpellings('pizza_comrades')).toEqual(['pizza_comrades','pizza-comrades','pizzacomrades']);
  expect(ordinalCollectionSpellings('a.b-c_d')).toEqual(['a.b-c_d','a.b-c-d','a.b_c_d','a.bcd']);
  expect(ordinalCollectionSpellings('yonder')).toEqual(['yonder']);
  expect(()=>ordinalCollectionSpellings('https://ord.net/private')).toThrow(RuleInputError);
 });
 it('prefers an exact match without checking alternatives',async()=>{
  const lookup=jest.fn(async(id:string)=>({id}));
  expect(await resolveOrdinalCollection('pizza_comrades',lookup)).toEqual({id:'pizza_comrades'});
  expect(lookup).toHaveBeenCalledTimes(1);
 });
 it.each(['pizza comrades','pizza-comrades','pizzacomrades'])('resolves a unique alternative for %s',async input=>{
  const canonical=input==='pizzacomrades'?'pizzacomrades':'pizza_comrades';
  const lookup=jest.fn(async(id:string)=>{if(id===canonical)return {id};throw absent();});
  expect(await resolveOrdinalCollection(input,lookup)).toEqual({id:canonical});
  expect(lookup.mock.calls.length).toBeLessThanOrEqual(4);
 });
 it('also tries the form with no separators',async()=>{
  const lookup=jest.fn(async(id:string)=>{if(id==='pizzacomrades')return {id};throw absent();});
  expect(await resolveOrdinalCollection('pizza comrades',lookup)).toEqual({id:'pizzacomrades'});
 });
 it('does not guess when different alternatives exist',async()=>{
  const lookup=jest.fn(async(id:string)=>{if(id==='pizza-comrades')throw absent();return {id};});
  await expect(resolveOrdinalCollection('pizza comrades',lookup)).rejects.toThrow('Several collections match that spelling: pizza_comrades, pizzacomrades');
 });
 it('returns actionable input guidance only after all spellings are confirmed absent',async()=>{
  await expect(resolveOrdinalCollection('pizza comrades',async()=>{throw absent();})).rejects.toThrow('Tried hyphens, underscores and no separators');
 });
 it.each(['first','later'])('keeps provider failures distinct from missing collections (%s)',async stage=>{
  const offline=new OrdnetUnavailableError('read unavailable');
  const lookup=jest.fn(async(id:string)=>{
   if(stage==='first' || id==='pizza_comrades')throw offline;
   if(id==='pizzacomrades')return {id};
   throw absent();
  });
  await expect(resolveOrdinalCollection('pizza comrades',lookup)).rejects.toBe(offline);
  if(stage==='first')expect(lookup).toHaveBeenCalledTimes(1);
 });
 it('rejects an inconsistent provider result',async()=>{
  await expect(resolveOrdinalCollection('pizza-comrades',async()=>({id:'another-collection'}))).rejects.toThrow('different slug');
 });
 it('saves the resolved slug for whole collections, ID scopes and number scopes',async()=>{
  jest.replaceProperty(EnvironmentConfig,'ORDINALS_PROVIDER','ordnet');
  const get=jest.fn(async(path:string)=>{
   const slug=new URL('https://example.test'+path).searchParams.get('slugs');
   return {success:true,data:slug==='pizza_comrades'?[{slug}]:[]};
  });
  const service=new OrdinalsOwnershipService(new OrdnetOwnershipService({get} as any));
  expect((await service.prepareRule('pizza comrades')).slug).toBe('pizza_comrades');
  const id='a'.repeat(64)+'i0';
  expect((await service.prepareInscriptionRule(id,null,1,'pizza-comrades')).inscription_criteria?.collection_slug).toBe('pizza_comrades');
  expect((await service.prepareInscriptionRule(null,'100-200',1,'pizza-comrades')).inscription_criteria?.collection_slug).toBe('pizza_comrades');
  const editor=new RuleEditService(null as any,null as any,service,null as any);
  const converted=await editor.prepare({id:1,asset_type:'ordinal',slug:null,min_items:1,inscription_criteria:{kind:'ids',ids:[id]}} as any,
   {selection:'',collection_slug:'pizza comrades',min_items:'1'});
  expect(converted).toMatchObject({id:1,slug:'pizza_comrades',inscription_criteria:null});
 });
 it('supports the same separator variants on the Xverse collection path',async()=>{
  jest.replaceProperty(EnvironmentConfig,'ORDINALS_PROVIDER','xverse');
  const service=new OrdinalsOwnershipService();
  jest.spyOn(service as any,'request').mockImplementation(async(...args:any[])=>{
   const id=decodeURIComponent(args[0].split('/').at(-1));
   if(id!=='pizza_comrades')throw new OrdinalCollectionNotFoundError('Xverse');
   return {id,name:'Pizza Comrades'};
  });
  expect((await service.prepareRule('pizza comrades')).slug).toBe('pizza_comrades');
 });
});
