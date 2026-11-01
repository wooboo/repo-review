import type { Settings, SettingsView } from "../domain/model";
const cache = new Map<string, { until: number; value: Promise<string> }>();
export async function resolveJevKey(
  settings: Settings,
): Promise<{ key: string; source: SettingsView["jev"]["source"] }> {
  if (settings.jev?.apiKey)
    return { key: settings.jev.apiKey, source: "settings" };
  const command = settings.jev?.apiKeyCommand;
  if (command) {
    let entry = cache.get(command);
    if (!entry || entry.until < Date.now()) {
      entry = {
        until: Date.now() + 60_000,
        value: (async () => {
          try {
            const p = Bun.spawn(["sh", "-c", command], {
              stdout: "pipe",
              stderr: "ignore",
            });
            const timer = setTimeout(() => p.kill(), 10_000);
            try {
              const output = await new Response(p.stdout).text();
              return (await p.exited) === 0 ? output.trim() : "";
            } finally {
              clearTimeout(timer);
            }
          } catch {
            return "";
          }
        })(),
      };
      cache.set(command, entry);
    }
    const key = await entry.value;
    if (key) return { key, source: "command" };
  }
  const key = process.env.TYPESAFE_API_KEY ?? "";
  return { key, source: key ? "env" : "none" };
}
export async function settingsView(settings: Settings): Promise<SettingsView> {
  const { jev, ...rest } = settings;
  const resolved = await resolveJevKey(settings);
  return {
    ...rest,
    archiveDir: settings.archiveDir ?? "~/.local/share/repo-review/archives",
    jev: {
      apiKeySet: Boolean(resolved.key),
      apiKeyCommand: jev?.apiKeyCommand,
      source: resolved.source,
    },
  };
}
