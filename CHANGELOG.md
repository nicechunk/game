# Changelog

## 0.1.97 — 2026-10-20

- Make the right-side event log expandable by mouse, touch, or keyboard. Keep
  the latest 300 session entries after preview cards expire, with full wrapping,
  selectable text, native scrolling, and a stable reading position.
- Report a clear land-contract permission notice when mining is blocked during
  target selection or a swing. Limit repeated notices to one per two seconds;
  preserve terrain, tool durability, and the existing ownership rules.
- Translate log controls and permission feedback into all nine Play languages.

## 0.1.72 — 2026-10-19

- Add bare-hand surface pebble pickup and natural leaf gathering.
- Add 30% authoritative Twig drops and the fuel-free 1 Gravel + 2 Twig stone-axe recipe (99 durability).
- Keep tool wear authoritative and preserve the market acquisition path.
- Publish matching Devnet client, resource rules and starter instructions.


All notable public repository changes will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and future tagged releases will follow [Semantic Versioning](https://semver.org/)
where practical.

NICECHUNK Game is currently a pre-release. The application version in
`public/mainnet.json` identifies deployed runtime compatibility and is separate
from an npm package release.

## Unreleased

### Fixed

- Enable bounded shared terrain GPU buffers and ordered cross-column batching
  for Play 0.1.92 while retaining resolution, view distance, detailed water,
  clouds, foreground loading and existing gameplay behavior.

- Treat camera orbit and first-person look as active rendering before admitting
  optional off-camera GPU uploads; resume background residency after settling.
  Preserve foreground loading budgets and all retained rendering quality.
- Reduce camera collision work with bounded per-sweep voxel visit reuse and
  loaded-air tree queries that preserve exact trunk/leaf overlap and fallbacks.

- Removed the built-in starter iron pickaxe and all automatic hotbar grants or
  cache restores. Mining requires a real custodied on-chain tool; retired
  default-tool selectors and receipts are rejected. Crafted tools retain their
  inventory and fixed contract-settled durability. Deployed Player, Chunk and
  web version 0.1.71 to Devnet; verified finalized executable bytes, 50 public
  web files and nine read-only public RPC mining simulations.
- Keep mining contacts local to progress and animation. Successful resource
  transactions apply contract-returned durability instead of local wear or
  refunds. Mining requests identify the equipped tool without a damage amount;
  stale reads cannot overwrite newer confirmed balances. Published with the
  matching Player and Chunk upgrades and web version 0.1.71 on Devnet.
- Reserved the full transaction compute budget for resource placement, including
  canonical terrain and tree checks for both the target and its support. Forest
  placements could exhaust the previous 700,000 CU limit before inventory was
  consumed. Added coverage for the serialized placement transaction and budget;
  dense forest placements also require the matching Chunk program's canonical
  occupancy checks and bounded generation caches.
- Preserve sub-grid forged shapes in gameplay and equipment previews with the
  pinned engine's fine-position runtime meshes.
- Hydrated immutable forged models during ordinary equipped-backpack reads, so
  market inventory, purchased equipment and hotbar icons restore their appearance
  without the creator's local forge library.
- Preserved immutable NCF1 model data when equipping purchased forged items.
  Equipment saves refresh the model and item identity from chain state, so buyers
  do not need the creator's local forge library and stale backpack indexes recover.
- Kept reconstructed hammer contact joints consistent when restoring saved
  forged equipment in gameplay, using the pinned native Chunk.js engine.
- Updated the Chunk.js submodule to make shape capacity advisory while retaining
  material-proof integrity checks. Forging receipts distinguish input validation
  from capacity enforcement; live unrestricted forging also requires the matching
  gameplay-program upgrade.
- Queued continuous block placements while submitting transactions in order.
  Unconfirmed blocks pulse in the world and their event cards show queued,
  submitting, confirmed, or failed states. Inventory reservations prevent
  queueing more blocks than the selected stack contains.
- Restored Enter and numpad Enter to open chat during gameplay, preserving
  message submission, text fields, and IME composition. World-delta confirmation
  remains available through its explicit action button.

### Added

- Public project overview and real gameplay capture.
- Architecture, development, testing, security, and troubleshooting guides.
- Contribution, support, conduct, security disclosure, and notice files.
- GitHub issue forms, pull request template, CODEOWNERS, and CI verification.
- Automated npm, GitHub Actions, and submodule dependency update checks.
- Production-shaped local preview command.
- Current Playwright and Vite maintenance releases, removing resolved
  development-tool advisories from the lockfile.

## Earlier Development

Changes before this changelog are preserved in Git history. They are not
retroactively grouped into releases because the repository did not use public
tags at that time.
