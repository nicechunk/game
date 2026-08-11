# Support

NICECHUNK Game is an experimental open-source Devnet client. Community support
is provided through GitHub issues; there is no guaranteed response time or
mainnet asset recovery service.

## Start Here

- [Play the public Devnet client](https://nicechunk.com/play)
- [Read the product documentation](https://nicechunk.com/docs/)
- [Set up the repository](docs/development.md)
- [Troubleshoot common failures](docs/troubleshooting.md)
- [Review the security model](docs/security-model.md)

## Ask for Help

Use the [issue chooser](https://github.com/nicechunk/game/issues/new/choose) for
a reproducible bug or feature request. Search existing issues first.

A useful support report contains:

- Client runtime version from the loading screen or `public/mainnet.json`.
- Browser, operating system, device type, and WebGL2 availability.
- Wallet mode: injected wallet or NICECHUNK local game wallet.
- RPC mode: public, Helius, or custom. Do not include the key or authenticated
  URL.
- Guardian connection state and chunk coordinates when relevant.
- Exact steps, expected behavior, and actual behavior.
- Sanitized console and Solana program logs.
- A Devnet transaction signature when it is safe to share.

## Never Post

- Private keys, seed phrases, recovery files, or local-wallet backups.
- Session key material or browser local storage exports.
- Helius keys, authenticated RPC URLs, SSH keys, or deployment credentials.
- Screenshots that expose unrelated wallet or private account information.

If a report has security impact, do not open a normal issue. Use the private
process in [SECURITY.md](SECURITY.md).

## Repository Routing

- Game UI and Solana client integration: this repository.
- Rendering and general engine behavior:
  [nicechunk/chunk.js](https://github.com/nicechunk/chunk.js).
- Program-side instruction validation:
  [nicechunk/nicechunk-programs](https://github.com/nicechunk/nicechunk-programs).
- Guardian service behavior:
  [nicechunk/nicechunk-guardian](https://github.com/nicechunk/nicechunk-guardian).

If you are unsure, open the issue here and describe the observed boundary. A
maintainer can route it without asking you to guess the implementation.
