/**
 * URL state of every list view: Effect Schemas with defaults. `decode` is lenient (an invalid
 * or unknown value falls back to its default, so old links keep working); `strip` drops every
 * value equal to its default, so a clean URL means the default view.
 */
import { Option, Schema } from "effect";
import { State, Verdict } from "@/domain/model";
import type { SearchSchemaInput } from "@tanstack/react-router";

type Fields = Record<string, Schema.Top>;
type Values<F extends Fields> = { [K in keyof F]: F[K]["Type"] };

function coerce(value: unknown, fallback: unknown): unknown {
  if (Array.isArray(fallback)) {
    if (typeof value === "string") return value.split(",").filter(Boolean);
    if (typeof value === "number" || typeof value === "boolean") return [String(value)];
    return value;
  }
  if (typeof fallback === "boolean" && typeof value === "string") return value === "true" ? true : value === "false" ? false : value;
  if (typeof fallback === "number" && typeof value === "string" && value.trim() !== "") return Number(value);
  if (typeof fallback === "string" && (typeof value === "number" || typeof value === "boolean")) return String(value);
  return value;
}

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;

export function searchSchema<F extends Fields>(fields: F, defaults: Values<F>) {
  const decoders = Object.fromEntries(
    Object.entries(fields).map(([k, s]) => [k, Schema.decodeUnknownOption(s as Schema.Codec<unknown>)]),
  ) as Record<string, (u: unknown) => Option.Option<unknown>>;
  /** Full search object with defaults filled in. */
  const decode = (raw: unknown): Values<F> => {
    const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(fields)) {
      const fallback = defaults[key];
      const value = input[key];
      out[key] = value === undefined ? fallback : Option.getOrElse(decoders[key](coerce(value, fallback)), () => fallback);
    }
    return out as Values<F>;
  };
  /** Only the values that differ from the defaults, ready for the URL. */
  const strip = (value: Partial<Values<F>>): Partial<Values<F>> =>
    Object.fromEntries(
      Object.entries(value).filter(([k, v]) => k in fields && v !== undefined && !same(v, defaults[k as keyof F])),
    ) as Partial<Values<F>>;
  /** Number of non-default fields among `keys` (filter badge). */
  const activeCount = (value: Values<F>, keys: readonly (keyof F)[]) => keys.filter((k) => !same(value[k], defaults[k])).length;
  return { fields, defaults, decode, strip, activeCount };
}

const Page = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const Text = Schema.String;
const JevFilter = Schema.Literals(["", "delete", "archive", "keep", "finish_and_merge"]);

export const repoListSearch = searchSchema(
  { q: Text, host: Text, sort: Schema.Literals(["attention", "name", "branches"]) },
  { q: "", host: "", sort: "attention" },
);

export const repoSearch = searchSchema({ tab: Schema.Literals(["overview", "branches", "worktrees", "prs"]) }, { tab: "overview" });

export const branchSearch = searchSchema(
  {
    q: Text,
    verdict: Schema.Array(Verdict),
    host: Text,
    repo: Text,
    state: Schema.Union([State, Schema.Literal("")]),
    stale: Schema.Boolean,
    dirty: Schema.Boolean,
    localOnly: Schema.Boolean,
    jev: JevFilter,
    sort: Schema.Literals(["date", "name"]),
    page: Page,
  },
  { q: "", verdict: [], host: "", repo: "", state: "", stale: false, dirty: false, localOnly: false, jev: "", sort: "date", page: 1 },
);
export const BRANCH_FILTER_KEYS = ["verdict", "host", "repo", "state", "stale", "dirty", "localOnly", "jev"] as const;

export const worktreeSearch = searchSchema({ q: Text, host: Text, repo: Text, dirty: Schema.Boolean }, { q: "", host: "", repo: "", dirty: false });
export const WORKTREE_FILTER_KEYS = ["host", "repo", "dirty"] as const;

export const prListSearch = searchSchema(
  {
    q: Text,
    state: Schema.Literals(["open", "merged", "closed", "all"]),
    repo: Text,
    checks: Schema.Literals(["", "success", "failure", "pending", "none"]),
    page: Page,
  },
  { q: "", state: "open", repo: "", checks: "", page: 1 },
);
export const PR_FILTER_KEYS = ["state", "repo", "checks"] as const;

export const prSearch = searchSchema(
  { tab: Schema.Literals(["conversation", "files", "diff", "checks"]), wrap: Schema.Boolean },
  { tab: "conversation", wrap: true },
);

export const agentListSearch = searchSchema(
  { status: Schema.Literals(["", "queued", "running", "done", "failed", "cancelled"]), repo: Text, page: Page },
  { status: "", repo: "", page: 1 },
);

export type BranchSearch = ReturnType<typeof branchSearch.decode>;
export type RepoListSearch = ReturnType<typeof repoListSearch.decode>;
export type WorktreeSearch = ReturnType<typeof worktreeSearch.decode>;
export type PrListSearch = ReturnType<typeof prListSearch.decode>;
export type AgentListSearch = ReturnType<typeof agentListSearch.decode>;

/**
 * `validateSearch` for a route: the parameter type marks every field optional for links and
 * navigation (SearchSchemaInput), the result has every default filled in.
 */
export function validator<V>(schema: { decode: (raw: unknown) => V }) {
  return (raw: Partial<V> & SearchSchemaInput): V => schema.decode(raw);
}

/** Search middleware: drop default values before the URL is written. */
export function stripDefaults<V>(schema: { strip: (v: Partial<V>) => Partial<V> }) {
  return ({ search, next }: { search: V; next: (s: V) => V }): V => schema.strip(next(search)) as V;
}
