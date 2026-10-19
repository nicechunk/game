# Leaf harvesting Skills proof fix — 2026-10-19

## Failure

The reported `0x1dcd` is **7629 / Skills::InvalidMiningProof**. The Chunk mining instruction completed inside simulation, then the final Skills instruction rejected the proof. The complete transaction rolled back.

The Skills proof matcher recognized existing reward mining tags 8, 9, 16, 20 and 21, but omitted the new authenticated bare-hand mining tag **22** and surface pebble pickup tag **23**. Both use the single-block coordinate layout. The earlier starter-tool lifecycle verification omitted the final browser Skills synchronization, which allowed this integration failure to go undetected.

## Fix and deployment

The Skills matcher now recognizes tags 22 and 23 while retaining the trusted Chunk program, owner-specific progress PDA, GlobalConfig, exact coordinate comparison and preceding-instruction proof requirements. Chunk continues to authorize bare-hand targets and rewards; repeated Skills synchronization cannot multiply XP or materials.

| Field | Verified value |
| --- | --- |
| Network | **Devnet** |
| Skills program | `5gkdfmRJogdSdPrT8rvnEkPdn2N2fLBnQ6YDdegUcu3P` |
| Finalized deployment slot | **512754451** |
| Effective SBF bytes | **115,936** |
| SBF SHA-256 | `3806c621748ea53dee67e298ac4a65cd11f0a4d77ce38fe5d811ec118e7ff9d4` |
| Existing capacity | **128,144 bytes**, no extension |

[Finalized upgrade transaction](https://explorer.solana.com/tx/3JmR82nZ144QqaTrszgSG76gww9CX1a2Us5C1tCiMFgf9e5Zy6q6ZAJLhf1HNXVJ26eheP2kteKaRLQrTfaua8so?cluster=devnet)

Project RPC and independent public RPC verified the finalized program bytes, zero padding, unchanged upgrade authority and closed upload buffer. The temporary upload-buffer secret was removed. The existing public **0.1.72** client can use the upgraded Skills program directly.

## Regression

- **19** native Skills tests passed, including both new tags, malformed payloads, substituted accounts, coordinates and untrusted programs.
- **33** complete SBF transactions passed their expectations: **2** reproductions against the previous deployed Skills binary; **15** legal transactions and **16** adversarial rejections against the candidate.
- Candidate cases include pine leaves with and without Twig rewards, broadleaf leaves, surface pebble pickup, initially empty Backpacks and uninitialized Skills, old equipped mining routes (single, placed, tree, batch and range), duplicate synchronization, cross-transaction proof reuse, altered coordinates, altered owner or GlobalConfig, future proofs and absent mining instructions.
- Every rejected SBF transaction preserved game account state. Bare-hand cases preserved equipment, and equipped compatibility cases retained the contract's fixed three-point durability charge. Duplicate synchronization produced identical Skills and Backpack state to a single synchronization.
- The public **0.1.72** chain module was fetched again and its SHA-256 matched the verified release. The complete public transaction includes compute budget, a session-refresh fixture, Skills baseline, mining, position update and final Skills synchronization.
- Before upgrade, public read-only leaf and pebble simulations reproduced **7629** in final synchronization. After upgrade, all four public complete transaction simulations succeeded:

| Public case | CU | Packet bytes |
| --- | ---: | ---: |
| Pine leaf with Twig | 386,253 | 868 |
| Pine leaf without Twig | 359,311 | 868 |
| Broadleaf leaf | 379,546 | 868 |
| Surface pebble | 453,603 | 901 |

Player workflow verification used read-only simulation with player signature verification disabled; no player mining transactions were broadcast and live player inventory, equipment and progress were unchanged. The upgrade transaction was broadcast and finalized. Mainnet was not changed.
