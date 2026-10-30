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
    TestBed.configureTestingModule({ providers: [PortalSessionService] });
    component = TestBed.runInInjectionContext(() => new AdminComponent());
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
});
