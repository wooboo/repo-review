export type Change = {
  type: "scan" | "job" | "agent-run" | "inventory";
  id: string;
};
const listeners = new Set<(event: Change) => void>();
export function emitChange(event: Change) {
  for (const listener of listeners) listener(event);
}
export function eventsResponse(request: Request) {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const listener = (e: Change) => send(`data: ${JSON.stringify(e)}\n\n`);
      listeners.add(listener);
      send(": connected\n\n");
      const timer = setInterval(() => send(": heartbeat\n\n"), 15000);
      cleanup = () => {
        clearInterval(timer);
        listeners.delete(listener);
      };
      request.signal.addEventListener(
        "abort",
        () => {
          cleanup();
          controller.close();
        },
        { once: true },
      );
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
