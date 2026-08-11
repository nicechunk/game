# Contributing to NICECHUNK Game

Thank you for helping improve NICECHUNK. The Game repository joins rendering,
browser interaction, multiplayer transport, and Solana state, so small changes
can cross important trust boundaries. Focused pull requests with explicit tests
are the safest and fastest way to contribute.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before You Start

- Search existing [issues](https://github.com/nicechunk/game/issues) before
  opening a new one.
- Use a bug report for reproducible current behavior and a feature request for
  a proposed change.
- Read [Architecture](docs/architecture.md) and identify which truth layer owns
  the behavior.
- For security-sensitive findings, stop and follow [SECURITY.md](SECURITY.md)
  instead of opening a public issue.

Large features, account-schema changes, and cross-repository work should begin
with an issue so maintainers can confirm scope before implementation.

## Repository Ownership Boundaries

- Game UI, input, client-side chain adapters, and integration tests belong here.
- General rendering and engine behavior belong in
  [Chunk.js](https://github.com/nicechunk/chunk.js).
- Authoritative instruction validation and PDA state transitions belong in
  [NICECHUNK Programs](https://github.com/nicechunk/nicechunk-programs).
- Guardian service and protocol work belongs in
  [NICECHUNK Guardian](https://github.com/nicechunk/nicechunk-guardian).

Land a change in its owning repository first, then update Game integration or
the `chunk.js/` submodule pointer. Do not copy a private or unpublished engine
tree over the submodule.

## Development Setup

```bash
git clone --recurse-submodules https://github.com/nicechunk/game.git
cd game
nvm use
npm ci
npx playwright install chromium
npm run check
npm run build
```

See [Development](docs/development.md) for the build and local preview workflow.

## Making a Change

1. Create a branch from the latest `main`.
2. Keep the change scoped to one problem or feature.
3. Preserve canonical item, recipe, block, account, and program identifiers.
4. Add regression tests at the authoritative boundary.
5. Update English and all eight additional locale dictionaries for new copy.
6. Update documentation when behavior, setup, configuration, or risk changes.
7. Run the complete verification suite before opening a pull request.

Do not use translated labels or icons as transaction identifiers. Do not mark a
transaction complete until confirmed state has been reconciled.

## Code Style

- Match the existing ESM and browser-native style.
- Prefer small pure controllers for rules and payload construction.
- Keep DOM code responsible for presentation, not canonical game identity.
- Use comments only for non-obvious invariants or protocol constraints.
- Keep source files ASCII unless a locale or existing asset format requires
  otherwise.
- Avoid new runtime dependencies when a small platform API is sufficient.
- Validate all URL parameters, local storage, Guardian messages, RPC responses,
  and on-chain account data before use.

There is no blanket formatter in this repository. Preserve nearby formatting
and use `git diff --check` to catch whitespace errors.

## Tests

Required before a pull request:

```bash
npm run check
npm run build
git diff --check
```

Examples of expected coverage:

- Chain instruction changes assert account order, signer/writable flags, and
  serialized instruction bytes.
- UI state changes include a browser test for pending, success, failure, and
  duplicate-click behavior when relevant.
- Responsive changes cover the smallest supported mobile layout involved.
- Physical quantity changes test volume, density, mass, and aggregate values.
- Chunk.js changes have upstream engine coverage plus a Game integration test.

Read [Testing](docs/testing.md) for focused commands and manual checks.

## Internationalization

English is the source locale. Every new key must exist in all nine files under
`public/play/locales/`. Run `npm run check:i18n` before committing. Do not hide a
missing translation with a hard-coded fallback in a component.

## Commit Messages

Use a concise English subject in the imperative mood, for example:

```text
Preserve canonical item IDs in market listings
```

Explain the reason and non-obvious compatibility constraints in the body when
needed. Do not amend unrelated history or include generated deployment output.

## Pull Requests

A useful pull request includes:

- The user-visible problem and resulting behavior.
- The truth layer and repository boundary involved.
- Tests added or changed.
- Manual verification steps.
- Screenshots or recordings for visual changes.
- Related Chunk.js or Programs commits for cross-repository changes.
- Known limitations and migration impact.

Use only disposable Devnet accounts in evidence. Redact private keys, recovery
data, RPC keys, unrelated wallet addresses, and private transaction context.

## Files That Must Never Be Committed

- Wallet exports, seed phrases, or private keys.
- RPC credentials or authenticated endpoint URLs.
- `.env` files, SSH keys, and host inventories.
- Browser profiles, local storage dumps, or session keys.
- Deployment logs, server backups, or production archives.
- `node_modules/`, `dist/`, `.play-runtime/`, or `.play-preview/`.
- Local agent instructions or machine-specific workspace files.

The repository policy catches common patterns, but contributors remain
responsible for reviewing every staged file.

## Licensing

By submitting a contribution, you agree that it may be distributed under the
repository's [Apache License 2.0](LICENSE). You retain copyright in your work.
