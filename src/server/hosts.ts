import { spawn } from "node:child_process";
import type { Host } from "../domain/model";
import collector from "../collector/generated/main";
import worker from "../collector/generated/worker";
const shell = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
export async function runHost(
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
    });
    let buffer = "",
      error = "",
      settled = false;
    const finish = (e?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      e ? reject(e) : resolve();
    };
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      finish(Error("Host runner timed out"));
    }, timeoutMs);
    p.on("error", finish);
    p.stdin.on("error", () => {});
    p.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        if (line)
          try {
            onEvent(JSON.parse(line));
          } catch (e) {
            p.kill();
            finish(Error("Invalid host protocol: " + String(e)));
          }
      }
    });
    p.stderr.on("data", (b: Buffer) => {
      error = (error + b.toString()).slice(-2000);
    });
    p.on("close", (code) =>
      finish(code === 0 ? undefined : Error(`Host exited ${code}: ${error}`)),
    );
    p.stdin.end(kind === "scan" ? collector : worker);
  });
}
