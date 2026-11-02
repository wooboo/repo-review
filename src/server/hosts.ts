import { killTree, windows } from "../collector/platform";
import { HostError } from "./errors";
import { spawn } from "node:child_process";
import type { Host } from "../domain/model";
import collector from "../collector/generated/main";
import worker from "../collector/generated/worker";
const shell = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
async function runHostImpl(
  host: Host,
  kind: "scan" | "worker",
  args: string[],
  onEvent: (event: unknown) => void,
  timeoutMs = 3600000,
) {
  const bun = host.bun ?? "bun";
  if (host.kind === "ssh" && (!host.target || host.target.startsWith("-")))
    throw Error("Invalid SSH target");
  const local = [bun, "run", "-", ...args];
  const command =
    host.kind === "local"
      ? local
      : [
          "ssh",
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=15",
          "--",
          host.target!,
          local.map(shell).join(" "),
        ];
  await new Promise<void>((resolve, reject) => {
    const p = spawn(command[0], command.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
      detached: !windows,
    });
    p.stdout.setEncoding("utf8");
    p.stderr.setEncoding("utf8");
    let buffer = "",
      error = "",
      settled = false;
    let lastEvent = "none";
    const stop = () => {
      killTree(p.pid, kind === "scan" ? "SIGTERM" : "SIGKILL", () => { p.kill(); });
      const escalation = setTimeout(() => {
        if (p.exitCode === null && p.signalCode === null)
          killTree(p.pid, "SIGKILL", () => { p.kill("SIGKILL"); });
      }, 2000);
      escalation.unref();
    };
    const finish = (e?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      e ? reject(e) : resolve();
    };
    const timer = setTimeout(() => {
      stop();
      finish(Error(`Host ${host.id} runner timed out after ${timeoutMs}ms; last event: ${lastEvent}; stderr: ${error}`));
    }, timeoutMs);
    p.on("error", finish);
    p.stdin.on("error", () => {});
    p.stdout.on("data", (chunk: string) => {
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line)
          try {
            const event = JSON.parse(line);
            if (event.type !== "snapshot") lastEvent = line.slice(-2000);
            onEvent(event);
          } catch (e) {
            stop();
            finish(Error("Invalid host protocol: " + String(e)));
          }
      }
    });
    p.stderr.on("data", (b: string) => {
      error = (error + b.toString()).slice(-2000);
      if (kind === "scan") process.stderr.write(b);
    });
    p.on("close", (code) =>
      finish(code === 0 ? undefined : Error(`Host exited ${code}: ${error}`)),
    );
    p.stdin.end(kind === "scan" ? collector : worker);
  });
}

export const runHost = (...args: Parameters<typeof runHostImpl>) =>
  runHostImpl(...args).catch((e: unknown) => {
    throw new HostError({ message: String(e) });
  });
