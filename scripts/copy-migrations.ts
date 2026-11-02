// Cross-platform replacement for `cp -r`, so `bun run build` also works on Windows.
import { cpSync } from "node:fs";
cpSync("src/db/migrations", ".output/server/migrations", { recursive: true });
