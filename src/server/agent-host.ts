import { spawnSync } from "node:child_process";
import type { Host } from "../domain/model";
import { AgentError } from "./errors";
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export function sshCommand(host: Host, args: string[]) {
  if (!host.target || host.target.startsWith("-"))
    throw new AgentError({ message: "Invalid SSH target" });
  return [
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=15",
    "--",
    host.target,
    args.map(quote).join(" "),
  ];
}
export function prepareRemote(
  host: Host,
  input: {
    repo: string;
    cwd: string;
    worktree: string;
    root: string;
    id: string;
    branch: string;
  },
) {
  const source = `import {spawnSync} from 'node:child_process';import {mkdirSync,realpathSync} from 'node:fs';import {homedir} from 'node:os';import {join} from 'node:path';const v=JSON.parse(process.argv[1]);const git=(...args)=>{const r=spawnSync('git',['-C',v.repo,...args],{encoding:'utf8'});if(r.status!==0)throw Error('Remote git preflight refused');return r.stdout.trim();};let cwd=v.cwd;if(v.worktree==='new'){const root=v.root.startsWith('~/')?join(homedir(),v.root.slice(2)):v.root;mkdirSync(root,{recursive:true});cwd=join(root,v.id);git('worktree','add','-b','agent/'+v.id,cwd,v.branch);}else if(v.worktree==='existing'){cwd=realpathSync(cwd);if(!git('worktree','list','--porcelain').split('\\n').includes('worktree '+cwd))throw Error('Remote worktree no longer registered');}console.log(JSON.stringify({cwd}));`;
  const [command, ...args] = sshCommand(host, [
    host.bun ?? "bun",
    "-e",
    source,
    JSON.stringify(input),
  ]);
  const r = spawnSync(command, args, { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0)
    throw new AgentError({ message: "Remote worktree preparation failed" });
  return (JSON.parse(r.stdout) as { cwd: string }).cwd;
}
export function remoteAgentCommand(
  host: Host,
  command: string,
  args: string[],
  cwd: string,
  cli = false,
) {
  // The remote supervisor owns a detached process group. SSH disconnect closes
  // stdin, which terminates the entire remote group even if children outlive ACP.
  const source = `import {spawn} from 'node:child_process';const v=JSON.parse(process.argv[1]);const p=spawn(v.command,v.args,{cwd:v.cwd,stdio:['pipe','pipe','pipe'],detached:true});const kill=s=>{try{process.kill(-p.pid,s);}catch{}};const stop=()=>{kill('SIGTERM');setTimeout(()=>{kill('SIGKILL');process.exit(143);},2000);};for(const s of ['SIGHUP','SIGTERM','SIGINT'])process.on(s,stop);process.stdin.on('end',stop);if(v.cli)p.stdin.end();else process.stdin.pipe(p.stdin);p.stdout.pipe(process.stdout);p.stderr.pipe(process.stderr);p.on('error',()=>process.exit(1));p.on('exit',c=>{kill('SIGTERM');process.exit(c??1);});`;
  return sshCommand(host, [
    host.bun ?? "bun",
    "-e",
    source,
    JSON.stringify({ command, args, cwd, cli }),
  ]);
}
