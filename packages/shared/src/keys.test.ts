import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { RedisClient } from "bun";
import { startValkey, type TestValkey } from "./testing.ts";
import {
  PRESENCE_KEY,
  sessionKey,
  sleepingKey,
  SLOT_STATES_KEY,
  spendKey,
  utcDate,
  watchingKey,
} from "./keys.ts";

describe("utcDate", () => {
  test("uses the UTC date, not the local one", () => {
    expect(utcDate(new Date("2026-11-16T23:59:59Z"))).toBe("2026-11-16");
    expect(utcDate(new Date("2026-11-17T00:00:00Z"))).toBe("2026-11-17");
    // 01:30 in Helsinki is still the previous day in UTC.
    expect(utcDate(new Date("2026-11-17T01:30:00+02:00"))).toBe("2026-11-16");
  });
});

// Valkey's user list (D46) must refuse what no component should do with the keys built
// above. Valkey itself answers, through ACL DRYRUN, so key patterns, command lists and
// rule order count exactly as they do in the cluster. That each component may do what it
// needs is shown by the runner's and web server's own tests, against a real Valkey.
// Needs Docker: it starts a throwaway Valkey container (shared component doc, section 3).
describe("Valkey's user list", () => {
  const date = utcDate(new Date("2026-11-17T12:00:00Z"));
  const sessionStreamKey = sessionKey("9f2c");
  let valkey: TestValkey;
  let adminClient: RedisClient;

  beforeAll(async () => {
    valkey = await startValkey();
    adminClient = valkey.adminClient;
  }, 30_000);

  afterAll(() => valkey?.stop());

  // ACL DRYRUN answers OK, or a message saying why the command would be refused.
  const isAllowed = async (user: string, command: string[]) =>
    (await adminClient.send("ACL", ["DRYRUN", user, ...command])) === "OK";

  // The security properties: neither writes what belongs to the other, the web server
  // can't see spend, nobody touches keys outside the contract or empties the store,
  // and the probe can only ping.
  const refused: [string, string[]][] = [
    ["runner", ["SET", PRESENCE_KEY, "1"]],
    ["runner", ["SET", watchingKey(0), "1"]],
    ["runner", ["DEL", spendKey(date)]],
    ["runner", ["DEL", sessionKey("9f2c")]],

    ["web", ["XADD", sessionStreamKey, "*", "event", "{}"]],
    ["web", ["XADD", SLOT_STATES_KEY, "*", "event", "{}"]],
    ["web", ["GET", spendKey(date)]],
    ["web", ["SET", sleepingKey(date), "1"]],
    ["runner", ["GET", "unrelated"]],
    ["web", ["GET", "unrelated"]],
    ["probe", ["GET", PRESENCE_KEY]],
    ["runner", ["FLUSHALL"]],
    ["web", ["FLUSHALL"]],
  ];

  test.each(refused.map(([user, command]) => [user, command.join(" "), command] as const))(
    "%s may not %s",
    async (user, _, command) => expect(await isAllowed(user, command)).toBe(false),
  );
});
