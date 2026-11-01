import type * as React from "react";
import { cn } from "@/lib/utils";

/** Shared wrapper of every filter: label, then the control. */
export function FilterField({ label, labelFor, children, className, id }: { label: React.ReactNode; labelFor?: string; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} role="group" aria-labelledby={id}>
      {labelFor ? (
        <label id={id} htmlFor={labelFor} className="text-sm font-medium">
          {label}
        </label>
      ) : (
        <span id={id} className="text-sm font-medium">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

/** Boolean filter: the whole row is the tap target. */
export function SwitchRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm md:min-h-8">
      <span>{label}</span>
      {children}
    </label>
  );
}
