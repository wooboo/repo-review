import type * as React from "react";
import { TabsList } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** Tab list that fills the width when it fits and scrolls sideways on a phone when it does not. */
export function ScrollTabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="-mx-3 overflow-x-auto px-3 [scrollbar-width:none] sm:-mx-4 sm:px-4 md:mx-0 md:px-0">
      <TabsList className={cn("h-11 w-max min-w-full md:h-9 md:min-w-0", className)}>{children}</TabsList>
    </div>
  );
}
