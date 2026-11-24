// The runner's Valkey operations, against a throwaway Valkey with the cluster's user list,
// logged in as the runner's own user: a permission it lacks fails here (D46). Needs Docker.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { RedisClient } from "bun";
import {
  DAILY_KEY_EXPIRE_SECONDS,
  PRESENCE_KEY,
  SESSION_EXPIRE_SECONDS,
  sessionKey,
  SLOT_STATES_KEY,
  spendKey,
  sleepingKey,
  watchingKey,
} from "@exhibition/shared";
import { startValkey, type TestValkey } from "@exhibition/shared/testing";
import type { Logger } from "./log.ts";
import { connectValkey, ValkeyStore } from "./store.ts";
import { readStreamEvents } from "./valkey-test-helpers.ts";

let valkey: TestValkey;
let client: RedisClient;
let store: ValkeyStore;
let warnings: string[];
const log: Logger = {
  info: () => {},
  warn: (msg) => warnings.push(msg),
  error: () => {},
};

beforeAll(async () => {
  valkey = await startValkey();
  client = connectValkey(valkey.urlFor("runner"));
  store = new ValkeyStore(client, log);
}, 30_000);
afterAll(() => {
  client?.close();
  valkey?.stop();
});
beforeEach(async () => {
  warnings = [];
  await valkey.adminClient.send("FLUSHALL", []);
});

const date = "2026-11-17";

describe("Session streams", () => {
  test("appends each event as one JSON field", async () => {
    await store.writeEvent("s1", { type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" });
    await store.writeEvent("s1", { type: "message", role: "explorer", text: "ls" });
    expect(await readStreamEvents(valkey.adminClient, sessionKey("s1"))).toEqual([
      { type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" },
      { type: "message", role: "explorer", text: "ls" },
    ]);
  });

  test("ending a Session writes session-end and lets the stream expire a minute later (D19)", async () => {
    await store.writeEvent("s1", { type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" });
    await store.endSession("s1", "found");
    expect((await readStreamEvents(valkey.adminClient, sessionKey("s1"))).at(-1)).toEqual({ type: "session-end", ending: "found" });
    const ttl = Number(await valkey.adminClient.send("TTL", [sessionKey("s1")]));
    expect(ttl).toBeGreaterThan(SESSION_EXPIRE_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(SESSION_EXPIRE_SECONDS);
  });

  test("reads a stream's last event, or nothing for a stream that doesn't exist", async () => {
    expect(await store.readLastEvent("s1")).toBeUndefined();
    await store.writeEvent("s1", { type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" });
    await store.writeEvent("s1", { type: "message", role: "explorer", text: "ls" });
    expect(await store.readLastEvent("s1")).toEqual({ type: "message", role: "explorer", text: "ls" });
  });

  test("a last event that can't be read counts as nothing, with a warning", async () => {
    await valkey.adminClient.send("XADD", [sessionKey("s1"), "*", "event", '{"type":"unknown"}']);
    expect(await store.readLastEvent("s1")).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe("every slot's state (D65)", () => {
  test("is written as one event on the slots stream, and the last one is read back", async () => {
    await store.writeSlotStates([{ state: "idle" }, { state: "running", sessionId: "s1" }]);
    await store.writeSlotStates([{ state: "idle" }, { state: "intermission", sessionId: "s1" }]);
    expect(await readStreamEvents(valkey.adminClient, SLOT_STATES_KEY)).toEqual([
      { type: "slots", slots: [{ state: "idle" }, { state: "running", sessionId: "s1" }] },
      { type: "slots", slots: [{ state: "idle" }, { state: "intermission", sessionId: "s1" }] },
    ]);
    expect(await store.readSlotStates()).toEqual([{ state: "idle" }, { state: "intermission", sessionId: "s1" }]);
  });

  test("nothing written yet reads as nothing", async () => {
    expect(await store.readSlotStates()).toBeUndefined();
  });

  test("a last entry that can't be read counts as nothing, with a warning", async () => {
    await valkey.adminClient.send("XADD", [SLOT_STATES_KEY, "*", "event", '{"type":"slots","slots":[{"state":"dancing"}]}']);
    expect(await store.readSlotStates()).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe("viewers, written by the web server", () => {
  test("presence and watching are read from their keys", async () => {
    expect(await store.isPresent()).toBe(false);
    expect(await store.isWatched(1)).toBe(false);
    await valkey.adminClient.send("SET", [PRESENCE_KEY, "1"]);
    await valkey.adminClient.send("SET", [watchingKey(1), "1"]);
    expect(await store.isPresent()).toBe(true);
    expect(await store.isWatched(1)).toBe(true);
    expect(await store.isWatched(0)).toBe(false);
  });
});

describe("spend and sleeping", () => {
  test("a day without spend counts as 0", async () => {
    expect(await store.readSpendDollars(date)).toBe(0);
  });

  test("adds up each call's cost and keeps the day's key for two days", async () => {
    expect(await store.addSpend(date, 0.25)).toBeCloseTo(0.25);
    expect(await store.addSpend(date, 0.5)).toBeCloseTo(0.75);
    expect(await store.readSpendDollars(date)).toBeCloseTo(0.75);
    const ttl = Number(await valkey.adminClient.send("TTL", [spendKey(date)]));
    expect(ttl).toBeGreaterThan(DAILY_KEY_EXPIRE_SECONDS - 5);
  });

  test("sleeping is set for the day and kept for two days", async () => {
    expect(await store.isSleeping(date)).toBe(false);
    await store.setSleeping(date);
    expect(await store.isSleeping(date)).toBe(true);
    expect(await store.isSleeping("2026-11-18")).toBe(false);
    const ttl = Number(await valkey.adminClient.send("TTL", [sleepingKey(date)]));
    expect(ttl).toBeGreaterThan(DAILY_KEY_EXPIRE_SECONDS - 5);
  });
});

describe("start-up", () => {
  test("ping answers once Valkey is reachable", async () => {
    await store.ping();
  });
});
