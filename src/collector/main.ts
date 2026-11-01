import { discover } from "./git";
import { collectRepo } from "./analyze";
import { readThreads } from "./threads";
export function scan(
  args: string[],
  emit: (value: unknown) => void = console.log,
) {
  const values = (key: string) =>
    args.flatMap((a, i) => (a === key ? [args[i + 1]] : []));
  const host = values("--host")[0] ?? "local";
  const t3 = args.includes("--no-t3")
    ? { roots: [], threads: [], errors: [] }
    : readThreads();
  const repositories = [];
  const errors = [...t3.errors];
  for (const [common, path] of discover([...values("--root"), ...t3.roots])) {
    if (
      values("--repo").length &&
      !values("--repo").some((s) => path.includes(s))
    )
      continue;
    emit({ type: "progress", host, path });
    try {
      repositories.push(
        collectRepo(common, path, args.includes("--fetch"), t3.threads),
      );
    } catch (e) {
      errors.push(`${path}: ${String(e)}`);
    }
  }
  const snapshot = {
    version: 1,
    host,
    finished: new Date().toISOString(),
    repositories,
    errors,
  };
  emit({ type: "snapshot", snapshot });
  return snapshot;
}
if (import.meta.main)
  scan(process.argv.slice(2), (v) => console.log(JSON.stringify(v)));
