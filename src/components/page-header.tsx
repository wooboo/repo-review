import { Link, useCanGoBack, useRouter, type LinkProps } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import type * as React from "react";
import { IconButton } from "@/components/icon-button";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

/** Page title row; detail pages get a back button (history back, else the parent list). */
export function PageHeader({ title, subtitle, back, actions, className }: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: LinkProps["to"];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-4 flex items-start gap-2", className)}>
      {back && <BackButton to={back} />}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 self-center">
        <h1 className="text-xl font-semibold tracking-tight break-words [overflow-wrap:anywhere] md:text-2xl">{title}</h1>
        {subtitle && <div className="text-sm text-muted-foreground break-words [overflow-wrap:anywhere]">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

function BackButton({ to }: { to: LinkProps["to"] }) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  if (canGoBack)
    return (
      <IconButton label={m.back} className="-ml-2" onClick={() => router.history.back()}>
        <ArrowLeftIcon />
      </IconButton>
    );
  return (
    <IconButton label={m.back} className="-ml-2" asChild>
      <Link to={to}>
        <ArrowLeftIcon />
      </Link>
    </IconButton>
  );
}

export function Section({ title, actions, children, className, id }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-2", className)} aria-labelledby={id}>
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h2 id={id} className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border bg-card p-3 text-card-foreground md:p-4", className)}>{children}</div>;
}
