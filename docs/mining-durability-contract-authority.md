# Authoritative mining durability and tool authentication

This document preserves the upstream deployment report for removal of the
default iron pickaxe. Its historical deployment and test results are not results
of the rendering repair; the original report remains in that task's evidence.

> Version 0.1.72 amendment: explicit bare-hand Chunk tags 22/23 allow only natural
> leaves and surface pebbles/gravel. They do not refer to a default tool or debit
> equipment. Tool-assisted paths retain the fixed three-point contract debit.
> See [starter tools](starter-tools.md).

## Historical deployment status

The upstream report records Devnet webpage version 0.1.71: Player upgrade slot
`512675804`, Chunk slot `512676412`, public runtime
`play-bundle-3cbb2d0ec98b270b`. Finalized bytes, authority and buffer closure were
checked for both programs; 50 public file hashes matched. No player mining
transaction was broadcast during those checks.

## Mining flow

1. The first two valid contacts update only local progress, animation and cracks.
2. The third submits the selected tool slot, without a client-supplied debit,
   remaining balance or accumulated local damage.
3. Chunk calls Player through the authenticated mining-progress PDA. Player reads
   authoritative equipment and debits exactly three; balances below three reject.
4. Durability, block changes, rewards and progress are atomic. Cancellation,
   failure and repeat mining of removed blocks do not debit durability.
5. The receipt returns tool identity, current/maximum durability and update slot.
   Clients use receipts or confirmed snapshots, without local subtraction/refund.

Tree harvesting and support collapse charge three per primary operation.
Follow-up collapse instructions prove a paid operation for the same player and
actionId plus adjacency through the Instructions sysvar; they cannot independently
harvest for free. Normal, placed-block, tree, debug batch and debug range paths
settle the charge. Legacy unrewarded tag 5 is disabled.

## State and interface

### Default pickaxe removal

- New accounts, guests, wallet changes, reloads and cache clearing grant no tool.
  Empty hotbars retain the backpack entry.
- Old synthetic `iron_pickaxe` gifts are removed without replacement. Real
  `forged_item` chain identities remain; appearance/material names do not delete them.
- Tool-assisted mining accepts Equipment slots `0..8`; default selector `255` is
  invalid. Restricted bare-hand paths above are separate instructions.
- PlayerProfile remains 773 bytes. Bytes `765..773` are zero-initialized reserved
  space. Old `DUR1` markers establish neither tool ownership nor a default balance.
- Avatar/profile fallbacks imply no pickaxe ownership. The model remains available
  for generic icons and actual forged tools.

PlayerEquipment retains forged tools. Player validates PDA, owner, item kind,
custody marker and actual durability; it reads and returns the selected identity.
Wear updates public equipment identity. Clients submit no durability rewrite.

### Requests and receipts

- Player internal debit tag `18` requires the canonical mining-progress PDA's
  runtime signature. An ordinary signer owned by Chunk cannot impersonate it.
- Primary mining adds a selector byte (`0..8`) and Player/Equipment accounts;
  PlayerProfile and Equipment state are writable.
- The 57-byte receipt is `NCKDUR01`, selector, current/maximum durability, update
  slot and actual item PDA.
- Later skill/position instructions can replace returnData. Clients also recognize
  runtime `Program return:` records from the correct Chunk program in successful
  transactions. Slot and nonzero item PDA must match; default-tool receipts reject.
- Unavailable receipt RPC leaves synchronization pending, without invented balance,
  reversal of confirmed transactions or automatic resubmission. Older requests or
  refreshes cannot overwrite newer results; reads retain the confirmation-slot bound.

Three physical swings remain client interaction progress. Skipping animation or
changing displayed values does not bypass the successful contract operation's cost.

## Transaction size

Structural collapse has no exploration/decoration bonus drops, so omits the two
unused drop tables. Paths that use those tables retain authentication. The
existing maximum three-Chunk, 640-block collapse is an atomic 1,206-byte transaction,
including real equipment, skill baseline and post-mining sync, below 1,232 bytes.

## Historical verification

| Check | Upstream recorded result |
| --- | --- |
| Native contract tests | 73 passed: Chunk 55, Player 17, Game 1 |
| Related client tests | 65 passed, including no-default-tool and real-tool browser flows |
| Additional WebGL2 rendering | SwiftShader/Vulkan initialization failed; excluded from passing counts |
| Complete SBF mining replay | 35: 8 legal successes, 27 illegal/replay rejections |
| Cryptographically verified recipient attacks | 2 rejected, profiles unchanged |
| Existing placement compatibility | 12 complete transactions matched expectations |
| Program builds | Player/Chunk succeeded; Game used an earlier read-only Devnet binary |
| Web build/publication | Chain and complete Play runtime built; 0.1.71 published |
| Post-deployment public RPC simulation | 9: 4 legal successes, 5 illegal rejections; actual equipment unchanged |

Local replay used previously captured Devnet accounts and Game binary, with
boundary states configured in LiteSVM. Main replay disabled signature verification;
two separate authority attacks enabled it. No-default-tool browser tests exercised
model recovery, hand selection, eligibility and remote-message authentication
without GPU rendering. WebGL2 had its separately recorded environment failure.

The nine public-RPC simulations used the newly downloaded chain module and live
equipment. Normal/adjacent mining cost three, two independent operations six, and
debug batch three; rewards and receipts were checked. Selector 255, invalid slots,
wrong blocks, read-only equipment and legacy uncharged entry points rejected.
Expired sessions were refreshed only in simulations (`sigVerify:false`). Actual
equipment bytes were rechecked after each; no player transaction was broadcast.

Coverage included 20-to-17, 3-to-0, rejection at 2/0, empty equipment, legacy profile
markers, missing/forged parameters, wrong PDA/owner, read-only state, expired
sessions, rollback after a later instruction fails, repeat mining under a new
signature, and two independent operations with one actionId still charging six.
Primary mining plus cross-Chunk collapse costs three. Different equipment slots
sharing an item-design PDA synchronize durability separately.

Historical artifacts are under `/workspace/no-default-pickaxe-20261019/`:
`report.json`, `full-mining-replay.json`, `signed-authority-tests.json`,
`packet-verification.json`, `nicechunk-programs-incremental.patch`, and
`game-incremental.patch`. They are external evidence, not repository fixtures.

## Historical deployment verification

That upstream task published Player, Chunk, then the matching webpage; the Game
backpack program was not upgraded. Chunk grew by 10,240 bytes to 383,984 bytes;
Player already had capacity. Confirmed/finalized status and original code were
checked before resuming, without repeated growth or Player upgrade. Effective
code prefixes matched tested ELFs, spare capacity was zero-filled, authorities
were unchanged, buffers closed, temporary buffer keys removed and upgrades
finalized. A scoped web installer also checked three non-release files remained
unchanged. That deployment task made no Git commit or push.

Its `deployment/` evidence includes `deployment-summary.json`,
`public-chain-verification.json`, `web-release/public-verification.json` and
`live-mining-verification.json`. Rendering repair verification and deployment
scope are recorded separately in its delivery report.
