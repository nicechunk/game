# Testing

NICECHUNK tests the game at pure-controller, chain-payload, browser-integration,
layout, and build boundaries. A change is complete only when the lowest
authoritative boundary and the visible behavior are both covered where
applicable.

## Standard Verification

```bash
npm run check
npm run build
git diff --check
```

On a new Linux machine:

```bash
npm ci
npx playwright install --with-deps chromium
npm run check
npm run build
```

## Check Layers

### Repository policy

```bash
npm run check:policy
```

The policy rejects credential-like paths, private-key patterns, likely tokens,
and translated Han text outside locale dictionaries. It is a guardrail, not a
complete secret scanner or security audit.

### Locale integrity

```bash
npm run check:i18n
```

This verifies exactly nine locale files, parses each dictionary, compares keys
against English, and checks translation references found in the Game runtime.

### Unit and browser integration tests

```bash
npm test
```

`scripts/test-play.mjs` starts an isolated static server and runs all
`play/tests/*.test.mjs` files with Node's test runner. Playwright tests launch
headless Chromium against that server. Test execution uses limited concurrency
to keep browser runs stable.

### Production-shaped build

```bash
npm run build
```

The build validates that:

- Solana-facing entries bundle successfully for modern browsers.
- Required transitive chain chunks are included.
- The small startup loaders remain dependency-free and within size budgets.
- Deferred onboarding exports the expected public function.
- Runtime URLs, locale descriptors, workers, and content hashes are stamped.
- The Chunk.js and Game source graph produces a deterministic runtime version.

## Running One Test File

The normal runner supplies `NICECHUNK_TEST_ORIGIN` automatically. For a focused
test, start a source server in one terminal:

```bash
node scripts/serve-static-site.mjs --root . --port 4174
```

Then run the test in another terminal:

```bash
NICECHUNK_TEST_ORIGIN=http://127.0.0.1:4174 \
  node --test play/tests/market-ui-browser.test.mjs
```

Use a different free port if 4174 is occupied.

## Choosing the Right Regression Test

| Change | Minimum useful coverage |
| --- | --- |
| Pure selection, stacking, physics, or coordinate rule | Node unit test |
| Solana instruction or account change | Exact keys, flags, and instruction-data assertions |
| DOM state, pending action, responsive layout | Playwright browser test |
| Chunk.js integration | Engine test upstream plus Game boundary test |
| Locale or user-visible copy | Locale integrity check and relevant UI test |
| Loader or generated runtime | Browser loader test and full build |

For a reported transaction failure, preserve the original recipe or item ID,
input account indexes, program logs, and the stage that failed. A regression
test should prove the client constructs the intended request; program-side
validation belongs in the Programs repository.

## Manual Checks

Automated tests do not replace a short real-browser pass for interaction-heavy
changes. Depending on scope, verify:

- Desktop pointer lock and third-person pointer targeting.
- Mobile landscape layout, joystick movement, and camera correction.
- Pending icons and duplicate-click prevention during wallet approval.
- Guardian disconnect and reconnect state.
- Inventory refresh after confirmed mining, smelting, forging, placement, or
  marketplace transactions.
- WebGL2 behavior on an integrated GPU and at a mobile device pixel ratio.

Use a disposable Devnet account. Redact wallet exports, RPC keys, and unrelated
account data from screenshots and logs.

## Continuous Integration

`.github/workflows/ci.yml` runs the supported Node version, installs Chromium,
executes all checks, and builds the complete Game artifact on pushes to `main`
and on pull requests. Third-party Actions are pinned to full commit SHAs for
supply-chain stability.
