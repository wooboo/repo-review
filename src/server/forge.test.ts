import { test, expect } from "bun:test";
import { ForgeService } from "./forge";
import type { Clone } from "../domain/model";
const clone: Clone = {
  path: "/tmp/project",
  commonDir: "/tmp/project/.git",
  name: "project",
  key: "old.example.com/team/project",
  roots: ["root-sha"],
  remotes: [],
  bases: [],
  branches: [],
  remoteBranches: [],
  worktrees: [],
  stashes: [],
  threads: [],
  about: "",
  errors: [],
};
test("identity requires matching root commit, never just the same name", async () => {
  const forge = new ForgeService([{ host: "example.com", kind: "forgejo" }]);
  forge.request = async (_host, path) => {
    if (path.startsWith("/repos/search"))
      return { data: [{ full_name: "team/project" }] };
    throw Error("404");
  };
  expect(await forge.resolveIdentity(clone)).toEqual({
    key: clone.key,
    unrelated: ["example.com/team/project"],
  });
  forge.request = async (_host, path) =>
    path.startsWith("/repos/search")
      ? { data: [{ full_name: "team/project" }] }
      : { sha: "root-sha" };
  expect((await forge.resolveIdentity(clone)).key).toBe(
    "example.com/team/project",
  );
});
test("migrated origin and matching remote resolve without name inference", async () => {
  const forge = new ForgeService([{ host: "example.com", kind: "forgejo" }]);
  forge.request = async () => ({
    data: [
      {
        full_name: "team/project",
        original_url: "https://old.example.com/team/project.git",
      },
    ],
  });
  expect((await forge.resolveIdentity(clone)).key).toBe(
    "example.com/team/project",
  );
});
