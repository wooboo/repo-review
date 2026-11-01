/** Paging helpers shared by the API client (no server imports, so tests can use them directly). */
import type { Page } from "./types";

/** The server clamps page sizes to 1–200. */
export const MAX_PAGE = 200;

export function paginate<T>(rows: readonly T[], page: number, pageSize: number): Page<T> {
  const p = Math.max(1, page);
  return { items: rows.slice((p - 1) * pageSize, p * pageSize), total: rows.length, page: p, pageSize };
}

/** Every item of a paged list, fetched MAX_PAGE at a time. */
export async function allPages<T>(load: (page: number) => Promise<Page<T>>): Promise<T[]> {
  const first = await load(1);
  const rows = [...first.items];
  const pages = Math.ceil(first.total / Math.max(1, first.pageSize));
  for (let page = 2; page <= pages; page++) rows.push(...(await load(page)).items);
  return rows;
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message.replace(/^(Error: )+/, "");
  if (e && typeof e === "object" && "message" in e && typeof e.message === "string") return e.message;
  return String(e);
}
