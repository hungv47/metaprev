# metaprev progress

Updated: 2026-08-28
Owner: Hung
State: shipped and maintained; current release 0.5.0

## Resume here

Read `VISION.md`, this file, `ROADMAP.md`, `app/AGENTS.md`, then `app/CHANGELOG.md`.

## Current state

- Private source is `app/`; `forsvn-labs/metaprev` is the one-way public mirror.
- The package is published as `@forsvn/metaprev`.
- There is no dedicated landing page and no decision to build one.
- All 62 tests and TypeScript verification passed on 2026-08-28.
- The 2026-08-28 mirror dry-run differs only in the generated instruction surface
  (`AGENTS.md` replaces `CLAUDE.md`). Nothing was pushed.

## Next action

Decide whether the instruction-surface change belongs in the next release, verify package and
mirror version parity, then collect real use feedback before selecting another feature pass.
