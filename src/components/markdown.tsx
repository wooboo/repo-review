import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Safe URL for a link in forge Markdown: only http(s), mailto and relative URLs survive
 * (react-markdown's allow-list), and relative ones resolve against the forge, not this app.
 */
export function markdownUrl(url: string, base?: string): string {
  const safe = defaultUrlTransform(url);
  if (!safe) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(safe) || safe.startsWith("#")) return safe;
  if (!base) return "";
  try {
    return new URL(safe, base.endsWith("/") ? base : base + "/").href;
  } catch {
    return "";
  }
}

const external = { target: "_blank", rel: "noreferrer noopener nofollow" } as const;

const components = (base?: string): Components => ({
  a: ({ href, children }) => {
    const url = href ? markdownUrl(href, base) : "";
    return url ? <a href={url} {...(url.startsWith("#") ? {} : external)}>{children}</a> : <span>{children}</span>;
  },
  // Images are not loaded (no tracking pixels, no forge auth); they become links.
  img: ({ src, alt }) => {
    const url = typeof src === "string" ? markdownUrl(src, base) : "";
    return url ? <a href={url} {...external}>{alt || url}</a> : <span>{alt}</span>;
  },
  pre: ({ children }) => <pre>{children}</pre>,
  table: ({ children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
  input: ({ type, checked }) => (type === "checkbox" ? <input type="checkbox" checked={!!checked} disabled readOnly /> : null),
});

/**
 * GitHub-flavoured Markdown from forges (PR bodies, reviews, comments). Raw HTML is dropped, never
 * rendered (no rehype-raw); code blocks and tables scroll horizontally instead of widening the page.
 */
export function Markdown({ children, base, className }: { children: string; base?: string; className?: string }) {
  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components(base)} urlTransform={(u) => markdownUrl(u, base)}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
