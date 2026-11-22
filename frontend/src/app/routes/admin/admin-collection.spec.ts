import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { AdminComponent } from './admin.component';
import { PortalSessionService } from '../../services/portal-session.service';

describe('Canonical NFT rules from a collection lookup', () => {
  let component: AdminComponent;
  const selection = {
    contract_address: '0x' + 'ab'.repeat(20),
    network: 'base',
    collection_name: 'Test Art',
    token_ids: '100-105',
    expected_token_standard: 'erc1155' as const,
  };
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PortalSessionService, provideRouter([])] });
    component = TestBed.runInInjectionContext(() => new AdminComponent());
    TestBed.inject(PortalSessionService).user = {id:'admin',name:'Admin'};
    component.selected = '111111111111111111';
    component.editor = { new: true };
    component.data = { capabilities: { multi_trait: true } };
    component.draft = {
      asset_type: 'nft',
      channel_id: '222222222222222222',
      role_id: '333333333333333333',
      min_items: 2,
      trait_filter: { operator: 'AND', conditions: [] },
    };
  });
  it('includes an optional collection for Ordinals ID and number selections',()=>{
    component.draft.asset_type='ordinal';component.mode='numbers';
    component.draft.inscription_numbers='100-105';component.draft.slug='pizza-comrades';
    expect(component.payload()).toEqual(jasmine.objectContaining({inscription_numbers:'100-105',slug:'pizza-comrades'}));
    expect(component.payload().inscription_ids).toBeUndefined();
    component.mode='ids';component.draft.inscription_ids='a'.repeat(64)+'i0';
    expect(component.payload()).toEqual(jasmine.objectContaining({inscription_ids:'a'.repeat(64)+'i0',slug:'pizza-comrades'}));
    component.mode='numbers';component.draft.asset_type='ethscription';
    expect(component.payload().slug).toBeUndefined();
    component.draft.asset_type='ordinal';component.draft.slug='';
    expect(component.payload().slug).toBeUndefined();
  });
  it('creates a whole collection when the selection is cleared without sending a selection label',()=>{
    component.draft.asset_type='ordinal';component.mode='ids';
    component.draft.inscription_ids='  ';component.draft.label='Old selection';component.draft.slug='pizza-comrades';
    expect(component.payload().slug).toBe('pizza-comrades');
    expect(component.payload().inscription_ids).toBeUndefined();
    expect(component.payload().label).toBeUndefined();
  });
  it('shows the collection restriction in a saved rule summary',()=>{
    expect(component.describe({asset_type:'ordinal',rule_label:'Subset',inscription_criteria:{kind:'numbers',ranges:[[100,105]],collection_slug:'pizza-comrades'}})).toContain('collection: pizza-comrades');
  });
  it('saves concrete contract and token fields without a marketplace URL or dynamic slug', () => {
    component.review = true;
    component.useNftCollection(selection);
    expect(component.payload()).toEqual(
      jasmine.objectContaining({
        asset_type: 'nft',
        contract_address: selection.contract_address,
        network: 'base',
        token_ids: '100-105',
        collection_name: 'Test Art',
        min_items: 2,
        expected_token_standard: 'erc1155',
      }),
    );
    expect(component.payload().slug).toBeUndefined();
    expect(component.review).toBeFalse();
    expect(component.draft.role_id).toBe('333333333333333333');
  });
  it('removes a previous fixed list when the admin explicitly chooses an entire ERC-721 contract', () => {
    component.draft.token_ids = '1-5';
    component.useNftCollection({
      ...selection,
      token_ids: '',
      expected_token_standard: 'erc721',
    });
    expect(component.payload().token_ids).toBeUndefined();
    expect(component.payload().expected_token_standard).toBe('erc721');
  });
  it('preserves a chosen lookup through add-rule collapse and restore', () => {
    component.useNftCollection(selection);
    component.create();
    expect(component.editor).toBeNull();
    component.create();
    expect(component.payload().token_ids).toBe('100-105');
    expect(component.payload().expected_token_standard).toBe('erc1155');
  });
  it('does not apply a late result after the editor closes or changes asset type', () => {
    component.editor = null;
    component.useNftCollection(selection);
    expect(component.draft.contract_address).toBeUndefined();
    component.editor = { new: true };
    component.draft.asset_type = 'ordinal';
    component.useNftCollection(selection);
    expect(component.draft.contract_address).toBeUndefined();
  });
  it('allows deliberate manual contract entry to replace the lookup’s standard expectation', () => {
    component.useNftCollection(selection);
    component.clearNftLookupExpectation();
    expect(component.payload().expected_token_standard).toBeUndefined();
    expect(component.payload().contract_address).toBe(
      selection.contract_address,
    );
  });
  it('chooses Solana rules as NFTs or Tokens on the Solana network',()=>{
    expect(component.assetChoices.map(choice=>choice.label)).toEqual(['Ethscriptions','Ordinals','Bitcoin Stamps','Counterparty','NFTs','Tokens']);
    expect(component.ruleNetworkChoices.map(choice=>choice.value)).toEqual(['ethereum','base','robinhood']);
    component.data.capabilities.solana=true;
    expect(component.ruleNetworkChoices.map(choice=>choice.value)).toEqual(['ethereum','base','robinhood','solana']);
    component.draft.channel_id='channel';
    component.draftAsset='nft';component.draftNetwork='base';
    expect(component.draft.asset_type).toBe('nft');expect(component.draft.network).toBe('base');
    component.draftNetwork='solana';
    expect(component.draft.asset_type).toBe('solana_nft');expect(component.draftAsset).toBe('nft');expect(component.draftNetwork).toBe('solana');
    expect(component.draft.channel_id).toBe('channel');
    component.draftAsset='erc20';component.draftNetwork='solana';
    expect(component.draft.asset_type).toBe('solana_token');expect(component.draftAsset).toBe('erc20');
    component.draftNetwork='robinhood';
    expect(component.draft.asset_type).toBe('erc20');expect(component.draft.network).toBe('robinhood');
    expect(component.payload().solana_criteria).toBeUndefined();
  });
  it('locks the network for single-network asset types',()=>{
    for(const [asset,network] of [['ordinal','bitcoin'],['stamp','bitcoin'],['counterparty','bitcoin'],['ethscription','ethereum']]){
      component.draftAsset=asset;expect(component.fixedNetwork?.map(choice=>choice.value)).toEqual([network]);
    }
    for(const asset of ['nft','erc20']){component.draftAsset=asset;expect(component.fixedNetwork).toBeNull();}
  });
  it('keeps the chosen network when switching between NFTs and Tokens',()=>{
    component.data.capabilities.solana=true;
    component.draftAsset='nft';component.draftNetwork='robinhood';
    component.draftAsset='erc20';
    expect(component.draft.asset_type).toBe('erc20');expect(component.draft.network).toBe('robinhood');
    component.draftNetwork='solana';
    component.draftAsset='nft';
    expect(component.draft.asset_type).toBe('solana_nft');
    component.draftAsset='ordinal';component.draftAsset='erc20';
    expect(component.draft.asset_type).toBe('erc20');expect(component.draft.network).toBe('ethereum');
  });
  it('filters Solana rules under NFTs and Tokens',()=>{
    component.data.rules=[{id:1,asset_type:'nft'},{id:2,asset_type:'solana_nft'},{id:3,asset_type:'erc20'},{id:4,asset_type:'solana_token'}];
    component.filter='nft';expect(component.rules.map((r:any)=>r.id).sort()).toEqual([1,2]);
    component.filter='erc20';expect(component.rules.map((r:any)=>r.id).sort()).toEqual([3,4]);
  });
  it('keeps Solana token mint/program and minimum separate from EVM defaults',()=>{
    component.draft.asset_type='solana_token';component.changeAsset();
    component.draft.solana_mint='So11111111111111111111111111111111111111112';
    component.draft.min_balance='1.25';
    const payload=component.payload();
    expect(payload.solana_criteria).toEqual({kind:'token',mint:component.draft.solana_mint,program:component.draft.solana_program});
    expect(payload.min_balance).toBe('1.25');
    for(const key of ['network','chain_id','min_items','trait_filter','contract_address','token_ids','slug'])expect(payload[key]).toBeUndefined();
  });
  it('preserves Solana scope address casing and NFT trait rules',()=>{
    component.draft.asset_type='solana_nft';component.changeAsset();
    const address='So11111111111111111111111111111111111111112';
    component.draft.solana_kind='verified_creator';component.draft.solana_addresses=address;
    component.draft.trait_filter={operator:'AND',conditions:[{key:'Color',value:'Blue'}]};
    const payload=component.payload();
    expect(payload.solana_criteria).toEqual({kind:'verified_creator',addresses:[address],formats:['metadata','core']});
    expect(payload.trait_filter).toEqual(component.draft.trait_filter);
    expect(payload.min_items).toBe(1);expect(payload.network).toBeUndefined();expect(payload.slug).toBeUndefined();
  });
  it('keeps compressed NFTs an explicit new-rule selection',()=>{
    component.draft.asset_type='solana_nft';component.changeAsset();
    component.draft.solana_addresses='So11111111111111111111111111111111111111112';
    expect(component.payload().solana_criteria.formats).toEqual(['metadata','core']);
    component.draft.solana_formats='compressed';
    expect(component.payload().solana_criteria.formats).toEqual(['compressed']);
    component.draft.solana_formats='all';
    expect(component.payload().solana_criteria.formats).toEqual(['metadata','core','compressed']);
    expect(component.describe({asset_type:'solana_nft',solana_criteria:{kind:'collection',addresses:[component.draft.solana_addresses],formats:['compressed']}})).toContain('compressed NFTs');
  });
  it('gates printed edition choices and saves only Token Metadata formats',()=>{
    expect(component.solanaScopeChoices.some(choice=>choice.value==='master_edition')).toBeFalse();
    component.data.capabilities.solana_editions=true;
    expect(component.solanaScopeChoices.some(choice=>choice.value==='master_edition')).toBeTrue();
    component.draft.asset_type='solana_nft';component.changeAsset();
    component.draft.solana_kind='master_edition';component.draft.solana_addresses='So11111111111111111111111111111111111111112';
    component.draft.solana_formats='all';
    expect(component.payload().solana_criteria).toEqual({kind:'master_edition',addresses:[component.draft.solana_addresses],formats:['metadata']});
    expect(component.describe({asset_type:'solana_nft',solana_criteria:component.payload().solana_criteria})).toContain('prints of master edition');
  });
  it('uses the Solana explorer for a Solana address beginning with the Bitcoin prefix',()=>{
    const address='bc1p111111111111111111111111111111111111111';
    expect(component.walletExplorer(address)).toBe('https://solscan.io/account/'+address);
  });
  it('creates creator-and-stamp scopes without NFT traits or EVM fields',()=>{
    component.draft.asset_type='stamp';component.changeAsset();
    component.draft.stamp_creator='1GotRejB6XsGgMsM79TvcypeanDJRJbMtg';component.draft.stamp_ids='0, 1';
    expect(component.hasTraitEditor).toBeFalse();
    expect(component.payload().stamp_criteria).toEqual({creator:component.draft.stamp_creator,stamp_ids:['0','1']});
    expect(component.payload().network).toBeUndefined();
    expect(component.payload().trait_filter).toBeUndefined();
    expect(component.describe({stamp_criteria:component.payload().stamp_criteria})).toContain('#0, #1');
  });
  it('creates each Counterparty scope with the right minimum',()=>{
    component.draftAsset='counterparty';
    expect(component.draft.xcp_scope).toBe('asset');expect(component.counterpartyAmount).toBeTrue();expect(component.hasTraitEditor).toBeFalse();
    component.draft.xcp_value=' PEPECASH ';component.draft.min_balance='1000.5';
    expect(component.payload()).toEqual(jasmine.objectContaining({asset_type:'counterparty',counterparty_criteria:{asset:'PEPECASH'},min_balance:'1000.5'}));
    expect(component.payload().min_items).toBeUndefined();
    component.draft.xcp_scope='assets';component.draft.xcp_value='RAREPEPE, PEPE.kek\nBBBB';component.draft.min_items=3;
    expect(component.counterpartyAmount).toBeFalse();
    expect(component.payload().counterparty_criteria).toEqual({assets:['RAREPEPE','PEPE.kek','BBBB']});
    expect(component.payload().min_items).toBe(3);expect(component.payload().min_balance).toBeUndefined();
    for(const scope of ['issuer','parent']){component.draft.xcp_scope=scope;component.draft.xcp_value='X';expect(component.payload().counterparty_criteria).toEqual({[scope]:'X'});}
    expect(component.describe({counterparty_criteria:{asset:'PEPECASH'},token_symbol:'PEPECASH'})).toBe('Counterparty: PEPECASH');
    expect(component.describe({counterparty_criteria:{parent:'PEPE'}})).toBe('Counterparty: PEPE.* subassets');
    expect(component.assetFilterChoices.some(choice=>choice.value==='counterparty')).toBeTrue();
  });

});
