import { createFileRoute } from "@tanstack/react-router";
import { handleMcp } from "../mcp/server";
export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      POST: ({ request }) => handleMcp(request),
      GET: ({ request }) => handleMcp(request),
      DELETE: ({ request }) => handleMcp(request),
    },
  },
});
