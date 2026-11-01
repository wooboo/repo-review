import { describe, expect, test } from "bun:test";
import { branchSearch, prListSearch, prSearch, repoListSearch, repoSearch, worktreeSearch, BRANCH_FILTER_KEYS, WORKTREE_FILTER_KEYS } from "./search";
import { divergenceWidth, formatDuration, parseCommit, parseShortstat, parseStash, readmeSummary, relativeTime, stripRemote, repoName } from "./format";
import { countVerdicts, divergingShas, groupByVerdict, needsDecision, verdictsByRepo } from "./verdicts";
import { mergeChunks } from "./agent-events";
import { parseBranchId, parsePullRequestId, pullRequestId } from "./api/ids";
import { isNotAvailableYet, lookup, NotAvailableYet } from "./api/optional";
import { allPages, paginate } from "./api/pages";
import { parseSearchWith } from "@tanstack/react-router";
import { stringifySearch } from "./url";
import { parseDiff } from "./diff";
import { coalescer } from "./queries";

describe("search params", () => {
  test("defaults for an empty URL", () => {
    expect(branchSearch.decode({})).toEqual(branchSearch.defaults);
    expect(repoListSearch.decode(undefined)).toEqual({ q: "", host: "", sort: "attention" });
    expect(prSearch.decode({})).toEqual({ tab: "conversation", wrap: true });
  });
  test("strip removes defaults, keeps the rest", () => {
    const s = branchSearch.decode({ verdict: ["delete", "check"], stale: true, page: 1, sort: "date" });
    expect(branchSearch.strip(s)).toEqual({ verdict: ["delete", "check"], stale: true });
    expect(branchSearch.strip(branchSearch.defaults)).toEqual({});
  });
  test("invalid values fall back to their defaults", () => {
    const s = branchSearch.decode({ verdict: ["nope"], page: 0, sort: "size", stale: "maybe", state: "merged" });
    expect(s.verdict).toEqual([]);
    expect(s.page).toBe(1);
    expect(s.sort).toBe("date");
    expect(s.stale).toBe(false);
    expect(s.state).toBe("merged");
    expect(prListSearch.decode({ state: "weird", page: 2.5 })).toEqual(prListSearch.defaults);
  });
  test("URL strings are coerced", () => {
    expect(branchSearch.decode({ verdict: "delete,local-only", page: "3", dirty: "true" })).toMatchObject({ verdict: ["delete", "local-only"], page: 3, dirty: true });
    expect(worktreeSearch.decode({ q: 123 }).q).toBe("123");
  });
  test("round-trip through the router's query string", () => {
    const parse = parseSearchWith(JSON.parse);
    for (const value of [
      branchSearch.decode({ verdict: ["delete"], q: "feat/x", host: "local", page: 2, sort: "name" }),
      branchSearch.decode({ verdict: ["delete", "check", "unmerged"], localOnly: true, q: "123" }),
      branchSearch.decode({ q: "true" }),
    ]) {
      const url = stringifySearch(branchSearch.strip(value));
      expect(branchSearch.decode(parse(url))).toEqual(value);
    }
    expect(stringifySearch(branchSearch.strip(branchSearch.defaults))).toBe("");
  });
  test("active filter count ignores text, sort and page", () => {
    expect(branchSearch.activeCount(branchSearch.decode({ q: "x", page: 4, sort: "name", verdict: ["delete"], stale: true }), BRANCH_FILTER_KEYS)).toBe(2);
  });
});

describe("format", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  test("relative time", () => {
    expect(relativeTime("2026-11-01T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-11-01T11:00:00Z", now)).toBe("1 hour ago");
    expect(relativeTime("2026-10-31T12:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("2026-10-29T12:00:00Z", now)).toBe("3 days ago");
    expect(relativeTime("2026-08-01T12:00:00Z", now)).toBe("3 months ago");
    expect(relativeTime("2024-11-01T12:00:00Z", now)).toBe("2 years ago");
    expect(relativeTime("", now)).toBe("");
    expect(relativeTime("not a date", now)).toBe("");
  });
  test("divergence bars are logarithmic with a visible minimum", () => {
    expect(divergenceWidth(0, 100)).toBe(0);
    expect(divergenceWidth(1, 1_000_000)).toBe(3);
    expect(divergenceWidth(1, 1000)).toBe(5);
    expect(divergenceWidth(1000, 1000)).toBe(48);
    const w10 = divergenceWidth(10, 1000), w100 = divergenceWidth(100, 1000);
    expect(w10).toBeLessThan(w100);
    expect(Math.abs(w100 - w10 - 16)).toBeLessThanOrEqual(1);
    expect(divergenceWidth(5000, 10)).toBe(48);
  });
  test("collector lines", () => {
    expect(parseCommit("abc1234 2026-10-01T10:00:00+02:00 Fix the thing now")).toEqual({ sha: "abc1234", date: "2026-10-01T10:00:00+02:00", subject: "Fix the thing now" });
    expect(parseStash("stash@{0} deadbeef 2026-10-01T10:00:00Z WIP on main: abc").ref).toBe("stash@{0}");
    expect(parseShortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)")).toEqual({ files: 3, insertions: 10, deletions: 2 });
    expect(parseShortstat(" 1 file changed, 1 deletion(-)")).toEqual({ files: 1, insertions: 0, deletions: 1 });
    expect(parseShortstat("")).toBeNull();
  });
  test("readme summary skips headings, badges and html", () => {
    const about = JSON.stringify({ readme: "# Title\n\n[![CI](x)](y)\n\n<p align=center>logo</p>\n\nA **self-hosted** app for [git](https://git-scm.com) repositories.\nSecond line.\n\nMore." });
    expect(readmeSummary(about)).toBe("A self-hosted app for git repositories. Second line.");
    expect(readmeSummary("not json")).toBe("");
    expect(readmeSummary(JSON.stringify({ readme: "x".repeat(400) }), 20)).toHaveLength(20);
  });
  test("misc", () => {
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(3_700_000)).toBe("1h 1m");
    expect(stripRemote("origin/main")).toBe("main");
    expect(repoName("github.com/o/repo")).toBe("repo");
    expect(repoName("local/thing@abc123")).toBe("thing");
  });
});

describe("verdicts", () => {
  const rows = [
    { repo: "a", verdict: "delete" as const },
    { repo: "a", verdict: "local-only" as const },
    { repo: "b", verdict: "delete" as const },
    { repo: "b", verdict: "base" as const },
  ];
  test("groups in attention order, without empty groups", () => {
    expect(groupByVerdict(rows).map((g) => [g.verdict, g.items.length])).toEqual([["local-only", 1], ["delete", 2], ["base", 1]]);
  });
  test("counts", () => {
    expect(countVerdicts(rows)).toEqual({ delete: 2, "local-only": 1, base: 1 });
    expect(needsDecision({ delete: 4, "local-only": 2, unmerged: 1, check: 1 })).toBe(4);
    expect(verdictsByRepo(rows).get("b")).toEqual({ delete: 1, base: 1 });
  });
  test("diverging SHAs", () => {
    expect([...divergingShas(["a", "a", "b"])]).toEqual(["b"]);
    expect(divergingShas(["a", "a"]).size).toBe(0);
    expect([...divergingShas(["a", "b"])].sort()).toEqual(["a", "b"]);
  });
});

describe("ids and helpers", () => {
  test("ids", () => {
    expect(parsePullRequestId("github.com/o/r!42")).toEqual({ repo: "github.com/o/r", number: 42 });
    expect(parsePullRequestId(pullRequestId("forge.example/o/r", 7))).toEqual({ repo: "forge.example/o/r", number: 7 });
    expect(parsePullRequestId("nope")).toBeNull();
    expect(parseBranchId("github.com/o/r#feat/a#b")).toEqual({ repo: "github.com/o/r", name: "feat/a#b" });
  });
  test("agent message chunks merge", () => {
    const merged = mergeChunks([
      { seq: 0, at: "", kind: "message", text: "Hel" },
      { seq: 1, at: "", kind: "message", text: "lo" },
      { seq: 2, at: "", kind: "tool", text: "x" },
    ]);
    expect(merged.map((e) => e.text)).toEqual(["Hello", "x"]);
  });
  test("paging helpers", async () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], total: 5, page: 2, pageSize: 2 });
    const rows = Array.from({ length: 450 }, (_, i) => i);
    // The server clamps to 200 per page, whatever the client asks for.
    const pages: number[] = [];
    const all = await allPages(async (page) => (pages.push(page), paginate(rows, page, 200)));
    expect(all).toHaveLength(450);
    expect(pages).toEqual([1, 2, 3]);
  });
  test("optional v3 server functions", async () => {
    const module = { listLandings: async ({ data }: { data: { repo: string } }) => data.repo, notAFunction: 1 };
    expect(lookup(module, "missing")).toBeUndefined();
    expect(lookup(module, "notAFunction")).toBeUndefined();
    expect(await lookup<{ repo: string }, string>(module, "listLandings")!({ data: { repo: "r" } })).toBe("r");
    expect(isNotAvailableYet(new NotAvailableYet("listLandings"))).toBe(true);
    const copied = Object.assign(new Error("x"), { name: "NotAvailableYet" });
    expect(isNotAvailableYet(copied)).toBe(true);
    expect(isNotAvailableYet(new Error("boom"))).toBe(false);
  });
});

describe("search params of the v3 filters", () => {
  test("branch view", () => {
    expect(branchSearch.decode({}).view).toBe("live");
    expect(branchSearch.decode({ view: "gone" }).view).toBe("gone");
    expect(branchSearch.decode({ view: "deleted" }).view).toBe("live");
    expect(branchSearch.strip(branchSearch.decode({ view: "gone", repo: "github.com/o/r" }))).toEqual({ view: "gone", repo: "github.com/o/r" });
    // The view is not a filter: it does not count towards the badge.
    expect(branchSearch.activeCount(branchSearch.decode({ view: "gone" }), BRANCH_FILTER_KEYS)).toBe(0);
  });
  test("worktree status replaces the dirty switch", () => {
    expect(worktreeSearch.decode({})).toEqual({ q: "", host: "", repo: "", status: "" });
    expect(worktreeSearch.decode({ status: "missing" }).status).toBe("missing");
    expect(worktreeSearch.decode({ status: "dirty" }).status).toBe("");
    expect(worktreeSearch.strip(worktreeSearch.decode({ status: "changes" }))).toEqual({ status: "changes" });
    expect(worktreeSearch.activeCount(worktreeSearch.decode({ status: "clean", q: "x" }), WORKTREE_FILTER_KEYS)).toBe(1);
  });
  test("repository landings tab and PR commits tab", () => {
    expect(repoSearch.decode({})).toEqual({ tab: "overview", base: "", page: 1 });
    const s = repoSearch.decode({ tab: "landings", base: "main", page: "3" });
    expect(s).toEqual({ tab: "landings", base: "main", page: 3 });
    expect(repoSearch.strip(s)).toEqual({ tab: "landings", base: "main", page: 3 });
    expect(repoSearch.decode({ tab: "nope" }).tab).toBe("overview");
    expect(prSearch.decode({ tab: "commits" }).tab).toBe("commits");
  });
  test("round-trip through the query string", () => {
    const parse = parseSearchWith(JSON.parse);
    const b = branchSearch.decode({ view: "gone", repo: "github.com/o/r", page: 2 });
    expect(branchSearch.decode(parse(stringifySearch(branchSearch.strip(b))))).toEqual(b);
    const w = worktreeSearch.decode({ status: "missing", host: "local" });
    expect(worktreeSearch.decode(parse(stringifySearch(worktreeSearch.strip(w))))).toEqual(w);
    const r = repoSearch.decode({ tab: "landings", page: 2 });
    expect(repoSearch.decode(parse(stringifySearch(repoSearch.strip(r))))).toEqual(r);
  });
});

describe("diff parser", () => {
  test("files, hunks and line numbers", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1..2 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,3 +10,4 @@ function x() {",
      " keep",
      "-old",
      "+new",
      "+added",
      " tail",
      "diff --git a/img.png b/img.png",
      "Binary files a/img.png and b/img.png differ",
      "",
    ].join("\n");
    const files = parseDiff(diff);
    expect(files.map((f) => [f.path, f.additions, f.deletions, f.binary])).toEqual([["src/a.ts", 2, 1, false], ["img.png", 0, 0, true]]);
    const lines = files[0].lines;
    expect(lines[0].kind).toBe("hunk");
    expect(lines[1]).toEqual({ kind: "ctx", text: "keep", old: 10, new: 10 });
    expect(lines[2]).toEqual({ kind: "del", text: "old", old: 11, new: null });
    expect(lines[3]).toEqual({ kind: "add", text: "new", old: null, new: 11 });
    expect(lines.at(-1)).toEqual({ kind: "ctx", text: "tail", old: 12, new: 13 });
  });
});

describe("live events", () => {
  test("bursts are coalesced into one flush of distinct keys", () => {
    const flushed: string[][][] = [];
    const timers: (() => void)[] = [];
    const push = coalescer((keys) => flushed.push(keys), 1000, (f) => timers.push(f));
    for (let i = 0; i < 500; i++) push({ type: "inventory", id: `github.com/o/r!${i}` });
    push({ type: "job", id: "j1" });
    expect(timers).toHaveLength(1);
    expect(flushed).toHaveLength(0);
    timers[0]();
    expect(flushed).toEqual([[["inv"], ["prs"], ["pr"], ["job", "j1"]]]);
    push({ type: "scan", id: "s" });
    expect(timers).toHaveLength(2);
    timers[1]();
    expect(flushed[1]).toEqual([["scans"], ["inv", "dashboard"]]);
  });
});
