import { resolve } from "node:path";
import type { State, Verdict, LandedVia } from "./model";
export function safeUrl(value: string) {
  if (value.includes("://")) {
    const u = new URL(value);
    u.username = "";
    u.password = "";
    u.search = "";
    u.hash = "";
    return u.toString();
  }
  return value.replace(/^[^/@]+@([^:]+):/, "$1:");
}
export function normalizeUrl(value: string) {
  value = value.trim();
  if (!value) return "";
  if (value.includes("://")) {
    const u = new URL(value);
    if (u.protocol === "file:") return "file:" + u.pathname;
    return (
      u.hostname +
      "/" +
      u.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")
    ).toLowerCase();
  }
  const m = value.match(/^(?:[^/@]+@)?([^/:]+):(.+)$/);
  if (m)
    return (
      m[1] +
      "/" +
      m[2].replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")
    ).toLowerCase();
  return "file:" + resolve(value);
}
export const integrated = (state: State) =>
  [
    "pr-merged",
    "merged",
    "patch-merged",
    "squash-merged",
    "content-in-base",
  ].includes(state);
export function verdict(
  clones: readonly {
    state: State;
    sha: string;
    dirty: boolean;
    active: boolean;
    unpushed: number;
  }[],
  pr?: { state: string; headSha: string },
): Verdict {
  if (clones.some((c) => c.state === "base")) return "base";
  if (
    clones.every(
      (c) =>
        integrated(c.state) || (pr?.state === "merged" && pr.headSha === c.sha),
    )
  )
    return clones.some((c) => c.dirty || c.active) ? "check" : "delete";
  if (clones.some((c) => c.state === "pr-merged-changed"))
    return "pr-merged-changed";
  if (pr?.state === "open") return "pr-open";
  if (clones.some((c) => c.unpushed > 0)) return "local-only";
  if (pr?.state === "closed") return "pr-closed";
  if (pr?.state === "merged") return "pr-merged-changed";
  return "unmerged";
}
export const activeStatus = (s: string) =>
  ["running", "waiting", "starting", "queued", "preparing"].includes(s);

export function landedState(state: State, via: LandedVia | null): State {
  if (state === "base" || (via?.extraCommits && integrated(state)))
    return state;
  return via ? (via.extraCommits ? "pr-merged-changed" : "pr-merged") : state;
}
