# Bulk placed-block recovery and land deeds

## Bulk selection

Resolve each unique chunk's current ChunkPlaced account in bounded account batches. Validate account ownership, layout and active world height before considering natural generation. A placed record takes priority even where the original terrain was air or the same material. Keep its exact recorded block ID and volume. Share one world-configuration read across natural targets.

Natural selections retain compressed range instruction 21. Placed selections use existing reclaim instruction 16, grouped into at most eight records per same-chunk transaction. Include real equipped-tool identity and skill synchronization; one action ID spans the selection. Only compute exhaustion splits a failed operation. Preserve operation kind during splitting; stop on other failures and retain confirmed, failed and unsubmitted subsets. An uncertain submitted signature is never replayed.

## Contracts and deeds

Only available, unused MarketUser contracts appear in the single blank-contract stack. Reserved units are not available contracts. Successful registration already atomically consumes the contract units and establishes the BuildSite record; this release does not change that contract or mint a second asset.

Show each registered parcel independently in the Land deeds category. A management shortcut carries the exact owner and unsigned 64-bit foundation ID as a string. Equipping it limits the building editor to that owned, active parcel. Ownership refresh invalidates lost deeds; loading errors do not erase cached shortcuts. A restored shortcut cannot establish ownership. Switching deeds invalidates prior previews. An unused contract opens registration even if other parcels already exist.

Management shortcuts use empty local hotbar positions and do not displace physical chain-custodied tools. Removing a selected deed or consuming a selected contract leaves the selected position empty. Future transfers can refer to the same existing on-chain parcel identity; this release does not add a market transfer instruction.

Validation records, public deployment state and independent rollback package are stored outside the source repository in the delivery workspace. Browser fixtures and unsigned Devnet simulation do not establish a real user's login or hardware performance.
