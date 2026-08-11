# Security Policy

NICECHUNK takes wallet, transaction, and browser-origin security seriously.
Please report vulnerabilities privately so maintainers can investigate before
technical details become public.

## Supported Versions

NICECHUNK Game is a pre-release client without tagged stable releases. Security
fixes are applied to the current `main` branch and the current public deployment.
Historical commits and copied runtime bundles are not supported.

| Version | Supported |
| --- | --- |
| Current `main` | Yes |
| Current public Devnet client | Yes |
| Historical commits or third-party deployments | No |

## Report Privately

Use GitHub's private vulnerability reporting form:

https://github.com/nicechunk/game/security/advisories/new

If that form is unavailable to your account, open a public issue containing
only a request for a private contact channel. Do not include exploit details,
secrets, affected wallet data, or a proof of concept in the public issue.

Include when possible:

- A concise description and expected security impact.
- The affected commit, deployment URL, and browser environment.
- Reproduction steps using a disposable Devnet account.
- Whether user interaction, Guardian access, RPC control, or same-origin script
  execution is required.
- Sanitized logs, transaction signatures, or program logs.
- A suggested mitigation, if known.

Never send a private key, seed phrase, local-wallet backup, session key, or RPC
credential. Maintainers do not need secret material to reproduce a report.

## Scope

Reports relevant to this repository include:

- Transaction construction that can authorize an unintended action.
- Account or canonical-ID confusion between displayed and submitted items.
- Cross-site scripting or unsafe rendering of untrusted content.
- Exposure of local game wallet or temporary session key material.
- Cross-wallet cache leakage.
- Guardian message handling that crosses into persistent authority.
- Supply-chain or build behavior that changes shipped code unexpectedly.
- Bypasses of pending-state, confirmation, or network checks with security
  impact.

Program validation vulnerabilities should also identify the affected program in
[nicechunk/nicechunk-programs](https://github.com/nicechunk/nicechunk-programs).
Generic engine vulnerabilities should identify the affected component in
[nicechunk/chunk.js](https://github.com/nicechunk/chunk.js). Reporting through
this repository is still acceptable when the boundary is unclear.

## Out of Scope

- Devnet reset, airdrop, availability, or token-value behavior.
- Public RPC rate limits and third-party provider outages.
- Issues requiring a victim to disclose their own secret voluntarily.
- Browser extensions or wallet applications without a Game vulnerability.
- Automated scanner output without a reproducible security impact.
- Denial of service based only on excessive traffic to infrastructure not
  maintained in this repository.

These examples can still be filed as normal reliability bugs when useful.

## Disclosure

Please allow maintainers time to reproduce, coordinate cross-repository fixes,
and update the public client before publishing details. NICECHUNK will credit
reporters who request attribution and whose reports result in a confirmed fix.

Read [Security Model](docs/security-model.md) for current trust assumptions and
known limitations.
