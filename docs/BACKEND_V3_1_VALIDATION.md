# Backend v3.1 validation

Verified on 2026-11-01, after the requested 18:23:52 UTC GitHub reset.

- `bunx tsc --noEmit`: pass.
- `bun test`: 100 pass, 0 fail.
- `bun run build`: pass.
- Built server: `GET /` 200, `POST /mcp` initialization 200,
  `GET /api/events` 200 with SSE connection comment. Server stopped afterwards.

One real incremental sync ran against a temporary SQLite copy of the production
inventory. GitHub was configured only in that copy using `gh auth token` and the
default 1,000-request reserve; production configuration and data were not changed.
All collected repositories with a configured forge were included. No forge PR was
created, merged, closed or commented during verification, and no action was applied
to a real repository. Git provenance reads disabled implicit lazy fetching.

The sync processed 567 PRs with 150 HTTP requests total: 79 GitHub GraphQL requests
and 71 other requests (including REST budget probes and Forgejo). The hard ceiling
was 280 requests. `gh api rate_limit` immediately before and after reported:

| Budget | Before remaining | After remaining | Observed decrease |
|---|---:|---:|---:|
| GitHub REST core | 4,993 | 4,987 | 6 |
| GitHub GraphQL | 4,997 | 4,980 | 17 |

These are observed remaining-budget deltas around the sync; HTTP counts were
instrumented at the application's fetch boundary. Both budgets stayed well above
the default reserve. No second live sync was run.

A metadata node from public PR #5 was retained as
`src/server/fixtures/github-graphql-recorded.json`. Only selected public GraphQL
fields were recorded, without authentication headers or private-host data.
