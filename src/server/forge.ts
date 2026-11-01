import { spawnSync } from "node:child_process";
import type { Forge, Clone } from "../domain/model";
import { normalizeUrl } from "../domain/logic";
export class ForgeService {
  constructor(private readonly config: readonly Forge[]) {}
  async request(
    host: string,
    path: string,
    method = "GET",
    body?: unknown,
    raw = false,
  ): Promise<unknown> {
    const f = this.config.find((f) => f.host === host);
    if (!f) throw Error("Forge not configured");
    let token = f.tokenEnv ? process.env[f.tokenEnv] : undefined;
    if (f.tokenCommand) {
      const r = spawnSync("sh", ["-c", f.tokenCommand], {
        encoding: "utf8",
        timeout: 15000,
      });
      if (r.status !== 0) throw Error("Token command failed");
      token = r.stdout.trim();
    }
    const base =
      f.kind === "github"
        ? "https://api.github.com"
        : `https://${f.host}/api/v1`;
    const response = await fetch(base + path, {
      method,
      headers: {
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
    });
    if (!response.ok) throw Error(`Forge HTTP ${response.status}`);
    return raw
      ? response.text()
      : response.status === 204
        ? null
        : response.json();
  }
  async listPullRequests(key: string) {
    const [host, ...parts] = key.split("/");
    const repo = parts.join("/");
    const rows: unknown[] = [];
    for (let page = 1; page <= 100; page++) {
      const r = (await this.request(
        host,
        `/repos/${repo}/pulls?state=all&per_page=100&limit=100&page=${page}`,
      )) as unknown[];
      rows.push(...r);
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
