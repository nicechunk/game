# Assembled water container certification

This inherited release note describes the preceding 0.1.101 water assembly fix,
not the NCM demolition work in the current release.

## Behavior

Capacity is computed from the union of all actual solid components. The base,
walls and grip may use different materials; an individual component does not
need its own water capacity.

The old grip check counted coplanar surfaces on other components as part of the
grip's width and rejected valid assembled containers. Grip dimensions now use
only explicitly bound components. Occlusion, connectivity, the cavity opening,
side/bottom leaks and capacity still use the complete assembled solid.

JavaScript preview and Rust use the same rule. The contract keeps a separate
bound-component bitmap, retains real seams at 2048 cells per metre, and validates
scratch sizes and queue alignment. It does not seal gaps with coarse voxels.
Account formats, capacity metadata, water resources and existing items remain
compatible.

## Historical evidence

The reference fixture has six components and four encoded materials: copper,
tin, iron and grip material. Each component has zero capacity in isolation. Its
assembled cavity is 12/64 by 10/64 by 12/64 metres, or 5493 mL rounded down.

- The previously published JavaScript and Game ELF reject it; the corrected
  preview and ELF certify 5493 mL.
- Reordering parts, splitting a wall and overlapping identical walls preserve
  capacity. Missing bases, side gaps, detached grips and occluded grips fail.
- A genuine local transaction with multiple input slots creates and certifies
  atomically, equips the container and collects 1000 mL with one durability
  consumed. The water block and Skills progress remain unchanged.
- Budget exhaustion rolls back materials, forge count and item creation.
- Historical validation passed 121 native contract tests, 62 client checks and
  eight browser model scenarios.
- Historical LiteSVM validation ran 112 transactions: 21 assembly cases, 90
  existing water regressions and one old-ELF rejection reproduction. Signature
  verification was disabled in local fixtures; no public transactions were sent.

| Reference operation | Local SBF CU |
| --- | ---: |
| Six-component ordinary forge and Skills sync | 74814 |
| Water forge, certification and Skills sync | 167091 |
| Equip the container | 52321 |
| Collect water with position update | 117335 |

Ordinary forging skips capacity certification. Opting into water capability
keeps creation and certification in one instruction and one atomic transaction.
Collection contacts remain ceil(1000 / capacity in mL), with no carried remainder;
the contract settles durability and rewards.

## Prior release and limits

The preceding work merged the deployed 0.1.100 source, retained bulk recovery and
land management, and released 0.1.101. Only the Devnet Game program was upgraded.
Player and Chunk were preserved.

Historical artifacts are in /workspace/water-assembly-fix-20261020, including
final-verification.json, deployment/game-deployment.json,
public-verification.json and live-browser.json. That work did not push GitHub;
the current source snapshot preserves its engine change separately.

The precise NCF1 from the user's failed model was not available. Those tests
reproduce the same class of error with explicit geometry and do not certify
hidden seams in the user's exact model. General bent-neck or multi-opening
topologies, phased computation and full 3D render regression are separate work.
Eight/twelve-connected-cavity stress fixtures still fail when over budget.
