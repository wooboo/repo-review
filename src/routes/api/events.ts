import { createFileRoute } from "@tanstack/react-router";
import { eventsResponse } from "../../server/events";
export const Route = createFileRoute("/api/events")({
  server: { handlers: { GET: ({ request }) => eventsResponse(request) } },
});
