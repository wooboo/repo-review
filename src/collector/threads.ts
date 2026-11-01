import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { run } from "./git";
import type { Thread } from "../domain/model";
/** Separate process bounds even a blocked open(2) on an external volume. */
export function readThreads(): {
  roots: string[];
  threads: Thread[];
  errors: string[];
} {
  const paths = [join(homedir(), ".t3/userdata/statev2.sqlite")];
  if (existsSync("/Volumes"))
    for (const v of readdirSync("/Volumes"))
      paths.push(join("/Volumes", v, ".t3/userdata/statev2.sqlite"));
  const result = {
    roots: [] as string[],
    threads: [] as Thread[],
    errors: [] as string[],
  };
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const source = `import {Database} from 'bun:sqlite';const d=new Database(process.argv[1],{readonly:true});const projects=d.query('select project_id, workspace_root, deleted_at from projection_projects').all();const runs=d.query('select thread_id,status from orchestration_v2_projection_runs r1 where ordinal=(select max(ordinal) from orchestration_v2_projection_runs r2 where r2.thread_id=r1.thread_id)').all();const threads=d.query('select thread_id,payload_json from orchestration_v2_projection_threads').all();console.log(JSON.stringify({projects,runs,threads}));d.close();`;
    const r = run(process.execPath, ["-e", source, p], undefined, 5000);
    if (r.code) {
      result.errors.push("T3 state unavailable");
      continue;
    }
    try {
      const data = JSON.parse(r.out) as {
        projects: {
          project_id: string;
          workspace_root: string;
          deleted_at: string | null;
        }[];
        runs: { thread_id: string; status: string }[];
        threads: { thread_id: string; payload_json: string }[];
      };
      for (const p of data.projects)
        if (
          !p.deleted_at &&
          p.workspace_root &&
          !p.workspace_root.includes("/scratch")
        )
          result.roots.push(p.workspace_root);
      for (const row of data.threads) {
        const t = JSON.parse(row.payload_json) as Record<string, string>;
        if (t.deletedAt) continue;
        result.threads.push({
          id: row.thread_id,
          title: t.title ?? "",
          branch: t.branch ?? null,
          worktree: t.worktreePath ?? null,
          projectRoot:
            data.projects.find((p) => p.project_id === t.projectId)
              ?.workspace_root ?? null,
          status:
            data.runs.find((r) => r.thread_id === row.thread_id)?.status ?? "",
        });
      }
    } catch {
      result.errors.push("T3 state invalid");
    }
  }
  return result;
}
