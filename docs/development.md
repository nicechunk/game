# Development

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`.
- npm 10 or newer.
- Git with recursive submodule support.
- Chromium installed through Playwright.
- A browser and GPU with WebGL2 support for interactive previews.

Node 22 is the maintained development target. An `.nvmrc` file is included for
version managers that support it.

## Clone and Install

```bash
git clone --recurse-submodules https://github.com/nicechunk/game.git
cd game
nvm use
npm ci
npx playwright install chromium
```

If the repository was cloned without submodules:

```bash
git submodule update --init --recursive
```

Do not replace the `chunk.js/` submodule with copied engine files. A Game commit
must point to a published Chunk.js commit so the engine provenance remains
reviewable.

## Verify the Baseline

Run the same core gates before and after a change:

```bash
npm run check
npm run build
git diff --check
```

`npm run check` includes repository policy, all locale dictionaries, Node unit
tests, and Chromium integration tests. See [Testing](testing.md) for focused
workflows.

## Build and Preview

```bash
npm run build
npm run preview
```

Open `http://127.0.0.1:4173/play/`. The preview is assembled in
`.play-preview/` from:

- Public configuration and assets in `public/`.
- Solana bundles in `dist/assets/`.
- The content-addressed game runtime in `.play-runtime/`.

The preview directory is deleted and rebuilt each time `npm run preview` starts.
It is not a deployment package and must not be committed.

If port 4173 is occupied, choose another local port:

```bash
PORT=4175 npm run preview
```

## Source and Generated Files

| Path | Edit directly? | Notes |
| --- | --- | --- |
| `play/` | Yes | Game runtime, UI, controls, and browser tests |
| `src/` | Yes | Shared data and Solana integration |
| `sdk/` | Yes | Typed account and instruction helpers |
| `public/` | Yes, carefully | Public runtime configuration, rules, locales, and assets |
| `config/` | Yes | Source rule configuration |
| `chunk.js/` | No for engine patches | Commit engine changes upstream, then update the submodule pointer |
| `dist/` | No | Generated chain bundles |
| `.play-runtime/` | No | Generated versioned game runtime |
| `.play-preview/` | No | Disposable local preview root |

## Working on Game Behavior

1. Identify the owning truth layer described in [Architecture](architecture.md).
2. Find or add a small pure controller for selection, validation, or payload
   construction instead of embedding new rules in DOM handlers.
3. Preserve canonical IDs from selection through transaction construction.
4. Disable or mark an action pending while a chain submission is in flight.
5. Reconcile the UI from confirmed state and preserve actionable error details.
6. Add regression coverage for the lowest layer that can reproduce the bug.

For chain changes, test account order, signer and writable flags, instruction
data, and post-confirmation state. A UI-only success toast is not sufficient.

## Internationalization

English is the source dictionary in `public/play/locales/en.json`. The client
ships exactly these locales:

```text
en es fr de ja ru ko zh-Hant zh-Hans
```

When adding a user-visible string:

1. Add the English key.
2. Add the same key to every locale.
3. Reference the key through the runtime translation helpers or `data-i18n`
   attributes.
4. Run `npm run check:i18n`.

Do not place translated Chinese text directly in JavaScript, Markdown, or HTML.
The repository policy intentionally limits Han text to locale JSON files.

## Rules and Runtime Configuration

`public/mainnet.json` is the current client configuration index. The filename is
historical; always inspect `chain.cluster` before describing the active network.
The current public cluster is Devnet.

Rule changes can span program accounts, public JSON, adapters, and UI. Verify
that hashes, table addresses, recipe IDs, physical quantities, and tests agree
before committing. Do not silently fall back to a different recipe or item
because an account is missing.

## Working on Chunk.js

Rendering-engine changes belong in
[nicechunk/chunk.js](https://github.com/nicechunk/chunk.js):

1. Make and test the engine change in that repository.
2. Commit and push it there with an English commit message.
3. Update the Game submodule to the published commit.
4. Add or update Game integration coverage when the behavior crosses the
   engine-client boundary.
5. Commit the Game pointer and integration changes separately when practical.

This keeps engine history reusable and prevents source differences between the
submodule and its public repository.

## Commit and Pull Request Quality

- Use a focused English commit subject in the imperative mood.
- Do not mix unrelated generated files, deployment changes, or local logs.
- Explain user-visible behavior and the authoritative layer in the pull request.
- Include tests and manual verification steps.
- Add screenshots for visual changes, using only test accounts and redacted UI.
- Link associated changes in Chunk.js or Programs when applicable.
- Never commit a private key, wallet export, RPC credential, SSH key, `.env`, or
  agent/deployment workspace file.

Review [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.
