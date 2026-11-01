import { createFileRoute } from "@tanstack/react-router";
import { Card, PageHeader, Section } from "@/components/page-header";
import { ScanControl, ScanRow, useScans } from "@/components/scans";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/states";
import { useQuery } from "@tanstack/react-query";
import { ActionList } from "@/components/action-flow";
import { q } from "@/lib/queries";
import { title } from "@/lib/route-helpers";
import { m } from "@/messages";

export const Route = createFileRoute("/scans")({
  head: () => title(m.nav.scans),
  component: Scans,
});

function Scans() {
  const scans = useScans();
  const actions = useQuery(q.actions({ page: 1, pageSize: 20 }));
  return (
    <>
      <PageHeader title={m.scan.history} />
      <div className="flex flex-col gap-6">
        <Card><ScanControl /></Card>
        {scans.isPending ? (
          <ListSkeleton />
        ) : scans.error ? (
          <ErrorState error={scans.error} onRetry={() => void scans.refetch()} />
        ) : !scans.data.length ? (
          <EmptyState>{m.attention.noScans}</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {scans.data.map((s, i) => <ScanRow key={s.id} scan={s} defaultOpen={i === 0} />)}
          </div>
        )}
        {actions.data && actions.data.items.length > 0 && (
          <Section title={m.actions.history} id="actions">
            <ActionList actions={actions.data.items} showRestore />
          </Section>
        )}
      </div>
    </>
  );
}
