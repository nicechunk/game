# Devnet Twig material-table update — 2026-10-19

The remaining treasury-authorized MaterialPhysics update is finalized on **Devnet**. The table now contains **112 rules at revision 2**. It adds Twig (block ID 54), density **650 kg/m³**, standard volume **250,000 mm³**, while preserving all 111 existing material entries byte for byte.

| Field | Verified value |
| --- | --- |
| MaterialPhysics PDA | `5d3GiTgP3irdBbpA97fkNmb71rthdqdJr4TBSWLQg4ne` |
| Owning Game program | `6CurnvneezBuHwPUnrCiFg1QMWeUF67ufQxYebyr2UP7` |
| Treasury signer, verified against on-chain GlobalConfig | `CtPV2vmqNNwUSfMu5nz58ZtMPy6ZvxL4LyNdPHVW7WvF` |
| Finalized transaction slot | **512746784** |
| Table SHA-256 | `deb9298f0281197633d9025783fa2aa03a55666cb93cb3c40907e999489ef490` |
| Transaction fee | **5,000 lamports / 0.000005 SOL** |

[Finalized transaction on Solana Explorer](https://explorer.solana.com/tx/24kUm7NMC4iYvAstrWDnPvNgV6wac9oeZhMYrUmjyx3ji7unHVF4CVTsgPgtJy9LuiN73MTqFyzHvzKcyeARdNYH?cluster=devnet)

## Verification

- Real-signature update simulation passed: **23,198 CU**, **1,213 bytes**. Its returned table matched all expected bytes.
- A signed update using the deployment key was rejected with **6441**; a treasury-signed update using the old revision was rejected with **6439**.
- The finalized update was checked using the project RPC and independently using public Solana RPC, including table bytes, GlobalConfig treasury, program bytecode, upgrade authorities and zero padding.
- Game remains the verified release deployed at slot **512736514**; Chunk remains the verified release deployed at slot **512735048**. This operation updated the governed table through the existing program instruction. Mainnet was not changed.
- Both source MaterialPhysics documents now contain identical rules at revision 2. The two resource-drop physics checks passed.
- Using the released **0.1.72** client module against the updated live table, three read-only simulations passed: bare gathering (**955,718 CU**), gathering and crafting a **99/99** axe (**990,868 CU**), and gathering → crafting → equipping → first harvest (**1,199,958 CU**, **1,192 bytes**). The final equipment value and client receipt both reported **96** durability.
- Player inventory and equipment remained unchanged because these player workflows were simulated. The treasury update was broadcast and finalized; its only balance debit was the transaction fee.

The protocol fallback for older tables remains available. An explicit governed Twig rule takes precedence, so this table now supplies the same Twig physics directly.
