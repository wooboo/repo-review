import { createFileRoute } from "@tanstack/react-router";
import { listRepositories } from "../server/functions";
export const Route = createFileRoute("/")({
  loader: () => listRepositories({ data: {} }),
  component: Index,
});
function Index() {
  const result = Route.useLoaderData();
  return (
    <main>
      <h1>repo-review</h1>
      <p>Repository inventory</p>
      {result.total === 0 ? (
        <p>
          No repositories yet. Configure hosts and start a scan through the API
          or MCP.
        </p>
      ) : (
        <ul>
          {result.items.map((r) => (
            <li key={r.id}>
              {r.name} — {r.clones} clones, {r.branches} branches
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
