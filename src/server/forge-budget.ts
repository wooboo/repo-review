import { Data } from "effect";
import type { ForgeBudget } from "../domain/model";
export type { ForgeBudget } from "../domain/model";
export class ForgeRateLimited extends Data.TaggedError("ForgeRateLimited")<{
  message: string;
  host: string;
  retryAt: string;
}> {}
export class BudgetGuard {
  readonly budgets = new Map<string, ForgeBudget>();
  constructor(
    private save: (budget: ForgeBudget) => void = () => {},
    initial: ForgeBudget[] = [],
  ) {
    for (const b of initial) this.budgets.set(b.host + ":" + b.resource, b);
  }
  check(host: string, resource: string, cost = 1, reserve?: number) {
    const b = this.budgets.get(host + ":" + resource);
    const pause = [...this.budgets.values()].find(
      (b) => b.host === host && Date.parse(b.pausedUntil ?? "") > Date.now(),
    );
    const until =
      pause?.pausedUntil ??
      (b &&
      b.remaining - cost < (reserve ?? b.reserve) &&
      Date.parse(b.resetAt) > Date.now()
        ? b.resetAt
        : undefined);
    if (until)
      throw new ForgeRateLimited({
        host,
        retryAt: until,
        message: `Forge sync paused for rate limit until ${until}`,
      });
  }
  update(
    host: string,
    resource: string,
    remaining: number,
    resetAt: string,
    reserve: number,
    pausedUntil?: string,
  ) {
    const b = {
      host,
      resource,
      remaining,
      resetAt,
      reserve,
      ...(pausedUntil ? { pausedUntil } : {}),
    };
    this.budgets.set(host + ":" + resource, b);
    this.save(b);
  }
  observe(host: string, resource: string, response: Response, reserve: number) {
    const h = response.headers,
      old = this.budgets.get(host + ":" + resource);
    const remaining =
      h.get("x-ratelimit-remaining") ?? h.get("ratelimit-remaining");
    const reset = h.get("x-ratelimit-reset") ?? h.get("ratelimit-reset");
    const retry = h.get("retry-after");
    const until = retry
      ? new Date(
          /^\d+$/.test(retry)
            ? Date.now() + Number(retry) * 1000
            : Date.parse(retry),
        ).toISOString()
      : response.status === 429 ||
          (response.status === 403 && remaining === "0")
        ? reset
          ? new Date(Number(reset) * 1000).toISOString()
          : new Date(Date.now() + 60000).toISOString()
        : undefined;
    if (remaining !== null || until)
      this.update(
        host,
        resource,
        Number(remaining ?? old?.remaining ?? 0),
        reset
          ? new Date(Number(reset) * 1000).toISOString()
          : (old?.resetAt ?? new Date(Date.now() + 60000).toISOString()),
        reserve,
        until,
      );
    if (until)
      throw new ForgeRateLimited({
        host,
        retryAt: until,
        message: `Forge sync paused for rate limit until ${until}`,
      });
  }
}
