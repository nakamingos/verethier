import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  PixelSelectComponent,
  SelectChoice,
} from '../pixel-select/pixel-select.component';

interface CollectionContract {
  chain: string;
  network: string | null;
  network_name: string;
  contract_address: string;
  token_standard: 'erc721' | 'erc1155' | null;
  supported: boolean;
}
interface CollectionLookup {
  slug: string;
  name: string;
  url: string;
  contracts: CollectionContract[];
}
interface CollectionTokens {
  collection: string;
  network: string;
  contract_address: string;
  token_ids: string[];
  token_ids_input: string;
  resolved_at: string;
}
export interface NftCollectionSelection {
  expected_token_standard: 'erc721' | 'erc1155';
  contract_address: string;
  network: string;
  collection_name: string;
  token_ids: string;
}

@Component({
  selector: 'app-nft-collection-lookup',
  imports: [FormsModule, PixelSelectComponent],
  templateUrl: './nft-collection-lookup.component.html',
  styleUrl: './nft-collection-lookup.component.scss',
})
export class NftCollectionLookupComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) server = '';
  @Input({ required: true }) request!: (path: string) => Promise<any>;
  @Input() disabled = false;
  @Output() selection = new EventEmitter<NftCollectionSelection>();
  input = '';
  loading = false;
  error = '';
  result: CollectionLookup | null = null;
  tokens: CollectionTokens | null = null;
  selected = '';
  scope = 'tokens';
  applied = '';
  private epoch = 0;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['server']) {
      this.input = '';
      this.invalidate();
    }
  }
  ngOnDestroy() {
    this.epoch++;
  }
  invalidate() {
    this.epoch++;
    this.loading = false;
    this.result = null;
    this.tokens = null;
    this.error = '';
    this.applied = '';
    this.selected = '';
    this.scope = 'tokens';
  }
  get candidate() {
    return this.result?.contracts.find((c) => this.key(c) === this.selected);
  }
  key(contract: CollectionContract) {
    return `${contract.chain}:${contract.contract_address}`;
  }
  get contractChoices(): SelectChoice[] {
    return (this.result?.contracts || []).map((c) => ({
      value: this.key(c),
      label: `${c.network_name} · ${c.contract_address}${c.supported ? '' : ' (unsupported)'}`,
      disabled: !c.supported,
    }));
  }
  get scopeChoices(): SelectChoice[] {
    return [
      { value: 'tokens', label: 'Collection token IDs (fixed list)' },
      ...(this.candidate?.token_standard === 'erc721'
        ? [{ value: 'contract', label: 'Entire ERC-721 contract' }]
        : []),
    ];
  }
  choiceChanged() {
    this.epoch++;
    this.loading = false;
    this.tokens = null;
    this.error = '';
    this.applied = '';
    if (this.candidate?.token_standard !== 'erc721') this.scope = 'tokens';
  }
  private path(collection: string, candidate?: CollectionContract) {
    return (
      `/servers/${encodeURIComponent(this.server)}/nft-collection?` +
      new URLSearchParams({
        collection,
        ...(candidate
          ? {
              network: candidate.network!,
              contract: candidate.contract_address,
            }
          : {}),
      })
    );
  }
  async lookup() {
    if (this.disabled || this.loading || !this.input.trim()) return;
    const input = this.input.trim();
    this.invalidate();
    const epoch = this.epoch;
    this.loading = true;
    try {
      const result: CollectionLookup = await this.request(this.path(input));
      if (epoch !== this.epoch) return;
      this.result = result;
      const supported = result.contracts.filter((c) => c.supported);
      // Never silently pick one part of a collection spanning multiple contracts.
      this.selected = supported.length === 1 ? this.key(supported[0]) : '';
    } catch (error) {
      if (epoch === this.epoch) this.error = (error as Error).message;
    } finally {
      if (epoch === this.epoch) this.loading = false;
    }
  }
  async loadTokens() {
    const candidate = this.candidate,
      collection = this.result;
    if (this.disabled || this.loading || !candidate?.supported || !collection)
      return;
    const epoch = ++this.epoch;
    this.loading = true;
    this.tokens = null;
    this.error = '';
    this.applied = '';
    try {
      const tokens: CollectionTokens = await this.request(
        this.path(collection.slug, candidate),
      );
      if (epoch !== this.epoch) return;
      if (
        !tokens.token_ids?.length ||
        !tokens.token_ids_input ||
        tokens.collection !== collection.slug ||
        tokens.network !== candidate.network ||
        tokens.contract_address !== candidate.contract_address
      )
        throw new Error(
          'The lookup changed. Find the collection again before using its tokens.',
        );
      this.tokens = tokens;
    } catch (error) {
      if (epoch === this.epoch) this.error = (error as Error).message;
    } finally {
      if (epoch === this.epoch) this.loading = false;
    }
  }
  useSelection() {
    const candidate = this.candidate,
      collection = this.result;
    if (
      this.disabled ||
      this.loading ||
      !candidate?.supported ||
      !candidate.network ||
      !collection
    )
      return;
    if (this.scope === 'tokens' && !this.tokens) return;
    if (this.scope === 'contract' && candidate.token_standard !== 'erc721')
      return;
    const tokenIds =
      this.scope === 'tokens' ? this.tokens!.token_ids_input : '';
    this.selection.emit({
      expected_token_standard: candidate.token_standard!,
      contract_address: candidate.contract_address,
      network: candidate.network,
      collection_name: collection.name,
      token_ids: tokenIds,
    });
    this.applied =
      this.scope === 'tokens'
        ? 'Fixed token selection copied.'
        : 'Entire-contract scope copied.';
  }
}
