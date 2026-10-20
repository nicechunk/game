# NCM building tool demolition

## Current debug policy

NCM buildings can be imported and destroyed without consuming or returning
backpack resources. Resource charging is deferred at the owner's explicit
request. Ordinary placed terrain blocks retain their existing recovery rules.

## Interaction and persistence

- Camera and pointer rays resolve a building cell before terrain behind it.
- A real equipped tool strikes the selected cell. The existing contact/reach
  checks apply; building materials use bounded contact counts.
- Only the current on-chain land owner can demolish the building. Other players
  receive the existing land permission message.
- The Building program instruction 7 records a removal in a revision-scoped PDA
  and atomically invokes the Player program to consume one tool durability.
  Replays, obsolete revisions, changed tools and broken tools fail atomically.
- Each lazily allocated section covers 16 x height x 16 local cells. At most
  256 sections exist per building revision, each at most 8272 bytes.
- Worker meshing, collision geometry and action hits all use the same verified
  removal mask. The original NCM payload and content hash remain immutable.
- Confirmations update the model. Rejected or unknown transactions never erase
  terrain speculatively. Unknown outcomes reconcile from chain state.
- Persistent disk geometry caches cannot establish current demolition state.
  Damaged buildings require authenticated mask reads; memory caches include
  the edit version and slot. Late undamaged snapshots cannot restore cells.
- Reimporting a damaged building creates a fresh revision and restores the
  imported model. Old removal masks remain scoped to their old revision.

The debug removal program validates ownership, bounds, revision and tool
custody. It does not grant resource rewards from a client-supplied material.
Future paid construction needs its own authoritative material accounting.

The release also preserves the concurrently deployed water assembly support.
No fog, shadows, resolution, cloud or terrain performance settings are changed.
