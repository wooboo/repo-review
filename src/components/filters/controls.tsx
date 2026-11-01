import { ChevronLeftIcon, ChevronRightIcon, RotateCcwIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

/** Text filter bound to the URL: typing updates it after a short pause (history replace). */
export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text === last.current) return;
    const t = setTimeout(() => {
      last.current = text;
      onChange(text);
    }, 250);
    return () => clearTimeout(t);
  }, [text, onChange]);
  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 pr-10 pl-9 md:h-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <IconButton label={m.close} className="absolute top-1/2 right-0 -translate-y-1/2 md:right-0.5 md:size-8" onClick={() => setText("")}>
          <XIcon />
        </IconButton>
      )}
    </div>
  );
}

/** Mobile: a filter button with the active count that opens a sheet. Desktop: the panel sits in an aside. */
export function FilterLayout({ panel, activeCount, onReset, toolbar, children }: {
  panel: (idPrefix: string) => React.ReactNode;
  activeCount: number;
  onReset: () => void;
  toolbar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex gap-6">
      <aside className="hidden w-60 shrink-0 lg:block">
        <div className="sticky top-6 flex flex-col gap-5">
          {panel("d-")}
          <Button variant="outline" className="h-8" disabled={!activeCount} onClick={onReset}>
            <RotateCcwIcon />
            {m.resetFilters(activeCount)}
          </Button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-2">
          {toolbar}
          <Button variant="outline" className="relative h-11 shrink-0 px-3 lg:hidden" onClick={() => setOpen(true)} aria-label={m.filters}>
            <SlidersHorizontalIcon />
            <span className="sr-only sm:not-sr-only">{m.filters}</span>
            {activeCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                {activeCount}
              </span>
            )}
          </Button>
        </div>
        {children}
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] gap-0 lg:hidden">
          <SheetHeader>
            <SheetTitle>{m.filters}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-5 overflow-y-auto px-4 pb-4">{panel("m-")}</div>
          <SheetFooter className="flex-row border-t">
            <Button variant="outline" className="h-11 flex-1" disabled={!activeCount} onClick={onReset}>
              <RotateCcwIcon />
              {m.resetFilters(activeCount)}
            </Button>
            <Button className="h-11 flex-1" onClick={() => setOpen(false)}>
              {m.close}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export const ANY = "__any__";

/** Select over a long enum; `""` (or ANY in the widget) means no filter. */
export function OptionSelect<T extends string>({ id, value, onChange, options, anyLabel, label, className }: {
  id?: string;
  value: T | "";
  onChange: (v: T | "") => void;
  options: readonly { value: T; label: string }[];
  anyLabel?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? "" : (v as T))}>
      <SelectTrigger id={id} aria-label={label} className={cn("w-full data-[size=default]:h-11 md:data-[size=default]:h-9", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {anyLabel !== undefined && (
          <SelectItem value={ANY} className="min-h-11 md:min-h-8">
            {anyLabel}
          </SelectItem>
        )}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="min-h-11 md:min-h-8">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="flex items-center justify-center gap-2 py-2" aria-label={m.pageOf(page, pages)}>
      <IconButton label={m.previousPage} variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeftIcon />
      </IconButton>
      <span className="min-w-28 text-center text-sm text-muted-foreground tabular-nums">{m.pageOf(page, pages)}</span>
      <IconButton label={m.nextPage} variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRightIcon />
      </IconButton>
    </nav>
  );
}
