# repo-review

Self-hosted, mobile-first web app for keeping many Git repositories, branches and
worktrees in order across local and SSH hosts. It scans the configured hosts, shows
what is merged, stale, unpushed or dirty, safely deletes what can be deleted, handles
pull requests, and hands work to AI coding agents. Agents can drive all of it through
an MCP server.

The full product specification is in [docs/SPEC.md](docs/SPEC.md); the UI contract
and current limitations are in [docs/API.md](docs/API.md).

## Run

Requires Bun 1.4+, Git, SSH, and `lsof` on scanned hosts. Use a native Bun build
compatible with native addons on the server.

```sh
bun install
bun run dev
bun run typecheck
bun test
bun run build
DATABASE_PATH=/var/lib/repo-review/review.db PORT=3000 bun run start
```

`dev` and `build` bundle the dependency-free host scripts. `collector:build`
regenerates them explicitly. `db:generate` creates Drizzle migrations. Migrations
run when the application service first starts, and SQLite uses WAL. Run the built
server from the project directory; deploy `.output` including server migrations.
The default database is `./data/repo-review.db`; database files are gitignored.

## Configure

Use `getSettings` / `updateSettings` from the server-function contract. Only the
local host and existing conventional development roots are seeded. All other
hosts, forge credentials and agent definitions are runtime settings.

Example SSH host:

```json
{
  "id": "remote",
  "kind": "ssh",
  "target": "dev@example.com",
  "bun": "bun",
  "enabled": true,
  "roots": ["~/Work", "~/.t3/worktrees"]
}
```

Collectors and workers run as `ssh -o BatchMode=yes <target> bun run -` with their
bundled source on stdin. Install nothing from this app on the remote host. The
collector can run directly as `bun src/collector/main.ts --host local --root ~/Work
--no-fetch --no-t3`; it emits NDJSON progress and a versioned final snapshot.
T3 state is optional for collection and database access runs in a timed subprocess.
Cleanup fails closed when activity cannot be verified.

Example forge configuration:

```json
{
  "host": "github.com",
  "kind": "github",
  "tokenEnv": "GITHUB_TOKEN",
  "tokenCommand": "gh auth token"
}
```

Use `kind: "forgejo"` and your own public forge hostname for Forgejo/Gitea. Set
one token source; token commands run only on the app host. Never put tokens in
settings or Git. Forge requests use HTTPS and bounded timeouts.

Example agents:

```json
[
  {
    "id": "claude-cli",
    "label": "Claude CLI",
    "kind": "cli",
    "command": "claude",
    "args": ["-p", "--model", "{model}", "{prompt}"],
    "models": ["claude-haiku-5-5"],
    "defaultModel": "claude-haiku-5-5"
  },
  {
    "id": "claude-acp",
    "label": "Claude ACP",
    "kind": "acp",
    "command": "bunx",
    "args": ["@agentclientprotocol/claude-agent-acp@0.99.1"],
    "models": ["claude-haiku-5-5"],
    "defaultModel": "claude-haiku-5-5"
  }
]
```

Authenticate agent CLIs on the server first. Settings also control `worktreeDir`,
`dailyScanTime` (server local HH:MM), and `staleDays`. Run worktrees remain available
after completion for inspection. Optional `TYPESAFE_API_KEY` enables Jev branch
classification. Descriptions use a tool-free Claude Haiku invocation and are
cached by content fingerprint.

## MCP

```sh
claude mcp add --transport http repo-review http://<host>:<port>/mcp
bunx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/list
bunx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp --transport http --method tools/call --tool-name list_repositories
```

Set `MCP_TOKEN` to require `Authorization: Bearer <token>`. The app itself is for a
single user on a trusted network and has no UI authentication.

Destructive operations follow plan → review → apply. Development tests use only
temporary repositories, including a temporary bare archive remote. Never test
apply against live repositories. See [docs/VALIDATION.md](docs/VALIDATION.md) for
executed gates and known gaps.

## License

[MIT](LICENSE). Use, copy, modify, publish, sell or distribute it for any purpose;
keep the copyright and license notice. Third-party dependencies keep their own
licenses.
