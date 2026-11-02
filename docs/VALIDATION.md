# Backend foundation validation

Executed with Bun 1.4.3 and TypeScript 7.0.2 on 2026-11-01.

- `bunx tsc --noEmit`: passed.
- `bun test`: 15 passed, zero failed, 53 assertions. All destructive tests use
  temporary repositories; archive testing uses a temporary bare remote.
- `bun run build`: passed. Nitro Bun preset; expected upstream `use client`
  bundling warnings remain. `bun .output/server/index.mjs` served `/` and `/mcp`.
- MCP Inspector CLI: listed all 21 tools and called `list_repositories`; valid
  empty paginated result against an isolated database.
- Local and SSH read-only scans: both completed, zero host errors.
  The SSH collector ran from stdin with the host's existing Bun installation.
  Settings were configured through the same validated application settings
  implementation used by the server function. Fetch was disabled. No live
  repository branch, worktree, index or object was modified.
- Live cleanup plan only; no apply was performed.
- CLI smoke run: Claude Haiku returned `OK`, status done, output persisted.
- ACP smoke run: adapter 0.99.1, SDK 2.2.0, Claude Haiku returned `OK`, status
  done, 18 persisted events including usage/cost and message updates. An initial
  failure using the removed `session/set_model` method was corrected to
  `session/set_config_option` and the ACP smoke run was repeated successfully.
- Server processes started for validation were stopped after the checks.

## Live inventory check

A read-only scan of a real multi-host inventory was compared with an earlier,
independent report of the same machines. Differences were fully explained by
projects and branches created between the two runs. The gate used empty forge
settings, so it exercised filesystem inventory and state-only verdicts, not an
authenticated forge refresh. Real forge mutations, Jev calibration and live
repository descriptions were not exercised.

Raw scans, agent logs, test repositories and the throwaway SQLite databases remain
outside the Git checkout; no personal inventory or credentials are committed.
See SPEC.md's implementation-status appendix for the remaining product scope.
