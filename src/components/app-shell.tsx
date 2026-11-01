import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BotIcon, FolderGit2Icon, FolderTreeIcon, GitBranchIcon, GitPullRequestIcon, HistoryIcon, InboxIcon, MenuIcon, SettingsIcon, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { AppearanceControls, PaletteMenu, ThemeMenu } from "@/components/theme-menu";
import { Toaster } from "@/components/toaster";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useLiveUpdates } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

type NavItem = { to: "/" | "/repos" | "/branches" | "/worktrees" | "/prs" | "/agents" | "/scans" | "/settings"; label: string; short?: string; icon: LucideIcon };
const NAV: NavItem[] = [
  { to: "/", label: m.nav.attention, icon: InboxIcon },
  { to: "/repos", label: m.nav.repos, icon: FolderGit2Icon },
  { to: "/branches", label: m.nav.branches, icon: GitBranchIcon },
  { to: "/prs", label: m.nav.prs, short: m.nav.prsShort, icon: GitPullRequestIcon },
  { to: "/worktrees", label: m.nav.worktrees, icon: FolderTreeIcon },
  { to: "/agents", label: m.nav.agents, icon: BotIcon },
  { to: "/scans", label: m.nav.scans, icon: HistoryIcon },
  { to: "/settings", label: m.nav.settings, icon: SettingsIcon },
];
const PRIMARY = NAV.slice(0, 4);
const SECONDARY = NAV.slice(4);

const isActive = (path: string, to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));

export function AppShell() {
  useLiveUpdates();
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <Link to="/" className="flex h-14 items-center gap-2 px-4 font-semibold tracking-tight">
          <GitBranchIcon className="size-5 text-sidebar-primary" />
          {m.appName}
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label={m.appName}>
          {NAV.map((item) => (
            <SideLink key={item.to} item={item} active={isActive(path, item.to)} />
          ))}
        </nav>
        <div className="flex items-center gap-1 border-t p-2">
          <ThemeMenu />
          <PaletteMenu />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-6xl flex-1 px-3 pt-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:px-4 md:px-6 md:pt-6 md:pb-10">
          <Outlet />
        </main>
      </div>
      <BottomNav path={path} />
      <Toaster />
    </div>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-primary font-medium text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

function BottomNav({ path }: { path: string }) {
  const [more, setMore] = useState(false);
  const moreActive = SECONDARY.some((i) => isActive(path, i.to));
  const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";
  const on = "text-primary";
  const off = "text-muted-foreground";
  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label={m.appName}
      >
        {PRIMARY.map((item) => {
          const active = isActive(path, item.to);
          const Icon = item.icon;
          return (
            <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} className={cn(tab, active ? on : off)}>
              <span className={cn("grid h-7 w-12 place-items-center rounded-full", active && "bg-primary text-primary-foreground")}>
                <Icon className="size-5" />
              </span>
              {item.short ?? item.label}
            </Link>
          );
        })}
        <button type="button" className={cn(tab, moreActive ? on : off)} onClick={() => setMore(true)} aria-expanded={more}>
          <span className={cn("grid h-7 w-12 place-items-center rounded-full", moreActive && "bg-primary text-primary-foreground")}>
            <MenuIcon className="size-5" />
          </span>
          {m.more}
        </button>
      </nav>
      <Sheet open={more} onOpenChange={setMore}>
        <SheetContent side="bottom" className="gap-0 pb-[env(safe-area-inset-bottom)]">
          <SheetHeader>
            <SheetTitle>{m.more}</SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col px-2">
            {SECONDARY.map((item) => {
              const Icon = item.icon;
              const active = isActive(path, item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMore(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-12 items-center gap-3 rounded-md px-3 text-base", active ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
                >
                  <Icon className="size-5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="p-4">
            <AppearanceControls />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
