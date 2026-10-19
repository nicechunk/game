# Bare-hand collection grants no Skills XP — 2026-10-19

## Active policy

- Bare-hand leaf collection and surface pebble/Gravel collection grant no skill XP or levels.
- The active client sends neither a Skills baseline nor a final Skills synchronization for bare hands and makes no Skills-state query for this transaction. Its reward preview uses baseline gathering volume.
- Chunk does not create, read or mutate PlayerProgress/PlayerSkills for bare actions. The legacy account positions remain available as unused readonly compatibility slots.
- Game Backpack reward opcodes 18 and 19 use the existing authenticated Chunk-PDA authority and inventory/mass validation, while omitting mining-event recording. Inventory is awarded normally; the pre-mine mass, last mining action and mining sequence are preserved.
- An authenticated coordinate-bearing Skills synchronization after a bare action returns without creating or mutating Skills, consuming an older tool event, or applying generic source counters. Altered coordinates and untrusted proofs still reject.
- No gathering, exploration, travel or burden XP can accrue later from these bare actions. Equipped collection keeps its normal XP path and contract-authoritative three-point durability charge.
- The existing acquisition path remains: one Gravel plus two Twigs creates a 99-durability stone axe. Twig probability remains 30%.

## Deployment

Devnet and website **0.1.73** are deployed and verified. Mainnet was not changed.

| Program | Finalized slot | Effective SBF bytes |
| --- | ---: | ---: |
| game | 512760987 | 683928 |
| chunk | 512761184 | 371088 |
| skills | 512761309 | 116040 |

Public Solana RPC independently verified effective program bytes, zero padding, unchanged upgrade authorities, unchanged program capacities and closed upload buffers. Temporary upload-buffer secrets were removed. The governed MaterialPhysics table remains revision 2 with all 112 rules preserved.

Upgrade transactions:

- [game](https://explorer.solana.com/tx/4PmYhWMUqCoXEv5J9vqSAYZTtgXkid3w1da7utoDJkpvvRYFSTJkHFpAKAsVoocaqhfLEtfYmAkn14rTUxGagbx6?cluster=devnet)
- [chunk](https://explorer.solana.com/tx/31zJewRov8mcVXnrGGCgWLYC4kGdGkuUGSQ3VfTCS3bUveo2TNYUuPBFvthxkj2mfvhLMv5dHvFZkAHpGX1S5bh3?cluster=devnet)
- [skills](https://explorer.solana.com/tx/5vk2GGhqrJ7VoKNibLLdDQ9G3WiG2defXm2owgC5yQKaowdqTP3ztgSvxQDTifRpBqbYApb1aFcpreGvcsHgxCGK?cluster=devnet)

Website runtime: `play-bundle-d159ba79cefc04be`. All **51 game files** matched their expected SHA-256, including the versioned chain module, configuration and play route.

## Verification

- **118** native contract tests: 43 Backpack, 56 Chunk and 19 Skills.
- **20** distinct related client tests, including no Skills instructions/queries for bare hands, a readonly progress placeholder, baseline preview without skill effects, preserved equipped Skills synchronization, authoritative durability and placement compatibility.
- **56** complete local SBF transactions: 50 policy/boundary/compatibility cases plus six transactions for a new-player lifecycle. The 50-case suite includes two real Ed25519 signature checks for direct reward-call authority attacks.
- Existing and uninitialized Skills/progress accounts remain byte-identical during bare collection; empty accounts are not created. Bare inventory rewards preserve the mining snapshot while updating actual inventory mass.
- Valid injected bare Skills synchronization is a no-op even with an older, unconsumed paid mining event. Invalid-coordinate injections fail atomically, and already claimed resources reject replay.
- Delayed coordinate-less synchronization after bare collection matches the no-harvest control. Continuous bare collection also yields no deferred XP.
- Tool-only and tool→bare→tool controls finish with identical Skills and progress state. Existing single, placed, tree, batch and range tool paths retain their event counters and three-point durability cost.
- A new player starts with empty equipment and inventory, gathers one Gravel and two Twigs with no Skills/progress creation, crafts/equips a 99/99 axe, then gains skill XP on the first equipped harvest. That first paid harvest changes durability to **96** and mining sequence to **1**.

## Public complete transaction simulations

Using the verified public 0.1.73 chain module, all four transactions contain **zero Skills instructions**. Returned Skills, progress, Backpack mining snapshot and equipment match their original state.

| Public case | CU | Packet bytes |
| --- | ---: | ---: |
| pine-leaf-twig | 319105 | 735 |
| pine-leaf-no-twig | 280525 | 735 |
| broadleaf | 312396 | 735 |
| surface-pebble | 387580 | 768 |

Player verification used read-only simulation with player signature verification disabled and a session-refresh fixture. No player mining transactions were broadcast, and real inventory, equipment and progress remained unchanged. The program upgrades were broadcast and finalized.

This policy supersedes the earlier leaf/Skills compatibility behavior described in [the original integration fix](leaf-skills-proof-fix-20261019.md).
