import { test, expect } from "bun:test";
import { normalizeUrl, safeUrl, verdict } from "./logic";
import { searchParams, stripDefaults } from "./model";
const merged = {
  state: "merged" as const,
  sha: "a",
  dirty: false,
  active: false,
  unpushed: 0,
};
test("normalize HTTPS SSH SCP and strip credentials", () => {
  for (const url of [
    "https://user:secret@example.com/Owner/Repo.git",
    "ssh://git@example.com/Owner/Repo.git",
    "git@example.com:Owner/Repo.git",
  ])
    expect(normalizeUrl(url)).toBe("example.com/owner/repo");
  expect(safeUrl("https://user:secret@example.com/r.git?token=secret")).toBe(
    "https://example.com/r.git",
  );
  expect(safeUrl("git@example.com:r.git")).toBe("example.com:r.git");
});
test("verdict combines every clone", () => {
  expect(verdict([merged])).toBe("delete");
  expect(verdict([merged, { ...merged, dirty: true }])).toBe("check");
  expect(verdict([merged, { ...merged, state: "unmerged", unpushed: 2 }])).toBe(
    "local-only",
  );
  expect(
    verdict([{ ...merged, state: "unmerged" }], {
      state: "merged",
      headSha: "a",
    }),
  ).toBe("delete");
  expect(
    verdict([{ ...merged, state: "unmerged", sha: "b" }], {
      state: "merged",
      headSha: "a",
    }),
  ).toBe("pr-merged-changed");
});
test("search defaults and round trip", () => {
  expect(searchParams({})).toMatchObject({
    page: 1,
    pageSize: 50,
    sort: "name",
    text: "",
  });
  const p = {
    text: "test",
    dirty: true,
    page: 2,
    pageSize: 20,
    sort: "date" as const,
  };
  expect(searchParams(stripDefaults(p))).toEqual(p);
  expect(stripDefaults({})).toEqual({});
});
