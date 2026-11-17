import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import {
  PRESENCE_KEY,
  sessionKey,
  sleepingKey,
  SLOTS_KEY,
  slotKey,
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
  const root = new URL("../../../", import.meta.url);
  const date = utcDate(new Date("2026-11-17T12:00:00Z"));
  const session = sessionKey("9f2c");
  let containerId = "";
  let admin: RedisClient;

  beforeAll(async () => {
    // The same image as the cluster's, read from the StatefulSet.
    const statefulSet = await Bun.file(new URL("deploy/base/valkey/statefulset.yaml", root)).text();
    const image = /image:\s*(\S+)/.exec(statefulSet)?.[1];
    if (!image) throw new Error("no image in statefulset.yaml");

    containerId = docker("run", "-d", "--rm", "-p", "127.0.0.1:0:6379", image);
    const address = docker("port", containerId, "6379").split("\n")[0]!;

    // Load the users as the start-up script does (D50): drop comments, fill in passwords.
    // ACL SETUSER takes the same rules as a line of the user list. The default user
    // goes last, since this connection uses it until then.
    const lines = (await Bun.file(new URL("deploy/base/valkey/users.acl", root)).text())
      .split("\n")
      .filter((line) => line.startsWith("user "))
      .map((line) => line.replace(/\{\{\w+\}\}/g, "test-password").split(/\s+/).slice(1));
    const setup = await connect(`valkey://${address}`);
    for (const [name, ...rules] of lines.filter(([name]) => name !== "default")) {
      await setup.send("ACL", ["SETUSER", name!, ...rules]);
    }
    setup.close();
    admin = await connect(`valkey://admin:test-password@${address}`);
    for (const [, ...rules] of lines.filter(([name]) => name === "default")) {
      await admin.send("ACL", ["SETUSER", "default", ...rules]);
    }
  }, 30_000);

  afterAll(() => {
    admin?.close();
    if (containerId) docker("rm", "-f", containerId);
  });

  // ACL DRYRUN answers OK, or a message saying why the command would be refused.
  const allowed = async (user: string, command: string[]) =>
    (await admin.send("ACL", ["DRYRUN", user, ...command])) === "OK";

  // The security properties: neither writes what belongs to the other, the web server
  // can't see spend, nobody touches keys outside the contract or empties the store,
  // and the probe can only ping.
  const refused: [string, string[]][] = [
    ["runner", ["SET", PRESENCE_KEY, "1"]],
    ["runner", ["SET", watchingKey(0), "1"]],
    ["web", ["XADD", session, "*", "event", "{}"]],
    ["web", ["XADD", SLOTS_KEY, "*", "event", "{}"]],
    ["web", ["HSET", slotKey(0), "state", "idle"]],
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
    async (user, _, command) => expect(await allowed(user, command)).toBe(false),
  );
});

function docker(...args: string[]): string {
  const result = Bun.spawnSync(["docker", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(`docker ${args[0]} failed (is Docker running?): ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

// Connects once Valkey has started, retrying for up to ten seconds.
async function connect(url: string): Promise<RedisClient> {
  for (let attempt = 0; ; attempt++) {
    const client = new RedisClient(url, { autoReconnect: false });
    try {
      await client.send("PING", []);
      return client;
    } catch (error) {
      client.close();
      if (attempt >= 50) throw error;
      await Bun.sleep(200);
    }
  }
}
