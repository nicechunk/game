# Security Model

NICECHUNK Game is an experimental Devnet client. This document describes its
current trust boundaries and safe operating assumptions. It is not a claim that
the client or associated Solana programs have completed an independent audit.

## Assets to Protect

- Injected-wallet approvals and transaction intent.
- Local game wallet secret material and its backup.
- Temporary session signing keys and expiry state.
- Helius API keys and custom RPC endpoints.
- Player identity, inventory, skills, land-contract balances, buildings, and
  market records.
- Canonical item, recipe, block, and program identifiers.
- Integrity of public rules and runtime configuration.

## Trust Boundaries

### Browser origin

The client executes on one web origin. Any script that gains same-origin
execution can read page state and browser storage available to the game.
Content Security Policy, dependency review, input validation, and a small
startup surface reduce risk, but local storage is not a secure enclave.

### Wallet providers

An injected wallet holds its own secret and asks the user to approve requests.
The Game client constructs the request but cannot guarantee how a third-party
wallet displays or handles it. Users must inspect approvals and use Devnet.

The optional NICECHUNK local game wallet is different: its secret material is
stored in browser `localStorage` so the game can sign supported actions. It must
be treated as a disposable Devnet hot wallet. It is vulnerable to same-origin
script compromise, malicious extensions, local profile access, and data loss
when browser storage is cleared.

### RPC providers

RPC responses are untrusted network input. The client validates expected
account shape, ownership, identifiers, and transaction outcomes where the
integration provides that information. A public endpoint can rate-limit or
fail; a custom endpoint can be unavailable or dishonest.

Optional Helius keys and custom RPC URLs are stored in `localStorage`. The key
is a client credential and cannot be hidden from someone who controls the page.
Use a restricted, low-value key and rotate it after accidental disclosure.

### Guardian

Guardian is a low-latency multiplayer transport. It can report nearby movement,
chat, appearance, and regional data, but it cannot make a Solana transaction
final. The client must expire stale peers, expose connection loss, and reject
messages that do not match the expected schema or region context.

### Solana programs

Programs are the authority for persistent transitions they validate. The
browser does not become authoritative by constructing an instruction. A
successful simulation is not confirmation, and a transaction signature is not
proof that the expected account state was committed.

## Security Properties

- Production builds use explicit program IDs and public rule-table addresses.
- Network checks require the configured Solana cluster before supported flows.
- Chain-facing actions distinguish pending, confirmed, and failed states.
- Transaction builders use canonical IDs rather than translated labels.
- Treasury contract purchases pin the NCK mint and treasury owner, while land
  reservation CPIs pin the canonical Core configuration and Building authority
  PDA.
- Multi-transaction land registration reserves contracts before indexing,
  consumes them only with final activation, and supports reverse-order rollback
  with full reservation restoration.
- Building, SDK, and client validation cap one parcel at `4,096` contracts to
  bound terrain validation and chunk-index transaction work.
- Repository policy rejects common credential paths and secret signatures.
- Runtime loaders are size-limited and dependency-minimized.
- Wallet- and schema-sensitive caches are scoped or invalidated.
- Browser-facing URL input accepts HTTPS RPC endpoints without embedded
  usernames or passwords.

These properties are defense in depth. They do not make imported keys safe on a
compromised origin.

## Known Limitations

- The public deployment uses Devnet and can be reset.
- Local game wallet secrets are browser-held and unencrypted at rest.
- Client-side RPC API keys cannot be made secret from same-origin JavaScript.
- Guardian availability affects real-time presence even when Solana is healthy.
- Third-party wallets, RPC providers, browsers, and extensions remain outside
  this repository's control.
- Program and client upgrades can require cache invalidation or account
  migration during pre-release development.

### Solana v1 dependency advisories

The current Solana v1 client packages bring transitive `jayson`, `uuid`,
`@solana/buffer-layout-utils`, and `bigint-buffer` advisories into npm's audit
report. The latest compatible `@solana/web3.js` v1 and `@solana/spl-token`
packages do not currently remove all of them. npm may suggest downgrading to
historical package versions; that is not a valid security upgrade for this
client and would break supported APIs.

The lockfile, pinned CI actions, automated dependency updates, browser-only
bundle surface, and regression suite reduce uncontrolled change, but they do
not erase an upstream advisory. Maintainers must reassess patched upstream
releases or a planned Solana client migration rather than suppressing the
findings or forcing incompatible transitive versions.

## Safe Development Rules

- Use disposable Devnet wallets and request only the permissions required.
- Never paste a wallet secret into an issue, test fixture, screenshot, or chat.
- Never commit `.env`, keypair JSON, SSH keys, RPC keys, deployment logs, or
  browser profile data.
- Use synthetic public keys and redacted transaction data in tests.
- Treat all on-chain strings, Guardian messages, URL parameters, local storage,
  and RPC responses as untrusted input.
- Avoid HTML injection sinks; prefer text nodes and validated structured data.
- Pin CI Actions and review dependency lockfile changes.
- Keep generic renderer fixes in Chunk.js and authoritative validation in
  Programs so each boundary receives its own review and tests.

## Reporting a Vulnerability

Do not open a public issue containing exploit details, secrets, or affected
wallet data. Follow the private reporting process in [SECURITY.md](../SECURITY.md).
