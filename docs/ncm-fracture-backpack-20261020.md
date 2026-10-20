# NCM fracture feedback and backpack refresh

The 0.1.104 client restores confirmed demolition feedback and immediate inventory
visibility on the 0.1.103 contracts. No program upgrade or player transaction is
required for this release.

## Fracture rendering

The building confirmation branch returned before the existing terrain fracture
effect. It now emits that effect after confirmation. NCM render material IDs are
kept separately from recovered resource IDs: material 55 is a wooden plank,
while resource block 55 is a loose stone. Fracture geometry uses the recovered
resource family for dynamics and the original NCM atlas layer and transparency
for appearance. NCM cells always fracture as complete cubes. The existing
per-cell and pooled particle limits, lifetime, and disposal remain in force.

## Backpack reads

Post-mutation reads used to skip attempts whenever a periodic read was active.
A slow pre-confirmation read could consume the complete retry window. Mutation
refresh now waits for the active read, then reads the authoritative backpack.
It verifies the transaction execution slot when available and stored resource
quantities against the pre-action snapshot. This also handles stacked rewards
and two transactions within the same Solana slot. Behind replicas cannot
replace newer inventory snapshots. Requests remain isolated across wallets.

Every backpack opening entry uses the shared open callback to refresh inventory.
Reopening selects the complete backpack category, making resources visible even
after a previous visit to the contracts, items, or land deeds category.

## Verification boundaries

- Browser regression covers a read slower than the previous retry window,
  behind-replica responses, same-slot stacked rewards, and wallet changes.
- Actual production SDK decoding and inventory icons are checked against
  read-only live account bytes at desktop and two mobile sizes.
- WebGL fracture rendering covers wood, glass, and brick, including expiry.
- Existing demolition persistence, ownership, mining, backpack, and layout
  regressions remain part of the focused checks.

Browser fixtures and software WebGL do not replace the player's real wallet
acceptance or hardware FPS measurements. Free debug construction and historical
no-reward removals retain the 0.1.103 rules.
