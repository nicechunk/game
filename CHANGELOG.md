# Changelog

All notable public repository changes will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and future tagged releases will follow [Semantic Versioning](https://semver.org/)
where practical.

NICECHUNK Game is currently a pre-release. The application version in
`public/mainnet.json` identifies deployed runtime compatibility and is separate
from an npm package release.

## Unreleased

### Fixed

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
