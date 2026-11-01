# Backend foundation validation

Executed with Bun 1.4.3 and TypeScript 7.0.2 on 2026-11-01.

- `bunx tsc --noEmit`: passed.
- `bun test`: 15 passed, zero failed, 53 assertions. All destructive tests use
  temporary repositories; archive testing uses a temporary bare remote.
- `bun run build`: passed. Nitro Bun preset; expected upstream `use client`
  bundling warnings remain. `bun .output/server/index.mjs` served `/` and `/mcp`.
- MCP Inspector CLI: listed all 21 tools and called `list_repositories`; valid
  empty paginated result against an isolated database.
- Local and SSH read-only scans: both completed, zero host errors, 45 clones.
  The SSH collector ran from stdin with the host's existing Bun installation.
  Settings were configured through the same validated application settings
  implementation used by the server function. Fetch was disabled. No live
  repository branch, worktree, index or object was modified.
- Live cleanup plan only: 7 planned, 1 skipped; no apply was performed.
- CLI smoke run: Claude Haiku returned `OK`, status done, output persisted.
- ACP smoke run: adapter 0.99.1, SDK 2.2.0, Claude Haiku returned `OK`, status
  done, 18 persisted events including usage/cost and message updates. An initial
  failure using the removed `session/set_model` method was corrected to
  `session/set_config_option` and the ACP smoke run was repeated successfully.
- Server processes started for validation were stopped after the checks.

## Comparison with the preceding Python snapshot

The reference snapshot was roughly three hours older than this scan.
Its inventory had 38 repositories, 44 clones and 149 grouped branch names.
This implementation found 39 repositories, 45 clones and 155 grouped branch names.
The difference is fully accounted for by one newly initialized project containing
2 branches and 4 newly created branches in an existing project. Existing clone
counts match after accounting for that new project. Two remote-less repository
keys use full root SHAs here instead of the reference report's abbreviated SHAs;
these are the same repositories, not additional discoveries.

The local host contributed 11 clones / 30 local branch records. The SSH host
contributed 34 clones / 133 local branch records. Grouping identical branch names
across clones gives 155 branch rows.

Reference verdicts: base 40, unmerged 24, check 24, local-only 45, pr-open 11,
pr-merged-changed 1, delete 4.
New scan: base 41, unmerged 36, check 25, local-only 45, delete 8.

This gate intentionally used empty forge settings, so it exercised filesystem
inventory and state-only verdicts, not an authenticated forge refresh. Consequently
PR badges and PR-aware verdicts differ; the four newly added feature branches and
two branches of the new project also change totals. A further comparison with
configured forge auth is needed before claiming full Python-report verdict parity.
The root-commit identity rules are covered by stubbed-forge tests. Real forge
mutations, Jev calibration and live repository descriptions were not exercised.

Raw scans, agent logs, test repositories and the throwaway SQLite databases remain
outside the Git checkout; no personal inventory or credentials are committed.
See SPEC.md's implementation-status appendix for the remaining product scope.
