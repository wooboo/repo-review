import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

export function EmptyState({ children, action, className }: { children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground", className)}>
      <p className="max-w-sm text-pretty">{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm", className)}>
      <p className="flex items-center gap-2 font-medium text-destructive">
        <AlertTriangleIcon className="size-4" />
        {m.somethingWrong}
      </p>
      <p className="break-words text-muted-foreground [overflow-wrap:anywhere]">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="outline" className="h-11 md:h-8" onClick={onRetry}>
          <RotateCcwIcon />
          {m.retry}
        </Button>
      )}
    </div>
  );
}

export function ListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-busy="true" aria-label={m.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label={m.loading}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-11 w-full" />
      <ListSkeleton />
    </div>
  );
}

export function PageError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const boundary = useQueryErrorResetBoundary();
  return (
    <ErrorState
      error={error}
      onRetry={() => {
        boundary.reset();
        reset();
        void router.invalidate();
      }}
    />
  );
}

export function PageNotFound() {
  return (
    <div className="grid place-content-center gap-4 py-16 text-center">
      <p role="alert" className="text-lg">
        {m.pageNotFound}
      </p>
      <Button asChild className="h-11 md:h-9">
        <Link to="/">{m.goHome}</Link>
      </Button>
    </div>
  );
}
