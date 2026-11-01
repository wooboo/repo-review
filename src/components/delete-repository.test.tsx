import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { CloneDeletionSummary, PlannedAction, RepositoryDeletionPlan } from "@/lib/api/types";
import { m } from "@/messages";
import { Review } from "./delete-repository";

const action = (id: string, status: PlannedAction["status"], reason = ""): PlannedAction => ({
  id, kind: "delete-clone", target: { host: "box", repo: "/src/demo-" + id }, branchId: null, repoKey: "forge.example/acme/demo",
  status, reason, restore: null, createdAt: "2026-01-01T00:00:00Z", finishedAt: null,
});
const clone = (actionId: string, extra: Partial<CloneDeletionSummary> = {}): CloneDeletionSummary => ({
  actionId, host: "box", path: "/src/demo-" + actionId, sizeBytes: 2_500_000, linkedWorktrees: [], branches: 4, unpushedBranches: [], dirtyFiles: 0, stashes: 0,
  ignoredKept: { files: 2, bytes: 100 }, ignoredSkipped: { files: 0, bytes: 0 }, activeThreads: [], blockers: [], ...extra,
});
// Compared as text: apostrophes come out as HTML entities.
const render = (plan: RepositoryDeletionPlan) => renderToStaticMarkup(<Review plan={plan} />).replaceAll("&#x27;", "'");

describe("deletion review", () => {
  test("full purge: says repository data goes, highlights unpushed branches and lost ignored files", () => {
    const html = render({
      actions: [action("a", "planned")],
      summary: {
        repositoryId: "forge.example/acme/demo", name: "demo", remainingClones: 0, purgesRepository: true, archiveDir: "~/archives",
        clones: [clone("a", {
          unpushedBranches: [{ name: "feature/wip", ahead: 3, integrated: false }],
          ignoredSkipped: { files: 12, bytes: 40_000_000 },
          linkedWorktrees: [{ path: "/src/demo-a-wt", branch: "feature/wip", dirty: true, missing: false }],
        })],
      },
    });
    expect(html).toContain(m.deletion.scopePurge.slice(0, 40));
    expect(html).toContain("~/archives");
    expect(html).toContain("feature/wip");
    expect(html).toContain(m.deletion.ahead(3));
    expect(html).toContain(m.deletion.unpushedHint);
    expect(html).toContain(m.deletion.files(12, "40 MB"));
    expect(html).toContain(m.deletion.ignoredSkippedHint);
    expect(html).toContain("/src/demo-a-wt");
    expect(html).toContain("2.5 MB");
  });
  test("blocked clone: shows the reason and keeps the repository", () => {
    const html = render({
      actions: [action("a", "planned"), action("b", "blocked", "Process cwd inside checkout")],
      summary: {
        repositoryId: "forge.example/acme/demo", name: "demo", remainingClones: 0, purgesRepository: true, archiveDir: "~/archives",
        clones: [clone("a"), clone("b", { blockers: ["Process cwd inside checkout"] })],
      },
    });
    expect(html).toContain(m.deletion.scopeBlocked(1));
    expect(html).not.toContain(m.deletion.scopePurge.slice(0, 40));
    expect(html).toContain("Process cwd inside checkout");
    expect(html).toContain(m.deletion.blockedClone);
  });
  test("partial deletion keeps repository data", () => {
    const html = render({
      actions: [action("a", "planned")],
      summary: { repositoryId: "r", name: "demo", remainingClones: 2, purgesRepository: false, archiveDir: "~/archives", clones: [clone("a")] },
    });
    expect(html).toContain(m.deletion.scopePartial(2));
  });
});
