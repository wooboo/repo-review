import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { themeScript } from "@/lib/theme";
import { m } from "@/messages";
import appCss from "../styles.css?url";

const icon = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f766e"/><g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"><circle cx="22" cy="18" r="6"/><circle cx="22" cy="46" r="6"/><circle cx="44" cy="26" r="6"/><path d="M22 24v16M44 32c0 8-10 8-18 12"/></g></svg>')}`;

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "color-scheme", content: "light dark" },
      { title: m.appName },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: icon, type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootDocument,
  component: AppShell,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Scripts />
      </body>
    </html>
  );
}
