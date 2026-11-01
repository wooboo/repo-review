import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, GitBranchIcon } from "lucide-react";
import { LandedBadge, MethodPill, Mono, Pill, RelativeTime } from "@/components/domain";
import { branchId } from "@/lib/api/ids";
import type { BranchHistoryItem, Landing } from "@/lib/api/types";
import { repoName, shortSha } from "@/lib/format";
import { commitUrl, landingBranches } from "@/lib/provenance";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

export function CommitLink({ repo, sha, className }: { repo: string; sha: string; className?: string }) {
  const url = commitUrl(repo, sha);
  if (!url) return <Mono className={className}>{shortSha(sha)}</Mono>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-0.5 font-mono text-xs underline-offset-4 hover:underline", className)}>
      {shortSha(sha)}
      <ExternalLinkIcon className="size-3" aria-hidden="true" />
    </a>
  );
}

/** One base commit: what landed, from which PR and branch, how it was matched, and the local branches it absorbed. */
export function LandingRow({ repo, landing: l, liveIds, baseIds }: { repo: string; landing: Landing; liveIds: ReadonlySet<string>; baseIds: ReadonlySet<string> }) {
  const branches = landingBranches(l, liveIds, baseIds);
  const direct = l.method === "direct" || (!l.pullRequestId && l.via === "none");
  return (
    <li className="flex flex-col gap-1.5 p-3">
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-medium break-words">{l.subject}</span>
        {l.pullRequestId && l.number !== null ? (
          <Link to="/prs/$pr" params={{ pr: l.pullRequestId }} className="shrink-0">
            <Pill t="good">#{l.number}</Pill>
          </Link>
        ) : l.method === "direct" ? (
          <Pill>{m.prs.landedMethod.direct}</Pill>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <CommitLink repo={repo} sha={l.sha} />
        <span>{l.author}</span>
        <RelativeTime iso={l.at} />
        <span className="font-mono">{l.base}</span>
      </span>
      <span className="flex flex-wrap items-center gap-1">
        {l.method !== "direct" && <MethodPill method={l.method} />}
        {l.sourceBranch && <Pill className="font-mono">{m.provenance.from(l.sourceBranch)}</Pill>}
        {/* A direct push has no PR to resolve; "unresolved" only matters when a PR was expected. */}
        {!direct && <Pill t={l.via === "none" ? "warn" : "neutral"}>{l.via === "none" ? m.provenance.via.none : m.provenance.viaLabel(m.provenance.via[l.via])}</Pill>}
      </span>
      {branches.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <GitBranchIcon className="size-3.5 text-muted-foreground" aria-label={m.nav.branches} />
          {branches.map((b) => (
            <Link key={b.id} to="/branches/$id" params={{ id: b.id }} className="inline-flex min-h-11 items-center gap-1.5 font-mono text-xs underline-offset-4 hover:underline md:min-h-0">
              {b.name}
              {!b.live && <Pill>{m.provenance.gone}</Pill>}
            </Link>
          ))}
        </span>
      )}
    </li>
  );
}

/** A branch a scan no longer sees: where it was, when it went, and where it landed. */
export function HistoryRow({ item: h, showRepo = true }: { item: BranchHistoryItem; showRepo?: boolean }) {
  return (
    <li>
      <Link to="/branches/$id" params={{ id: branchId(h.repo, h.branch) }} className="flex flex-col gap-1.5 p-3 hover:bg-muted/50">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 font-medium break-all">{h.branch}</span>
          {h.landedVia ? <LandedBadge landed={h.landedVia} /> : <Pill t="warn">{m.branches.notLanded}</Pill>}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {showRepo && <span className="font-medium text-foreground/80 break-all">{repoName(h.repo)}</span>}
          <Mono>{shortSha(h.sha)}</Mono>
          <span>{h.goneAt ? m.branches.goneAt : m.branches.lastSeen} <RelativeTime iso={h.goneAt ?? h.lastSeen} /></span>
        </span>
        <Mono className="text-muted-foreground">{h.host}:{h.clonePath}</Mono>
      </Link>
    </li>
  );
}
