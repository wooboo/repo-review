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

HTTP requests were counted at the application's fetch boundary and stayed well
below the hard ceiling of 280 requests. `gh api rate_limit` before and after the
sync showed only small decreases in the GitHub REST and GraphQL budgets, well above
the default reserve. No second live sync was run.

A metadata node from public PR #5 was retained as
`src/server/fixtures/github-graphql-recorded.json`. Only selected public GraphQL
fields were recorded, without authentication headers or private-host data.
