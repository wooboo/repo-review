`github-graphql-recorded.json` is the public PR #5 metadata node captured from
`github.com/wooboo/repo-review` during the read-only incremental sync on
2026-11-01 after 18:23:52 UTC. It contains only explicitly selected public fields;
authentication headers, bodies, private repositories and internal hosts are absent.
It exercises actual null review/check values and merged-head provenance.

`github-graphql.json` is a synthetic variant for deterministic head-SHA cache,
watermark, fork exclusion, and checks/review mapping tests. The existing REST
fixtures cover GitHub/Forgejo normalization separately.
