// The runner's Valkey operations, against a throwaway Valkey with the cluster's user list,
// logged in as the runner's own user: a permission it lacks fails here (D46). Needs Docker.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { RedisClient } from "bun";
import {
  DAILY_KEY_EXPIRE_SECONDS,
  PRESENCE_KEY,
  SESSION_EXPIRE_SECONDS,
  sessionKey,
  SLOT_COUNT_KEY,
  SLOTS_KEY,
  slotKey,
  spendKey,
  sleepingKey,
  watchingKey,
} from "@exhibition/shared";
import { startValkey, type TestValkey } from "@exhibition/shared/testing";
import type { Logger } from "./log.ts";
import { connectValkey, Store } from "./store.ts";
import { entries, hash } from "./valkey-test-helpers.ts";

let valkey: TestValkey;
let client: RedisClient;
let store: Store;
let warnings: string[];
const log: Logger = {
  info: () => {},
  warn: (msg) => warnings.push(msg),
  error: () => {},
};

beforeAll(async () => {
  valkey = await startValkey();
  client = connectValkey(valkey.url("runner"));
  store = new Store(client, log);
}, 30_000);
afterAll(() => {
  client?.close();
  valkey?.stop();
});
beforeEach(async () => {
  warnings = [];
  await valkey.admin.send("FLUSHALL", []);
});

const date = "2026-11-17";

describe("Session streams", () => {
  test("appends each event as one JSON field", async () => {
    await store.writeEvent("s1", { type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" });
    await store.writeEvent("s1", { type: "message", role: "explorer", text: "ls" });
    expect(await entries(valkey.admin, sessionKey("s1"))).toEqual([
      { type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" },
      { type: "message", role: "explorer", text: "ls" },
    ]);
  });

  test("ending a Session writes session-end and lets the stream expire a minute later (D19)", async () => {
    await store.writeEvent("s1", { type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" });
    await store.endSession("s1", "found");
    expect((await entries(valkey.admin, sessionKey("s1"))).at(-1)).toEqual({ type: "session-end", ending: "found" });
    const ttl = Number(await valkey.admin.send("TTL", [sessionKey("s1")]));
    expect(ttl).toBeGreaterThan(SESSION_EXPIRE_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(SESSION_EXPIRE_SECONDS);
  });

  test("reads a stream's last event, or nothing for a stream that doesn't exist", async () => {
    expect(await store.lastEvent("s1")).toBeUndefined();
    await store.writeEvent("s1", { type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" });
    await store.writeEvent("s1", { type: "message", role: "explorer", text: "ls" });
    expect(await store.lastEvent("s1")).toEqual({ type: "message", role: "explorer", text: "ls" });
  });

  test("a last event that can't be read counts as nothing, with a warning", async () => {
    await valkey.admin.send("XADD", [sessionKey("s1"), "*", "event", '{"type":"unknown"}']);
    expect(await store.lastEvent("s1")).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});

describe("slot state", () => {
  test("is written to slot:{n} and announced on the slots stream", async () => {
    await store.setSlot({ type: "slot", slot: 1, state: "running", sessionId: "s1" });
    expect(await hash(valkey.admin, slotKey(1))).toEqual({ state: "running", sessionId: "s1" });
    expect(await entries(valkey.admin, SLOTS_KEY)).toEqual([
      { type: "slot", slot: 1, state: "running", sessionId: "s1" },
    ]);
    expect(await store.readSlot(1)).toEqual({ type: "slot", slot: 1, state: "running", sessionId: "s1" });
  });

  test("a state without a Session empties the Session ID in the same write", async () => {
    await store.setSlot({ type: "slot", slot: 0, state: "intermission", sessionId: "s1" });
    await store.setSlot({ type: "slot", slot: 0, state: "idle" });
    expect(await hash(valkey.admin, slotKey(0))).toEqual({ state: "idle", sessionId: "" });
    expect(await store.readSlot(0)).toEqual({ type: "slot", slot: 0, state: "idle" });
  });

  test("a slot never written reads as nothing", async () => {
    expect(await store.readSlot(2)).toBeUndefined();
  });

  test("a slot with an unknown state reads as nothing, with a warning", async () => {
    await valkey.admin.send("HSET", [slotKey(2), "state", "dancing"]);
    expect(await store.readSlot(2)).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  test("a slot's hash can be deleted", async () => {
    await store.setSlot({ type: "slot", slot: 4, state: "idle" });
    await store.deleteSlot(4);
    expect(await valkey.admin.send("EXISTS", [slotKey(4)])).toBe(0);
  });
});

describe("slot count (D58)", () => {
  test("is written for the web server, and read back", async () => {
    expect(await store.readSlotCount()).toBeUndefined();
    await store.writeSlotCount(3);
    expect(await valkey.admin.send("GET", [SLOT_COUNT_KEY])).toBe("3");
    expect(await store.readSlotCount()).toBe(3);
  });
});

describe("viewers, written by the web server", () => {
  test("presence and watching are read from their keys", async () => {
    expect(await store.isPresent()).toBe(false);
    expect(await store.isWatched(1)).toBe(false);
    await valkey.admin.send("SET", [PRESENCE_KEY, "1"]);
    await valkey.admin.send("SET", [watchingKey(1), "1"]);
    expect(await store.isPresent()).toBe(true);
    expect(await store.isWatched(1)).toBe(true);
    expect(await store.isWatched(0)).toBe(false);
  });
});

describe("spend and sleeping", () => {
  test("a day without spend counts as 0", async () => {
    expect(await store.spend(date)).toBe(0);
  });

  test("adds up each call's cost and keeps the day's key for two days", async () => {
    expect(await store.addSpend(date, 0.25)).toBeCloseTo(0.25);
    expect(await store.addSpend(date, 0.5)).toBeCloseTo(0.75);
    expect(await store.spend(date)).toBeCloseTo(0.75);
    const ttl = Number(await valkey.admin.send("TTL", [spendKey(date)]));
    expect(ttl).toBeGreaterThan(DAILY_KEY_EXPIRE_SECONDS - 5);
  });

  test("sleeping is set for the day and kept for two days", async () => {
    expect(await store.isSleeping(date)).toBe(false);
    await store.setSleeping(date);
    expect(await store.isSleeping(date)).toBe(true);
    expect(await store.isSleeping("2026-11-18")).toBe(false);
    const ttl = Number(await valkey.admin.send("TTL", [sleepingKey(date)]));
    expect(ttl).toBeGreaterThan(DAILY_KEY_EXPIRE_SECONDS - 5);
  });
});

describe("start-up", () => {
  test("ping answers once Valkey is reachable", async () => {
    await store.ping();
  });
});
