import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NftCollectionLookupComponent } from './nft-collection-lookup.component';

const address = '0x' + 'ab'.repeat(20),
  other = '0x' + 'cd'.repeat(20);
const candidate = {
  chain: 'ethereum',
  network: 'ethereum',
  network_name: 'Ethereum',
  contract_address: address,
  token_standard: 'erc721',
  supported: true,
};
const collection = {
  slug: 'test-art',
  name: 'Test Art',
  url: 'https://opensea.io/collection/test-art',
  contracts: [candidate],
};
const tokens = {
  collection: 'test-art',
  network: 'ethereum',
  contract_address: address,
  token_ids: ['1', '2'],
  token_ids_input: '1-2',
  resolved_at: '2026-10-28T12:00:00Z',
};

describe('NFT collection lookup preview', () => {
  let fixture: ComponentFixture<NftCollectionLookupComponent>,
    component: NftCollectionLookupComponent,
    request: jasmine.Spy;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NftCollectionLookupComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(NftCollectionLookupComponent);
    component = fixture.componentInstance;
    request = jasmine.createSpy('request');
    fixture.componentRef.setInput('server', '111111111111111111');
    fixture.componentRef.setInput('request', request);
    fixture.detectChanges();
    component.input = 'https://opensea.io/collection/test-art';
  });
  async function lookup(result = collection) {
    request.and.resolveTo(structuredClone(result));
    await component.lookup();
    fixture.detectChanges();
  }
  it('shows a preview and defaults to fixed token IDs without changing the rule', async () => {
    const applied = spyOn(component.selection, 'emit');
    await lookup();
    expect(component.scope).toBe('tokens');
    expect(component.candidate?.contract_address).toBe(address);
    expect(fixture.nativeElement.textContent).toContain('Test Art');
    expect(fixture.nativeElement.textContent).toContain('Load token IDs');
    expect(applied).not.toHaveBeenCalled();
    component.useSelection();
    expect(applied).not.toHaveBeenCalled();
  });
  it('waits for complete token discovery and explicit use before emitting canonical fields', async () => {
    await lookup();
    const applied = spyOn(component.selection, 'emit');
    request.and.resolveTo(structuredClone(tokens));
    await component.loadTokens();
    fixture.detectChanges();
    expect(applied).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('pre').textContent).toBe('1-2');
    component.useSelection();
    expect(applied).toHaveBeenCalledOnceWith({
      contract_address: address,
      network: 'ethereum',
      collection_name: 'Test Art',
      token_ids: '1-2',
      expected_token_standard: 'erc721',
    });
    const query = new URLSearchParams(
      request.calls.mostRecent().args[0].split('?')[1],
    );
    expect(query.get('collection')).toBe('test-art');
    expect(query.get('contract')).toBe(address);
    expect(query.get('network')).toBe('ethereum');
  });
  it('folds lookup details after applying them and can reopen the same selection', async () => {
    await lookup();
    request.and.resolveTo(tokens);
    await component.loadTokens();
    component.useSelection();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[role="status"]').textContent,
    ).toContain('copied');
    fixture.nativeElement.querySelector('button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('pre').textContent).toBe('1-2');
    expect(component.tokens?.token_ids).toEqual(['1', '2']);
  });
  it('labels entire-contract scope explicitly and clears an earlier token selection', async () => {
    await lookup();
    component.scope = 'contract';
    component.choiceChanged();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'including future mints and any other collections sharing it',
    );
    const applied = spyOn(component.selection, 'emit');
    component.useSelection();
    expect(applied).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        token_ids: '',
        expected_token_standard: 'erc721',
      }),
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('never offers or applies whole-contract scope to ERC-1155', async () => {
    await lookup({
      ...collection,
      contracts: [{ ...candidate, token_standard: 'erc1155' }],
    });
    expect(component.scopeChoices.map((c) => c.value)).toEqual(['tokens']);
    const applied = spyOn(component.selection, 'emit');
    component.scope = 'contract';
    component.useSelection();
    expect(applied).not.toHaveBeenCalled();
  });
  it('requires an explicit contract choice when more than one supported contract exists', async () => {
    await lookup({
      ...collection,
      contracts: [candidate, { ...candidate, contract_address: other }],
    });
    expect(component.selected).toBe('');
    expect(component.candidate).toBeUndefined();
    const applied = spyOn(component.selection, 'emit');
    component.useSelection();
    expect(applied).not.toHaveBeenCalled();
  });
  it('keeps unsupported networks visible but unavailable', async () => {
    await lookup({
      ...collection,
      contracts: [
        {
          ...candidate,
          chain: 'solana',
          network: null as any,
          supported: false,
        },
      ],
    });
    expect(component.contractChoices[0].disabled).toBeTrue();
    expect(component.selected).toBe('');
    const applied = spyOn(component.selection, 'emit');
    component.useSelection();
    expect(applied).not.toHaveBeenCalled();
  });
  it('does not use a mismatched or empty token result', async () => {
    await lookup();
    request.and.resolveTo({ ...tokens, contract_address: other });
    await component.loadTokens();
    expect(component.tokens).toBeNull();
    expect(component.error).toContain('changed');
    request.and.resolveTo({ ...tokens, token_ids: [], token_ids_input: '' });
    await component.loadTokens();
    expect(component.tokens).toBeNull();
  });
  it('reports missing configuration while leaving manual contract entry available', async () => {
    request.and.rejectWith(
      new Error(
        'OpenSea lookup is not configured. You can still enter a contract address.',
      ),
    );
    await component.lookup();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('not configured');
    expect(component.loading).toBeFalse();
    expect(component.result).toBeNull();
  });
  it('ignores late lookup results after the user changes the input', async () => {
    let resolve!: (result: any) => void;
    request.and.returnValue(new Promise((r) => (resolve = r)));
    const pending = component.lookup();
    component.input = 'different';
    component.invalidate();
    resolve(collection);
    await pending;
    expect(component.result).toBeNull();
    expect(component.loading).toBeFalse();
  });
  it('ignores token results after a server change or component destruction', async () => {
    await lookup();
    let resolve!: (result: any) => void;
    request.and.returnValue(new Promise((r) => (resolve = r)));
    const pending = component.loadTokens();
    fixture.componentRef.setInput('server', '999999999999999999');
    fixture.detectChanges();
    resolve(tokens);
    await pending;
    expect(component.tokens).toBeNull();
    expect(component.input).toBe('');
    component.input = 'test-art';
    await lookup();
    request.and.returnValue(new Promise((r) => (resolve = r)));
    const destroyed = component.loadTokens();
    fixture.destroy();
    resolve(tokens);
    await destroyed;
    expect(component.tokens).toBeNull();
  });
  it('clears loaded token IDs when a different contract or scope is chosen', async () => {
    await lookup();
    request.and.resolveTo(tokens);
    await component.loadTokens();
    component.scope = 'contract';
    component.choiceChanged();
    expect(component.tokens).toBeNull();
  });
});
