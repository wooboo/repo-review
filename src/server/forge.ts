import { shellCommand } from "../collector/platform";
import { ForgeUnavailable, ForgeRejected, NotFound } from "./pull-requests";
const tokenCache = new Map<string, { until: number; value: Promise<string> }>();
async function commandToken(host: string, command: string) {
  const key = host + "\0" + command,
    cached = tokenCache.get(key);
  if (cached && cached.until > Date.now()) return cached.value;
  const value = (async () => {
    const p = Bun.spawn(shellCommand(command), {
      windowsVerbatimArguments: true,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timer = setTimeout(() => p.kill(), 15000);
    try {
      const [out, , code] = await Promise.all([
        new Response(p.stdout).text(),
        new Response(p.stderr).text(),
        p.exited,
      ]);
      if (code !== 0)
        throw new ForgeUnavailable({ message: "Token command failed" });
      return out.trim();
    } finally {
      clearTimeout(timer);
    }
  })();
  tokenCache.set(key, { until: Date.now() + 600000, value });
  try {
    return await value;
  } catch (e) {
    tokenCache.delete(key);
    throw e;
  }
}
import type { Forge, Clone } from "../domain/model";
import { normalizeUrl } from "../domain/logic";
import { BudgetGuard, ForgeRateLimited } from "./forge-budget";
export class ForgeService {
  private queue: Promise<unknown> = Promise.resolve();
  syncRequests = 0;
  syncActive = false;
  forgetRepository(repo: string) {
    const host = repo.split("/")[0],
      path = "/repos/" + repo.slice(host.length + 1);
    for (const key of this.etags.keys())
      if (key.startsWith(host + path + "/") || key === host + path)
        this.etags.delete(key);
  }
  private readonly etags = new Map<string, { etag: string; value: unknown }>();
  constructor(
    private readonly config: readonly Forge[],
    readonly budget = new BudgetGuard(),
  ) {}
  request(
    host: string,
    path: string,
    method = "GET",
    body?: unknown,
    raw = false,
  ): Promise<unknown> {
    const next = this.queue
      .catch(() => {})
      .then(() => this.requestImpl(host, path, method, body, raw));
    this.queue = next;
    return next;
  }
  private async requestImpl(
    host: string,
    path: string,
    method = "GET",
    body?: unknown,
    raw = false,
  ): Promise<unknown> {
    const f = this.config.find((f) => f.host === host);
    if (!f) throw new ForgeUnavailable({ message: "Forge not configured" });
    if (this.syncActive && ++this.syncRequests > 280) {
      const retryAt = new Date(Date.now() + 3600000).toISOString();
      throw new ForgeRateLimited({
        host,
        retryAt,
        message: `Forge sync paused at 280-request safety budget until ${retryAt}`,
      });
    }
    const resource = path === "/graphql" ? "graphql" : "core";
    const reserve = Math.max(
      0,
      f.requestReserve ?? (f.kind === "github" ? 1000 : 0),
    );
    this.budget.check(host, resource, resource === "graphql" ? 10 : 1, reserve);
    const cacheKey = host + path;
    const cached =
      method === "GET" && !raw ? this.etags.get(cacheKey) : undefined;
    let token = f.tokenEnv ? process.env[f.tokenEnv] : undefined;
    if (f.tokenCommand) {
      token = await commandToken(f.host, f.tokenCommand);
    }
    const base =
      f.kind === "github"
        ? "https://api.github.com"
        : `https://${f.host}/api/v1`;
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(cached ? { "If-None-Match": cached.etag } : {}),
        Accept: raw ? "application/vnd.github.diff" : "application/json",
        ...(token
          ? {
              Authorization: `${f.kind === "github" ? "Bearer" : "token"} ${token}`,
            }
          : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    }).catch((e: unknown) => {
      throw new ForgeUnavailable({
        message: e instanceof Error ? e.message : "Forge request failed",
      });
    });
    this.budget.observe(host, resource, response, reserve);
    if (response.status === 304 && cached) return cached.value;
    if (!response.ok) {
      const payload = (await response
        .json()
        .catch(() => ({ message: `Forge HTTP ${response.status}` }))) as {
        message?: string;
      };
      const message = payload.message ?? `Forge HTTP ${response.status}`;
      if (
        response.status === 403 &&
        /secondary|rate limit|abuse/i.test(message)
      ) {
        const retryAt = new Date(Date.now() + 60000).toISOString();
        this.budget.update(host, resource, 0, retryAt, reserve, retryAt);
        throw new ForgeRateLimited({
          host,
          retryAt,
          message: `Forge sync paused for rate limit until ${retryAt}`,
        });
      }
      if (response.status === 404) throw new NotFound({ message });
      if (response.status >= 500) throw new ForgeUnavailable({ message });
      throw new ForgeRejected({ message });
    }
    const value = raw
      ? await response.text()
      : response.status === 204
        ? null
        : await response.json();
    const etag = response.headers.get("etag");
    if (method === "GET" && !raw && etag)
      this.etags.set(cacheKey, { etag, value });
    return value;
  }
  async prepare(host: string) {
    if (this.config.find((f) => f.host === host)?.kind !== "github") return;
    const limits = (await this.request(host, "/rate_limit")) as {
      resources: Record<string, { remaining: number; reset: number }>;
    };
    for (const resource of ["core", "graphql"]) {
      const b = limits.resources[resource];
      if (b)
        this.budget.update(
          host,
          resource,
          b.remaining,
          new Date(b.reset * 1000).toISOString(),
          this.config.find((f) => f.host === host)?.requestReserve ?? 1000,
        );
      this.budget.check(host, resource, resource === "graphql" ? 10 : 1);
    }
  }
  async graphql(host: string, query: string) {
    const r = (await this.request(host, "/graphql", "POST", { query })) as {
      data?: Record<string, unknown>;
      errors?: { message: string; type?: string }[];
    };
    if (r.errors?.length) {
      if (
        r.errors.some(
          (e) => e.type === "RATE_LIMITED" || /rate limit/i.test(e.message),
        )
      ) {
        const retryAt = new Date(
          Math.max(
            Date.now() + 60000,
            Date.parse(
              this.budget.budgets.get(host + ":graphql")?.resetAt ?? "",
            ) || 0,
          ),
        ).toISOString();
        this.budget.update(
          host,
          "graphql",
          0,
          retryAt,
          this.config.find((f) => f.host === host)?.requestReserve ?? 1000,
          retryAt,
        );
        throw new ForgeRateLimited({
          host,
          retryAt,
          message: `Forge sync paused for rate limit until ${retryAt}`,
        });
      }
      throw new ForgeRejected({
        message: r.errors.map((e) => e.message).join("; "),
      });
    }
    if (!r.data) throw new ForgeRejected({ message: "Missing GraphQL data" });
    return r.data;
  }

  async listPullRequests(key: string, since?: string) {
    const [host, ...parts] = key.split("/");
    const repo = parts.join("/");
    const rows: unknown[] = [];
    if (this.config.find((f) => f.host === host)?.kind === "github") {
      let cursor: string | null = null;
      do {
        const data = await this.graphql(
          host,
          `query { repository(owner:${JSON.stringify(parts[0])}, name:${JSON.stringify(parts[1])}) { pullRequests(first:100, orderBy:{field:UPDATED_AT,direction:DESC}, after:${JSON.stringify(cursor)}) { nodes { number title url state isDraft headRefName headRefOid headRepository { nameWithOwner } baseRefName createdAt updatedAt mergedAt mergeCommit { oid } author { login } mergeable reviewDecision commits(last:1) { nodes { commit { statusCheckRollup { state } } } } } pageInfo { hasNextPage endCursor } } } }`,
        );
        const connection = (
          data.repository as {
            pullRequests: {
              nodes: GithubPull[];
              pageInfo: { hasNextPage: boolean; endCursor: string };
            };
          }
        ).pullRequests;
        rows.push(
          ...connection.nodes
            .filter((p) => !since || p.updatedAt >= since)
            .map(mapGithubPull),
        );
        if (
          connection.nodes.some((p) => since && p.updatedAt < since) ||
          !connection.pageInfo.hasNextPage
        )
          break;
        cursor = connection.pageInfo.endCursor;
      } while (cursor);
      return rows;
    }
    const sort =
      this.config.find((f) => f.host === host)?.kind === "forgejo"
        ? "recentupdate"
        : "updated";
    for (let page = 1; ; page++) {
      const r = (await this.request(
        host,
        `/repos/${repo}/pulls?state=all&sort=${sort}&direction=desc&per_page=100&limit=100&page=${page}`,
      )) as unknown[];
      rows.push(
        ...r.filter(
          (p) =>
            !since || String((p as { updated_at: string }).updated_at) >= since,
        ),
      );
      if (
        since &&
        r.some((p) => String((p as { updated_at: string }).updated_at) < since)
      )
        break;
      if (r.length < 100) break;
    }
    return rows;
  }
  async detail(key: string, number: number) {
    const [host, ...parts] = key.split("/");
    const path = `/repos/${parts.join("/")}/pulls/${number}`;
    const pull = (await this.request(host, path)) as Record<string, unknown>;
    return {
      pull,
      diff: await this.request(host, path, "GET", undefined, true),
      files: await this.request(host, path + "/files"),
      reviews: await this.request(host, path + "/reviews"),
    };
  }
  async operation(
    key: string,
    operation: string,
    input: Record<string, unknown>,
  ) {
    const [host, ...parts] = key.split("/");
    const root = `/repos/${parts.join("/")}`;
    const n = Number(input.number);
    switch (operation) {
      case "create":
        return this.request(host, root + "/pulls", "POST", input);
      case "merge":
        return this.request(
          host,
          root + `/pulls/${n}/merge`,
          this.config.find((f) => f.host === host)?.kind === "github"
            ? "PUT"
            : "POST",
          input,
        );
      case "close":
        return this.request(host, root + `/pulls/${n}`, "PATCH", {
          state: "closed",
        });
      case "comment":
        return this.request(host, root + `/issues/${n}/comments`, "POST", {
          body: input.body,
        });
      case "metadata":
        return this.request(host, root);
      case "search":
        return this.request(
          host,
          `/repos/search?q=${encodeURIComponent(String(input.text ?? ""))}`,
        );
      case "create-repository":
        return this.request(host, "/user/repos", "POST", {
          name: parts.at(-1),
          private: true,
        });
      default:
        throw Error("Unsupported forge operation");
    }
  }
  async resolveIdentity(
    clone: Clone,
  ): Promise<{ key: string; unrelated: string[] }> {
    const origin = clone.remotes.find(
      (r) =>
        r.name === "origin" &&
        this.config.some((f) => r.key.startsWith(f.host + "/")),
    );
    if (origin) return { key: origin.key, unrelated: [] };
    for (const forge of this.config) {
      const remote = clone.remotes.find((r) =>
        r.key.startsWith(forge.host + "/"),
      );
      if (remote) return { key: remote.key, unrelated: [] };
      if (forge.kind !== "forgejo") continue;
      try {
        const response = (await this.request(
          forge.host,
          `/repos/search?q=${encodeURIComponent(clone.name)}&limit=50`,
        )) as { data: { full_name: string; original_url?: string }[] };
        const unrelated: string[] = [];
        for (const candidate of response.data) {
          const key = forge.host + "/" + candidate.full_name.toLowerCase();
          if (
            candidate.original_url &&
            normalizeUrl(candidate.original_url) === clone.key
          )
            return { key, unrelated };
          let contains = false;
          for (const root of clone.roots) {
            try {
              await this.request(
                forge.host,
                `/repos/${candidate.full_name}/git/commits/${root}`,
              );
              contains = true;
              break;
            } catch {
              /* no commit */
            }
          }
          if (contains) return { key, unrelated };
          unrelated.push(key);
        }
        return { key: clone.key, unrelated };
      } catch {
        /* unavailable forge does not prevent ingest */
      }
    }
    return { key: clone.key, unrelated: [] };
  }
}

export type GithubPull = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  headRefOid: string;
  headRepository: { nameWithOwner: string } | null;
  baseRefName: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
  author: { login: string } | null;
  mergeable: string;
  reviewDecision?: string | null;
  commits?: {
    nodes: { commit: { statusCheckRollup: { state: string } | null } }[];
  };
};
export function mapGithubPull(p: GithubPull) {
  return {
    number: p.number,
    title: p.title,
    html_url: p.url,
    state: p.state === "OPEN" ? "open" : "closed",
    draft: p.isDraft,
    head: {
      ref: p.headRefName,
      sha: p.headRefOid,
      repo: { full_name: p.headRepository?.nameWithOwner },
    },
    base: { ref: p.baseRefName },
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    merged_at: p.mergedAt,
    merge_commit_sha: p.mergeCommit?.oid ?? null,
    user: p.author,
    mergeable: p.mergeable === "UNKNOWN" ? null : p.mergeable === "MERGEABLE",
    reviewDecision: p.reviewDecision,
    checkState:
      p.commits?.nodes[0]?.commit.statusCheckRollup?.state?.toLowerCase() ??
      "none",
  };
}
