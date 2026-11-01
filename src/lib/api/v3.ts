/**
 * TODO(contract-v3): typed client for the Contract v3 server functions (docs/API.md, "Contract v3").
 * They are looked up by name because `main` does not export them yet. A missing function throws
 * NotAvailableYet, which views render as "not available yet" instead of an error. Once the v3
 * backend is merged, replace these lookups with direct calls like the ones in ./client.
 */
import * as server from "@/server/functions";
import { refreshPullRequests } from "./client";
import { lookup as find, NotAvailableYet } from "./optional";
import type { BranchHistoryItem, BranchHistoryQuery, JobRef, Landing, LandingQuery, Page } from "./types";

export { isNotAvailableYet, NotAvailableYet } from "./optional";

const lookup = <I, O>(name: string) => find<I, O>(server, name);

async function call<I, O>(name: string, data: I): Promise<O> {
  const fn = lookup<I, O>(name);
  if (!fn) throw new NotAvailableYet(name);
  return fn({ data });
}

export const listLandings = (input: LandingQuery) => call<LandingQuery, Page<Landing>>("listLandings", input);

export const getCommitProvenance = (input: { repo: string; sha: string }) => call<{ repo: string; sha: string }, Landing | null>("getCommitProvenance", input);

export const listBranchHistory = (input: BranchHistoryQuery) => call<BranchHistoryQuery, Page<BranchHistoryItem>>("listBranchHistory", input);

/** Incremental PR sync job; falls back to the v2 refresh while the server has no sync function. */
export function syncPullRequests(input: { repo?: string; full?: boolean }): Promise<JobRef> {
  const fn = lookup<{ repo?: string; full?: boolean }, JobRef>("syncPullRequests");
  return fn ? fn({ data: input }) : refreshPullRequests({ repo: input.repo });
}
