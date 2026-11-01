import type { AgentEvent } from "@/lib/api/types";

/** Consecutive message/thought chunks are merged so the stream reads as text, not tokens. */
export function mergeChunks(events: readonly AgentEvent[]): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const e of events) {
    const last = out.at(-1);
    if (last && (e.kind === "message" || e.kind === "thought") && last.kind === e.kind) out[out.length - 1] = { ...last, text: last.text + e.text };
    else out.push(e);
  }
  return out;
}
