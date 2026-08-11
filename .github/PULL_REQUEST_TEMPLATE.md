## Summary

Describe the user-visible problem and the resulting behavior.

## Authority Boundary

- [ ] Browser presentation or input
- [ ] Guardian real-time state
- [ ] Solana transaction or PDA state
- [ ] Deterministic world reconstruction
- [ ] Chunk.js engine integration
- [ ] Documentation or repository maintenance only

## Verification

- [ ] `npm run check`
- [ ] `npm run build`
- [ ] `git diff --check`
- [ ] Manual desktop check, if interaction changed
- [ ] Manual mobile check, if responsive behavior changed

List focused tests and manual steps:

```text

```

## Cross-Repository Changes

Link any required Chunk.js, Programs, Guardian, NCM, or website commit. Write
`None` if this change is self-contained.

## Evidence

Add sanitized screenshots, recordings, transaction signatures, or program logs
when useful. Never include private keys, wallet backups, session keys, RPC
credentials, or private account data.

## Checklist

- [ ] Canonical IDs remain separate from translated labels and icons.
- [ ] Pending, confirmed, and failed transaction states remain distinct.
- [ ] New user-visible text exists in all nine locale files.
- [ ] Documentation reflects any changed setup, behavior, or security boundary.
- [ ] No generated artifacts, credentials, deployment logs, or local agent files
      are included.
- [ ] I agree that this contribution is provided under Apache-2.0.
