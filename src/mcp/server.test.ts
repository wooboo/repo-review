import { test, expect } from "bun:test";
import { Effect } from "effect";
import { makeAppRuntime, Application } from "../server/application";
import { toolList, callTool } from "./server";
test("MCP lists schema-derived tools and reads through isolated application layer", async () => {
  const runtime = makeAppRuntime(":memory:");
  try {
    expect(toolList().map((t) => t.name)).toContain("list_repositories");
    expect(
      toolList().find((t) => t.name === "list_repositories")?.inputSchema,
    ).toHaveProperty("properties");
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const app = yield* Application;
        return yield* Effect.promise(() =>
          callTool(app, "list_repositories", {}),
        );
      }),
    );
    expect(result).toMatchObject({ items: [], total: 0 });
  } finally {
    await runtime.dispose();
  }
});
