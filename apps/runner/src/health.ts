// The liveness endpoint (D29): fails once any slot loop has stopped ticking.

export function isAlive(lastTickAtMs: number[], nowMs: number, staleMs: number): boolean {
  return lastTickAtMs.every((tickAtMs) => nowMs - tickAtMs <= staleMs);
}

export function startHealthServer(port: number, alive: () => boolean) {
  return Bun.serve({
    port,
    fetch(request) {
      if (new URL(request.url).pathname !== "/livez") return new Response("not found", { status: 404 });
      return alive() ? new Response("ok") : new Response("a slot loop has stopped", { status: 503 });
    },
  });
}
