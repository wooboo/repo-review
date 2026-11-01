import { mkdir } from "node:fs/promises";
await mkdir("src/collector/generated", { recursive: true });
for (const name of ["repo-worker", "main", "worker"]) {
  const result = await Bun.build({
    entrypoints: [`src/collector/${name}.ts`],
    target: "bun",
    minify: false,
  });
  if (!result.success) throw Error(String(result.logs));
  let code = await result.outputs[0].text();
  code = code.replaceAll("import.meta.main", "true");
  await Bun.write(
    `src/collector/generated/${name}.ts`,
    `export default ${JSON.stringify(code)}\n`,
  );
}
