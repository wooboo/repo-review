import repoWorker from "./generated/repo-worker";
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
export async function scanParallel(
  args: string[],
  emit: (value: unknown) => void = console.log,
) {
  const values = (key: string) =>
    args.flatMap((a, i) => (a === key ? [args[i + 1]] : []));
  const jobs = Math.max(1, Math.min(32, Number(values("--jobs")[0] ?? 4) || 4));
  const host = values("--host")[0] ?? "local",
    t3 = args.includes("--no-t3")
      ? { roots: [], threads: [], errors: [] }
      : readThreads();
  const entries = [...discover([...values("--root"), ...t3.roots])].filter(
    ([, p]) =>
      !values("--repo").length || values("--repo").some((s) => p.includes(s)),
  );
  const repositories: ReturnType<typeof collectRepo>[] = [],
    errors = [...t3.errors];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, entries.length) }, async () => {
      while (next < entries.length) {
        const [common, path] = entries[next++];
        emit({ type: "progress", host, path });
        try {
          const p = Bun.spawn([process.execPath, "run", "-"], {
            stdin: new Blob([
              "process.argv[2]=" +
                JSON.stringify(
                  JSON.stringify([
                    common,
                    path,
                    args.includes("--fetch"),
                    t3.threads,
                  ]),
                ) +
                ";\n",
              repoWorker,
            ]),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [output, error, code] = await Promise.all([
            new Response(p.stdout).text(),
            new Response(p.stderr).text(),
            p.exited,
          ]);
          if (code) throw Error(error);
          repositories.push(JSON.parse(output));
        } catch (e) {
          errors.push(`${path}: ${String(e)}`);
        }
      }
    }),
  );
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
  await scanParallel(process.argv.slice(2), (v) =>
    console.log(JSON.stringify(v)),
  );
