import { useQuery } from "@tanstack/react-query";
import { CopyButton, Mono, RelativeTime } from "@/components/domain";
import { Card } from "@/components/page-header";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { formatDateTime } from "@/lib/format";
import { sortDeleted } from "@/lib/deletion";
import { q } from "@/lib/queries";
import { m } from "@/messages";

/** Tombstones of repositories deleted from disk, with every clone's archive path. */
export function DeletedRepositories() {
  const deleted = useQuery(q.deletedRepos());
  if (deleted.isPending) return <ListSkeleton rows={3} />;
  if (deleted.error) return <ErrorState error={deleted.error} onRetry={() => void deleted.refetch()} />;
  if (!deleted.data.length) return <EmptyState>{m.deleted.empty}</EmptyState>;
  return (
    <ul className="flex flex-col gap-2">
      {sortDeleted(deleted.data).map((r) => (
        <li key={r.id + r.deletedAt}>
          <Card className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-medium break-all">{r.name}</span>
              <span className="text-xs text-muted-foreground" title={formatDateTime(r.deletedAt)}>
                <RelativeTime iso={r.deletedAt} />
              </span>
            </div>
            <span className="-mt-1.5 text-xs break-all text-muted-foreground">{r.id}</span>
            <ul className="flex flex-col gap-2">
              {r.clones.map((c) => (
                <li key={c.host + c.path + c.archivePath} className="flex flex-col gap-1 rounded-lg bg-muted/50 p-2 text-sm">
                  <Mono>{c.host}:{c.path}</Mono>
                  <span className="flex items-center gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground">{m.deleted.archive}</span>
                    <Mono className="min-w-0 flex-1">{c.archivePath}</Mono>
                    <CopyButton text={c.archivePath} />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </li>
      ))}
    </ul>
  );
}
