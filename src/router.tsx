import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { PageError, PageNotFound, PageSkeleton } from "@/components/states";
import { parseSearch, stringifySearch } from "@/lib/url";

export function getRouter() {
  // One client per router: per request on the server, one for the browser session.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, gcTime: 10 * 60_000, refetchOnWindowFocus: true, retry: 1 } },
  });
  const router = createTanStackRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultPendingMs: 300,
    defaultPendingComponent: PageSkeleton,
    defaultErrorComponent: PageError,
    defaultNotFoundComponent: PageNotFound,
    parseSearch,
    stringifySearch,
    Wrap: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
