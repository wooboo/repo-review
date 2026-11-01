import { ChevronDownIcon } from "lucide-react";
import { useMemo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { parseDiff, type DiffLine } from "@/lib/diff";
import { cn } from "@/lib/utils";
import { m } from "@/messages";

const LARGE = 400;

/** Per-file collapsible unified diff: horizontal scroll inside the file (or wrapped lines), never the page. */
export function DiffViewer({ diff, wrap, truncated }: { diff: string; wrap: boolean; truncated: boolean }) {
  const files = useMemo(() => parseDiff(diff), [diff]);
  if (!files.length) return <p className="text-sm text-muted-foreground">{m.prs.noFiles}</p>;
  return (
    <div className="flex flex-col gap-3">
      {truncated && <p className="text-sm text-warning">{m.prs.diffTruncated}</p>}
      {files.map((f) => (
        <Collapsible key={f.path} defaultOpen={f.lines.length <= LARGE} id={"file-" + f.path} className="scroll-mt-4 overflow-hidden rounded-xl border bg-card">
          <CollapsibleTrigger className="group sticky top-0 z-10 flex min-h-11 w-full items-center gap-2 border-b bg-card px-3 py-2 text-left">
            <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
            <span className="min-w-0 flex-1 font-mono text-xs break-all">{f.oldPath !== f.path ? `${f.oldPath} → ${f.path}` : f.path}</span>
            <span className="shrink-0 font-mono text-xs tabular-nums">
              <span className="text-success">+{f.additions}</span> <span className="text-destructive">−{f.deletions}</span>
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className={cn("font-mono text-[12px] leading-5", !wrap && "overflow-x-auto")}>
              <table className={cn("border-collapse", wrap ? "w-full table-fixed" : "min-w-full")}>
                <colgroup>
                  <col className="hidden w-10 sm:table-column" />
                  <col className="w-10" />
                  <col />
                </colgroup>
                <tbody>
                  {f.lines.map((l, i) => <Line key={i} line={l} wrap={wrap} />)}
                </tbody>
              </table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}

function Line({ line, wrap }: { line: DiffLine; wrap: boolean }) {
  const bg = line.kind === "add" ? "bg-diff-add" : line.kind === "del" ? "bg-diff-del" : line.kind === "hunk" ? "bg-diff-hunk text-muted-foreground" : line.kind === "meta" ? "text-muted-foreground" : "";
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const gutter = "select-none border-r px-1.5 text-right align-top text-muted-foreground/70 tabular-nums";
  return (
    <tr className={bg}>
      <td className={cn(gutter, "hidden sm:table-cell")}>{line.old ?? ""}</td>
      <td className={gutter}>
        {line.new ?? (line.kind === "del" && <span className="sm:hidden">{line.old}</span>)}
      </td>
      <td className={cn("px-2 align-top", wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre")}>
        {line.kind === "hunk" || line.kind === "meta" ? line.text : <><span className="select-none text-muted-foreground">{sign}</span>{line.text}</>}
      </td>
    </tr>
  );
}
