/** Unified diff → files with numbered lines, for the phone-friendly diff viewer. */
export type DiffLine = { kind: "add" | "del" | "ctx" | "hunk" | "meta"; text: string; old: number | null; new: number | null };
export type DiffFile = { path: string; oldPath: string; lines: DiffLine[]; additions: number; deletions: number; binary: boolean };

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
    if (header) {
      file = { oldPath: header[1], path: header[2], lines: [], additions: 0, deletions: 0, binary: false };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      file.lines.push({ kind: "hunk", text: raw, old: null, new: null });
      continue;
    }
    if (!inHunk) {
      if (raw.startsWith("Binary files")) file.binary = true;
      continue;
    }
    if (raw.startsWith("+")) {
      file.lines.push({ kind: "add", text: raw.slice(1), old: null, new: newNo++ });
      file.additions++;
    } else if (raw.startsWith("-")) {
      file.lines.push({ kind: "del", text: raw.slice(1), old: oldNo++, new: null });
      file.deletions++;
    } else if (raw.startsWith("\\")) {
      file.lines.push({ kind: "meta", text: raw, old: null, new: null });
    } else if (raw.startsWith(" ") || raw === "") {
      if (raw === "" && oldNo === 0 && newNo === 0) continue;
      file.lines.push({ kind: "ctx", text: raw.slice(1), old: oldNo++, new: newNo++ });
    }
  }
  // A trailing empty context line comes from the final newline of the diff text.
  for (const f of files) {
    const last = f.lines.at(-1);
    if (last?.kind === "ctx" && last.text === "") f.lines.pop();
  }
  return files;
}
