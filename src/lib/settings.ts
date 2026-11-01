/** Turning the redacted settings view back into an update (docs/API.md, Contract v4). */
import type { Forge, SettingsUpdate, SettingsView } from "@/lib/api/types";

type Editable = Omit<SettingsUpdate, "jev">;
export type JevUpdate = NonNullable<SettingsUpdate["jev"]>;

/**
 * The update for `view` with `patch` applied. `jev` is sent only when `jev` is given, so every
 * other save keeps the stored key and key command untouched.
 */
export function settingsUpdate(view: SettingsView, patch: Partial<Editable> = {}, jev?: JevUpdate): SettingsUpdate {
  const { jev: _redacted, ...rest } = view;
  return { ...rest, ...patch, ...(jev ? { jev } : {}) };
}

/** Where the Jev key comes from, for the status line. */
export type JevSource = SettingsView["jev"]["source"];

/** Owners list as edited: trimmed, empty rows dropped, case-insensitive duplicates removed. */
export function cleanOwners(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim().replace(/^@/, "");
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

/** A forge with its edited fields; keeps fields the form does not edit (e.g. requestReserve). */
export function editedForge(initial: Forge | null, edit: { host: string; kind: Forge["kind"]; source: "env" | "command"; token: string; owners: readonly string[] }): Forge {
  const { tokenEnv: _env, tokenCommand: _command, owners: _owners, ...kept } = initial ?? { host: "", kind: edit.kind };
  const token = edit.token.trim();
  const owners = cleanOwners(edit.owners);
  return {
    ...kept,
    host: edit.host.trim().toLowerCase(),
    kind: edit.kind,
    ...(token ? (edit.source === "env" ? { tokenEnv: token } : { tokenCommand: token }) : {}),
    ...(owners.length ? { owners } : {}),
  };
}
