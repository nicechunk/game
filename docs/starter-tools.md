# Starter tools

New players receive no default mining tool. Tools can be purchased from the existing market or made from gathered materials.

## Gathering

- With an empty hotbar slot selected, click a visible surface pebble once. The supporting ground remains in place. All pebble appearances produce one Gravel resource, volume 500,000 mm³.
- Bare hands can also gather natural Gravel at the original dry surface and strike natural broadleaf or pine leaves. These use three local contacts. Underground terrain, trunks, ores and placed blocks require equipment.
- Each removed natural leaf independently yields one Twig with probability 3,000 / 10,000. The roll hashes the canonical seed and coordinates with salt `0x54574947`. It excludes wallet, action nonce and retry count. Removing a leaf is recorded once; retrying cannot reroll it. The same rule applies to leaves removed with tools or by a tree-felling operation.
- Twig is raw resource/block ID **54**, resource group **29**. A twig has a forked brown model, 250,000 mm³ (250 cm³) of recovered wood, density 650 kg/m³, and nominal mass 162.5 g (integer chain mass rounds to 163 g). Bounding dimensions include air. Devnet MaterialPhysics revision **2** explicitly includes Twig among its **112 rules**, after a treasury-signed update finalized at slot **512746784**. The previous 111 material rules and treasury-only update authority are preserved. The protocol default still covers tables with no entry for ID 54, and explicit governed entries take precedence. Twigs are inventory resources, not placeable terrain. See the [material-table update receipt](treasury-material-physics-update-20261019.md).
- Surface pickup flags are a canonical per-chunk PDA, `surface-picked-v1 / global config / chunk X / chunk Z`: 48 bytes, including a 256-bit column bitmap. Pickup authenticates the session, canonical terrain, decoration rule, land protection and Backpack. Already picked or mined locations reject; a failed transaction rolls back both rewards and the flag. Digging the supporting terrain does not award a second pebble.

## Recipe

Open **Backpack → Smelting → Basic Stone Axe**:

| Input | Quantity |
| --- | ---: |
| Gravel / surface pebble | 1 |
| Twig | 2 |

Output: **one Basic Stone Axe, current/max durability 99/99**. No fuel, constructed station, skill level or pre-existing tool is required. Only one axe is made per transaction; skills do not multiply it. Input stacks are partially consumed, with unused quantities retained.

The fixed recipe is instruction **Game / Backpack namespace 1 / tag 17**, public recipe ID **9001**. It is compiled into the contract and does not use a mutable smelting recipe-table account. Table identifier 900 in the UI is a dispatch identifier, not a claimed initialized PDA. The contract supplies the canonical NCF1 model and all output statistics. The client supplies only item ID and input slot indexes. An immutable ForgedItem PDA gives the item normal Backpack, equipment and market custody behavior. The head is gray stone, with a brown branch handle and tan binding.

Equip the finished axe from the Backpack. Every successful tool-assisted mining operation atomically costs **3 durability**, so a new axe supports **33 successful operations**. The client neither deducts nor restores durability locally; it accepts the contract receipt and authoritative equipment snapshot. Bare-hand actions have no Equipment account and do not invoke the durability receiver.

Players still need the usual registered profile, Backpack, session authorization and SOL for transaction fees and account rent. Selecting an unusable target does not create a free mining route.

## Verification

Validation artifacts, SBF replays, deployment receipts and public checks are recorded in the release report. Local SBF tests cover empty-inventory bootstrapping through equipping and first harvest (99 → 96), replay denial, invalid bare-hand targets, forged recipe data, signature boundaries, failure atomicity, exact partial-stack spending, tree rewards, full Backpacks and placement compatibility.

The batch inventory path uses bounded reusable scratch buffers. Its outcomes are compared byte-for-byte with the previous storage algorithm across 400 randomized fragmented inventories. It retains existing ownership, canonical-address, material-physics and custody checks.

### Full mining transaction and Skills

Skills must recognize authenticated Chunk bare-hand mining (tag **22**) and surface pebble pickup (tag **23**) when the browser submits its final mining-coordinate synchronization. This compatibility fix is deployed on Devnet at slot **512754451**. Full transaction regression includes baseline Skills synchronization, mining, the player position update when present, and final Skills synchronization; testing the mining instruction alone does not cover this transaction. See the [failure reproduction and upgrade verification](leaf-skills-proof-fix-20261019.md).
