import type { FetchQueryOptions, QueryClient } from "@tanstack/react-query";
import { m } from "@/messages";

/** Page title for `head`. */
export const title = (...parts: string[]) => ({ meta: [{ title: [...parts, m.appName].join(" · ") }] });

/** Warm the cache on hover/intent in the browser; the page itself renders skeletons while loading. */
export function prefetch(client: QueryClient, ...options: FetchQueryOptions<any, any, any, any>[]) {
  if (typeof window === "undefined") return;
  for (const o of options) void client.prefetchQuery(o);
}
