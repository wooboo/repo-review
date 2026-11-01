/** Optional server functions: looked up by name, so a build without them degrades instead of failing. */
export class NotAvailableYet extends Error {
  constructor(readonly fn: string) {
    super(`${fn} is not available on this server yet`);
    this.name = "NotAvailableYet";
  }
}

export const isNotAvailableYet = (e: unknown): boolean => e instanceof NotAvailableYet || (e instanceof Error && e.name === "NotAvailableYet");

export type ServerFn<I, O> = (options: { data: I }) => Promise<O>;

/** The function `name` of a server-function module, when that build exports it. */
export function lookup<I, O>(module: object, name: string): ServerFn<I, O> | undefined {
  const fn = (module as Record<string, unknown>)[name];
  return typeof fn === "function" ? (fn as ServerFn<I, O>) : undefined;
}
