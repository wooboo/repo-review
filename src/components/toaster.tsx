import { XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { currentToasts, dismissToast, serverToasts, subscribeToasts } from "@/lib/toast";
import { m } from "@/messages";

/** Toasts above the mobile bottom navigation; announced politely to screen readers. */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, currentToasts, serverToasts);
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 px-3 md:inset-x-auto md:right-6 md:bottom-6 md:items-end"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-xl border bg-popover p-2 pl-4 text-sm text-popover-foreground shadow-lg">
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          {t.action && (
            <Button variant="outline" size="sm" className="h-11 shrink-0 md:h-8" onClick={() => { t.action!.onClick(); dismissToast(t.id); }}>
              {t.action.label}
            </Button>
          )}
          <IconButton label={m.close} onClick={() => dismissToast(t.id)}>
            <XIcon />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
