// The liveness endpoint (D29): fails once any slot loop has stopped ticking.

export function isAlive(lastTickAtMs: number[], nowMs: number, maxTickAgeMs: number): boolean {
  return lastTickAtMs.every((tickAtMs) => nowMs - tickAtMs <= maxTickAgeMs);
}

export function startHealthServer(port: number, isRunnerAlive: () => boolean) {
  return Bun.serve({
    port,
    fetch(request) {
      if (new URL(request.url).pathname !== "/livez") return new Response("not found", { status: 404 });
      return isRunnerAlive() ? new Response("ok") : new Response("a slot loop has stopped", { status: 503 });
    },
  });
}
