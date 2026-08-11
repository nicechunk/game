# Troubleshooting

This guide covers common failures in the public Devnet client and local Game
development. Do not repeatedly approve or resubmit a transaction until the
failure stage is understood.

## The Loader Does Not Reach the 3D World

1. Read the stage and error shown by the loader instead of assuming the player
   account is missing.
2. Confirm the browser supports WebGL2 and hardware acceleration is enabled.
3. Check the Network panel for failed JavaScript, WASM, NCM, locale, or rule
   requests.
4. Check RPC health. Public Devnet endpoints can return `429`, `503`, or `504`.
5. Open the in-game RPC settings and select a healthy HTTPS Devnet endpoint.
6. Reload after changing RPC configuration.

The client should not route to character creation solely because an RPC read
failed. Include the original loading error in a bug report.

## Wallet Connects on the Wrong Network

The public client currently requires Solana Devnet. Switch the wallet to Devnet
when the provider supports network selection. Some mobile wallets only expose
their provider inside the wallet's built-in browser.

Do not import a mainnet key into the local game wallet as a workaround.

## RPC Errors or Rate Limits

The default public endpoint is suitable for basic access but can be rate-limited.
The RPC settings support:

- Public Devnet RPC.
- A Helius Devnet API key.
- A custom HTTPS Devnet RPC URL.

Helius keys and custom URLs are stored in browser local storage. Do not post
them in issues. Verify the endpoint is Devnet and rotate exposed credentials.

## Transaction Simulation Failed

Capture:

- The action, recipe ID, item ID, or target block.
- Input and fuel indexes when shown.
- Program ID and custom error code.
- Complete Solana program logs.
- Client runtime version.

A custom program error means the program rejected the submitted instruction; a
larger compute budget alone does not fix validation. Avoid rapid retries because
they can obscure the original state and trigger duplicate wallet approvals.

## A Transaction Is Pending

Wait for the pending indicator to resolve. The action button should remain
disabled while one submission is in flight. If it remains pending after the
blockhash window:

1. Check RPC availability.
2. Look up the transaction signature on the Devnet explorer.
3. Reload chain state before retrying.
4. Report a bug if the UI did not clear a confirmed or expired submission.

## Guardian Is Disconnected

A Guardian disconnect affects nearby presence, movement, and chat. It does not
by itself delete confirmed Solana state. The minimap status should identify the
lost connection. Check network filtering, WebSocket availability, and the
configured Guardian region before reporting missing multiplayer peers.

## Local Game Wallet Cannot Be Recovered

The local game wallet is browser-held. Clearing site data, losing the browser
profile, or using another device removes access unless the wallet was backed up.
NICECHUNK cannot reconstruct a private key from a public address. Never send a
backup to a maintainer.

## Local Preview Returns 404

Do not serve the source tree as the production build. Run:

```bash
npm run build
npm run preview
```

Then open `http://127.0.0.1:4173/play/`. The preview command combines public
assets, chain bundles, and the content-addressed runtime under one origin.
Use `PORT=4175 npm run preview` when another process already owns port 4173.

## Black Canvas or Poor Mobile Rendering

- Confirm WebGL2 is available at `chrome://gpu` or the browser equivalent.
- Close GPU-heavy tabs and disable forced software rendering.
- Test the current browser version without aggressive battery-saving mode.
- Include device model, browser version, viewport, and device pixel ratio in a
  report.

## Reporting the Remaining Problem

Use the [bug report form](https://github.com/nicechunk/game/issues/new/choose)
with sanitized logs and exact reproduction steps. Follow [SECURITY.md](../SECURITY.md)
instead for any issue that could expose secrets or authorize unintended state.
