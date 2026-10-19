# Bare-hand leaf targeting — 2026-10-19

## Correction

Bare-hand collection bypasses the equipped-tool targeting solver, so its captured swing has no explicit yaw. The avatar session previously coerced `null` to zero and turned the character north regardless of the clicked leaf.

When a swing has no finite solver yaw, the avatar session now derives its heading from the captured target block center and the player's current full world position, including local offsets. The arm pitch follows the target height relative to the shoulder, within the renderer's existing −1.2 to +1.2 radian range. Directly overhead targets preserve the current heading.

An explicit equipped-tool yaw, including zero, remains authoritative for its pose. Missing angles without a valid target keep the current heading. Camera orbit controls remain independent. The existing action-duration lock keeps the character facing the leaf during the swing and releases normally afterward.

The same correction applies to loose surface stone pickup. Harvest authorization, reach, Skills policy, rewards, damage and durability remain in their existing paths. This is a client animation correction; contract code and chain state require no update.

## Verification

The browser regression uses the production MiningController, AvatarSession, MotionController, PlayerSession and actual animated avatar vertices. It checks eight compass headings with negative/fractional player coordinates, three consecutive contacts, target switching between swings, captured-target isolation, movement during a swing, higher/lower leaves, overhead targets, first-person synchronization, outgoing Guardian yaw, explicit tool yaw zero, invalid angles and rejected distant targets. Bare actions read neither tool targeting nor Skills in this fixture.

Evidence: `/workspace/bare-hand-leaf-facing-20261019/report.json` and `tests.log`.

## Verified release

- Website **0.1.78**, runtime `play-bundle-f28abdf43843271c`, replacing `play-bundle-3e23adf24b31797c`.
- All **54 published game files** matched local SHA-256, including the regular runtime pointer and `/play/` route.
- **41 related tests** passed. The new production-browser regression includes **102 assertions** across the targeting and animation scenarios above.
- Release-source repository policy, nine-language i18n and production build passed. Existing unrelated untracked documents were preserved.
- The release updates client presentation only. No contract code or on-chain account was modified, and no chain transaction was broadcast.
