// The liveness check and its /livez endpoint.
import { afterAll, describe, expect, test } from "bun:test";
import { isAlive, startHealthServer } from "./health.ts";

describe("isAlive", () => {
  test("alive while every slot loop ticked within the limit", () => {
    expect(isAlive([95_000, 99_000, 90_000], 100_000, 10_000)).toBe(true);
  });

  test("dead once any slot loop has stopped ticking (D29)", () => {
    expect(isAlive([95_000, 89_999, 99_000], 100_000, 10_000)).toBe(false);
  });
});

describe("the /livez endpoint", () => {
  let alive = true;
  const server = startHealthServer(0, () => alive);
  afterAll(() => server.stop(true));
  const get = (path: string) => fetch(`http://localhost:${server.port}${path}`);

  test("answers 200 while alive and 503 when not", async () => {
    alive = true;
    expect((await get("/livez")).status).toBe(200);
    alive = false;
    expect((await get("/livez")).status).toBe(503);
  });

  test("has nothing else", async () => {
    expect((await get("/")).status).toBe(404);
  });
});
