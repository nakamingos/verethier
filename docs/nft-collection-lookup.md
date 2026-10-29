# NFT collection lookup

When creating an NFT rule in the Control Room, an admin can enter an OpenSea collection slug or its `https://opensea.io/collection/<slug>` URL. Finding a collection shows its name and every declared contract/network. Unsupported networks and contract standards stay visible but cannot be selected. When several supported contracts exist, the admin must choose one; lookup never creates several rules or silently chooses the first contract.

Choose the rule's scope, then explicitly copy the selection into the normal rule fields. Lookup details fold away afterward and can be reopened with **Change lookup**. The existing **Review changes** and **Save rule** steps still apply.

- **Collection token IDs (fixed list)** is the default. Bouncer reads the complete paginated collection inventory, checks token identities, networks, standards and reported item counts, and selects this contract's IDs. The result is bounded to 1,000 unique IDs and 6,000 characters after range compression. No partial list is returned when the provider fails, repeats pages, supplies ambiguous network identity, or exceeds the limits. A saved fixed list does not expand for later mints or marketplace changes.
- **Entire ERC-721 contract** is an explicit alternative. It accepts every NFT at that contract, including future mints and any other collections sharing it. This is often useful for a large collection with its own dedicated contract, but the admin must confirm that this is the intended scope. Lookup does not infer that a marketplace collection occupies an entire contract.
- ERC-1155 lookup always needs explicit token IDs. It cannot use entire-contract scope or silently fall back to the manual editor's existing IDs 0–99 default. Saving also checks the expected standard against the live contract, so an ERC-721 lookup cannot accidentally become that ERC-1155 default.

For a collection spanning contracts, create separate contributing rules with the same channel, role and minimum to combine their item counts. Full inventory discovery is bounded to 25 pages of 200 items, a 30-second discovery budget and the per-rule limits above. A mixed collection whose non-EVM inventory cannot be resolved requires explicit manual scoping. Lookups never fetch URLs supplied by an admin or token metadata: requests use the fixed OpenSea API origin.

Saved rules use Bouncer's existing network, contract, token-ID and display-name fields. The marketplace slug, URL and expected-standard assertion are not stored as eligibility requirements. Changing a slug or losing OpenSea access later does not change a saved rule's scope. Holdings still use the existing RPC/metadata checks, including network-scoped wallet proofs, traits, counts, transfers and exports. Direct contract entry remains available and existing rules retain their behavior. The lookup assists new rules; existing-rule editing keeps its current fixed contract/network policy.

## Configuration

Set `OPENSEA_API_KEY` on the backend only. It is optional for Bouncer overall; without it, lookup reports that it is not configured and direct contract entry still works. Keep the key out of frontend variables and source control. No database migration or additional dependency is required.

The adapter uses the documented [collection metadata](https://docs.opensea.io/reference/get_collection), [contract metadata](https://docs.opensea.io/reference/get_contract) and [collection inventory](https://docs.opensea.io/reference/get_nfts_by_collection) endpoints. It maps marketplace chain names only to Bouncer's supported Ethereum, Base and Robinhood networks; live provider availability must be verified with a real key before advertising coverage. Slugs are marketplace identifiers, not a universal blockchain naming registry.

Successful lookup results are cached in memory for five minutes with bounded capacity and concurrent request sharing. Token-discovery failures discard partial results and clear the corresponding collection metadata so a retry can refresh stale counts. Each upstream request times out after ten seconds, responses are size-limited, and at most four upstream requests run concurrently. The authenticated server endpoint has a separate throttle and rechecks live server access after provider work. The API key and raw provider errors are never returned to the browser.

## Validation and remaining live checks

Automated coverage includes strict input/URL handling, credentials and error sanitization, incomplete pagination and exact uint256 IDs, shared/multiple contracts, cross-chain address ambiguity, ERC-1155 scope, standard changes at save time, session/server authorization, stale browser responses and canonical rule payloads. Browser scenarios cover fixed ERC-1155 selections, explicit whole-contract ERC-721 rules and missing-key manual entry at desktop and mobile sizes.

Local validation on October 28, 2026 passed: 1,595 backend tests across 77 suites, 17 targeted frontend tests, both production builds, nine NFT collection browser scenarios at 1280/393/320 pixels, and the existing admin browser smoke at five widths. The browser cases include dark and light themes.

Read-only live checks on October 28, 2026 initially found an expired key. The replacement temporary key then passed collection, contract and inventory requests through Bouncer's compiled lookup service. The user reports that this key expires after seven days; replace it before relying on continued lookup access. No rules or database records were changed, and these checks required no implementation fixes.

| Live case | Result |
| --- | --- |
| Autoglyphs, dedicated Ethereum ERC-721 | All 512 IDs loaded across three pages and compacted to `1-512`. |
| Ringers, shared Ethereum ERC-721 contract | All 1,000 IDs loaded across five pages, producing `13000000-13000999`. A Fidenza token on the same contract was confirmed outside this selection. |
| MAX PAIN AND FRENS, shared Ethereum ERC-1155 contract | Its single 77-digit token ID was preserved exactly, without rounding or replacement by IDs 0–99. |
| Parallel Alpha [Base], ERC-1155 | All 583 IDs loaded across three pages, including ID 10755; network and standard resolved correctly. |
| ENS, multiple contracts | Both Ethereum contracts resolved with their distinct ERC-721 and ERC-1155 standards. Full inventory was not requested. |
| Doodles, collection URL input | URL resolved correctly; its 9,998-item inventory was rejected as too large for a fixed snapshot, with no partial IDs returned. |
| Nonexistent collection | Returned the safe collection-not-found message and HTTP 404. |

- [x] Add `OPENSEA_API_KEY` to the local backend environment.
- [x] Replace the expired key and confirm access to contract metadata and collection NFT inventory.
- [x] Resolve a real dedicated ERC-721 collection and discover its complete fixed-list selection.
- [x] Resolve a shared-contract collection and verify that the fixed list excludes an unrelated collection's token.
- [x] Resolve real Ethereum/Base ERC-1155 collections with IDs outside 0–99, preserving exact integer values.
- [x] Confirm Ethereum/Base provider chain names, contract responses, multi-contract lookup, pagination and oversized/not-found handling.
- [ ] Save real fixed-list and entire-contract rules through the admin UI and confirm their intended scopes. Check known-positive and negative holdings, then perform fresh ownership checks. Fixture coverage already exercises the UI/save boundary but does not replace this live acceptance.
- [ ] Confirm Robinhood provider coverage before claiming OpenSea lookup support for that network.
- [ ] Exercise bounded multi-contract inventory discovery when a suitable collection is available. ENS proves metadata lookup only.
- [ ] Confirm recovery from actual provider failures/rate limits if encountered; fixture tests cover these paths without deliberately exhausting API access.
- [ ] Replace the seven-day temporary key with durable API access.
