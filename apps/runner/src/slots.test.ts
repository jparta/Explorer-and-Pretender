// The slot loops (architecture 6.1, 6.2, 8, 9), against a throwaway Valkey with the
// cluster's user list, logged in as the runner's own user. The Sessions themselves are
// stand-ins that end when a test says so; session.test.ts covers what happens inside one.
// Needs Docker.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { RedisClient } from "bun";
import {
  type Ending,
  PRESENCE_KEY,
  sessionKey,
  SLOT_COUNT_KEY,
  sleepingKey,
  slotKey,
  spendKey,
  utcDate,
  watchingKey,
} from "@exhibition/shared";
import { startValkey, type TestValkey } from "@exhibition/shared/testing";
import type { Logger } from "./log.ts";
import { Slots } from "./slots.ts";
import { connectValkey, Store } from "./store.ts";
import { entries, hash } from "./valkey-test-helpers.ts";

// Every time and amount in these tests derives from these.
const START_MS = Date.parse("2026-11-17T12:00:00Z");
const TODAY = utcDate(new Date(START_MS));
const NEXT_MIDNIGHT_MS = Date.parse(`${TODAY}T00:00:00Z`) + 24 * 60 * 60 * 1000;
const SPEND_CAP = 2;
const INTERMISSION_MS = 10_000;
const PRESENCE_TIMEOUT_MS = 30_000;
const SLOT_COUNT = 3;

let valkey: TestValkey;
let client: RedisClient;

beforeAll(async () => {
  valkey = await startValkey();
  client = connectValkey(valkey.url("runner"));
}, 30_000);
afterAll(() => {
  client?.close();
  valkey?.stop();
});

let clockMs: number;
let sessions: { slot: number; id: string; signal: AbortSignal; end: (ending: Ending) => void; fail: (error: Error) => void }[];
let errors: { msg: string; fields?: Record<string, unknown> }[];
let store: Store;
let slots: Slots;

const log: Logger = {
  info: () => {},
  warn: () => {},
  error: (msg, fields) => errors.push({ msg, fields }),
};

beforeEach(async () => {
  await valkey.admin.send("FLUSHALL", []);
  clockMs = START_MS;
  sessions = [];
  errors = [];
  store = new Store(client, log);
  let ids = 0;
  slots = new Slots({
    store,
    slotCount: SLOT_COUNT,
    intermissionMs: INTERMISSION_MS,
    presenceTimeoutMs: PRESENCE_TIMEOUT_MS,
    dailySpendCapDollars: SPEND_CAP,
    now: () => clockMs,
    newSessionId: () => `s${++ids}`,
    log,
    runSession: (slot, id, signal) =>
      new Promise((resolve, reject) => {
        sessions.push({ slot, id, signal, end: resolve, fail: reject });
        signal.addEventListener("abort", () => resolve("interrupted"));
      }),
  });
});

// The web server's side: a viewer is present, a viewer has slot n in focus.
const admin = () => valkey.admin;
const setPresent = () => admin().send("SET", [PRESENCE_KEY, "1"]);
const clearPresent = () => admin().send("DEL", [PRESENCE_KEY]);
const setWatching = (slot: number) => admin().send("SET", [watchingKey(slot), "1"]);
const clearWatching = (slot: number) => admin().send("DEL", [watchingKey(slot)]);
const setSpend = (dollars: number) => admin().send("SET", [spendKey(TODAY), String(dollars)]);

const slotHash = (slot: number) => hash(admin(), slotKey(slot));
const streamOf = (sessionId: string) => entries(admin(), sessionKey(sessionId));
// Ends the n-th stand-in Session and waits until the runner has recorded the ending.
const end = async (n: number, ending: Ending) => {
  const session = sessions[n]!;
  session.end(ending);
  await slots.whenFinished(session.slot);
};

describe("starting", () => {
  beforeEach(() => slots.recover());

  test("on start-up, slots that were never used are set to idle, and the slot count is written (D58)", async () => {
    for (let slot = 0; slot < SLOT_COUNT; slot++) expect(await slotHash(slot)).toEqual({ state: "idle", sessionId: "" });
    expect(await admin().send("GET", [SLOT_COUNT_KEY])).toBe(String(SLOT_COUNT));
  });

  test("an idle slot that someone watches starts a Session; the others stay idle (S2.6)", async () => {
    await setPresent();
    await setWatching(1);
    await slots.tickAll();
    expect(sessions.map((s) => [s.slot, s.id])).toEqual([[1, "s1"]]);
    expect(await slotHash(1)).toEqual({ state: "running", sessionId: "s1" });
    expect(await slotHash(0)).toEqual({ state: "idle", sessionId: "" });
    expect(await streamOf("s1")).toEqual([{ type: "session-start", sessionId: "s1", slot: 1, kind: "terminal" }]);
  });

  test("if the slot can't be set to running, the new stream is ended and expires, rather than left behind", async () => {
    const setSlot = store.setSlot.bind(store);
    let failures = 1;
    store.setSlot = async (status) => {
      if (status.state === "running" && failures-- > 0) throw new Error("Connection closed");
      return setSlot(status);
    };
    await setPresent();
    await setWatching(0);
    await slots.tick(0);
    expect(await streamOf("s1")).toEqual([
      { type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" },
      { type: "session-end", ending: "interrupted" },
    ]);
    expect(Number(await admin().send("TTL", [sessionKey("s1")]))).toBeGreaterThan(0);
    expect(sessions).toHaveLength(0);
  });

  test("a running slot doesn't start a second Session", async () => {

    await setPresent();
    await setWatching(0);
    await slots.tickAll();
    await slots.tickAll();
    expect(sessions).toHaveLength(1);
  });
});

describe("ending", () => {
  beforeEach(async () => {
    await slots.recover();
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
  });

  test("a Session's ending is written, then the intermission starts (S2.8)", async () => {
    await end(0, "found");
    expect((await streamOf("s1")).at(-1)).toEqual({ type: "session-end", ending: "found" });
    expect(await slotHash(0)).toEqual({ state: "intermission", sessionId: "s1" });
  });

  test("after the intermission, an unwatched slot goes idle", async () => {
    await end(0, "ran-its-course");
    await clearWatching(0);
    clockMs += INTERMISSION_MS - 1;
    await slots.tickAll();
    expect((await slotHash(0)).state).toBe("intermission");
    clockMs += 1;
    await slots.tickAll();
    expect(await slotHash(0)).toEqual({ state: "idle", sessionId: "" });
  });

  test("after the intermission, a watched slot starts the next Session", async () => {
    await end(0, "ran-its-course");
    clockMs += INTERMISSION_MS;
    await slots.tickAll();
    expect(await slotHash(0)).toEqual({ state: "running", sessionId: "s2" });
  });

  test("nobody present: the Session ends as interrupted and the slot goes idle (S2.7)", async () => {
    await clearPresent();
    await slots.tickAll();
    await slots.whenFinished(0);
    expect(sessions[0]!.signal.aborted).toBe(true);
    expect((await streamOf("s1")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await slotHash(0)).toEqual({ state: "idle", sessionId: "" });
  });

  test("someone present, watching another slot: the Session continues (S2.7)", async () => {
    await clearWatching(0);
    await setWatching(2);
    await slots.tick(0);
    expect(sessions[0]!.signal.aborted).toBe(false);
  });

  test("presence that can't be checked counts as present until the timeout runs out", async () => {
    store.isPresent = async () => {
      throw new Error("Valkey unreachable");
    };
    clockMs += PRESENCE_TIMEOUT_MS;
    await slots.tickAll();
    expect(sessions[0]!.signal.aborted).toBe(false);
    clockMs += 1;
    await slots.tickAll();
    await slots.whenFinished(0);
    expect(sessions[0]!.signal.aborted).toBe(true);
  });

  test("a Session that fails, such as a write to Valkey failing, is logged with its stack and recorded as interrupted", async () => {
    sessions[0]!.fail(new Error("Connection closed"));
    await slots.whenFinished(0);
    expect((await streamOf("s1")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await slotHash(0)).toEqual({ state: "intermission", sessionId: "s1" });
    expect(errors[0]!.fields).toMatchObject({ error: "Connection closed", stack: expect.stringContaining("Error") });
  });

  test("an ending that couldn't be recorded is recorded by a later tick, so the stream still gets its end and expiry", async () => {
    const endSession = store.endSession.bind(store);
    let failures = 1;
    store.endSession = async (sessionId, ending) => {
      if (failures-- > 0) throw new Error("Connection closed");
      return endSession(sessionId, ending);
    };
    await end(0, "found");
    expect(await streamOf("s1")).toHaveLength(1);
    await slots.tick(0);
    expect((await streamOf("s1")).at(-1)).toEqual({ type: "session-end", ending: "found" });
    expect(Number(await admin().send("TTL", [sessionKey("s1")]))).toBeGreaterThan(0);
    expect(await slotHash(0)).toEqual({ state: "intermission", sessionId: "s1" });
  });

  test("an ending whose expiry couldn't be set gets it on the retry, though session-end is already there", async () => {
    const expireSession = store.expireSession.bind(store);
    let failures = 1;
    store.expireSession = async (sessionId) => {
      if (failures-- > 0) throw new Error("Connection closed");
      return expireSession(sessionId);
    };
    await end(0, "found");
    expect(Number(await admin().send("TTL", [sessionKey("s1")]))).toBe(-1);
    await slots.tick(0);
    expect(Number(await admin().send("TTL", [sessionKey("s1")]))).toBeGreaterThan(0);
    expect(await streamOf("s1")).toHaveLength(2);
  });

  test("shutting down ends running Sessions as interrupted and starts their intermission (architecture 9)", async () => {
    await slots.shutdown();
    expect((await streamOf("s1")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await slotHash(0)).toEqual({ state: "intermission", sessionId: "s1" });
  });
});

describe("spend cap and sleeping (S6.2)", () => {
  beforeEach(() => slots.recover());

  test("just below the cap, a watched slot starts a Session", async () => {
    await setSpend(SPEND_CAP - 0.01);
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
    expect(sessions).toHaveLength(1);
  });

  test("exactly at the cap, a watched idle slot sleeps instead of starting a Session", async () => {
    await setSpend(SPEND_CAP);
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
    expect(sessions).toHaveLength(0);
    for (let slot = 0; slot < SLOT_COUNT; slot++) expect(await slotHash(slot)).toEqual({ state: "sleeping", sessionId: "" });
  });

  test("a Session running when the cap is reached finishes, then its slot sleeps without an intermission", async () => {
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
    await setSpend(SPEND_CAP);
    await slots.tickAll();
    expect(sessions[0]!.signal.aborted).toBe(false);
    await end(0, "ran-its-course");
    expect(await slotHash(0)).toEqual({ state: "sleeping", sessionId: "" });
  });

  test("a Session ending as sleeping, as when the key's limit is reached, marks the day, and every slot sleeps", async () => {
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
    await end(0, "sleeping");
    expect((await streamOf("s1")).at(-1)).toEqual({ type: "session-end", ending: "sleeping" });
    expect(await admin().send("EXISTS", [sleepingKey(TODAY)])).toBe(1);
    await slots.tickAll();
    for (let slot = 0; slot < SLOT_COUNT; slot++) expect((await slotHash(slot)).state).toBe("sleeping");
  });

  test("at midnight UTC, sleeping slots wake up idle", async () => {
    await admin().send("SET", [sleepingKey(TODAY), "1"]);
    await slots.tickAll();
    expect((await slotHash(0)).state).toBe("sleeping");
    clockMs = NEXT_MIDNIGHT_MS - 1;
    await slots.tickAll();
    expect((await slotHash(0)).state).toBe("sleeping");
    clockMs = NEXT_MIDNIGHT_MS;
    await slots.tickAll();
    for (let slot = 0; slot < SLOT_COUNT; slot++) expect(await slotHash(slot)).toEqual({ state: "idle", sessionId: "" });
  });
});

describe("start-up after a crash (architecture 9)", () => {
  test("a Session left running is ended as interrupted, and its slot starts an intermission", async () => {
    await store.writeEvent("old", { type: "session-start", sessionId: "old", slot: 2, kind: "terminal" });
    await store.setSlot({ type: "slot", slot: 2, state: "running", sessionId: "old" });
    await slots.recover();
    expect((await streamOf("old")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await slotHash(2)).toEqual({ state: "intermission", sessionId: "old" });
  });

  test("a runner that died between writing session-end and moving the slot on: the Session isn't ended twice", async () => {
    await store.writeEvent("old", { type: "session-start", sessionId: "old", slot: 2, kind: "terminal" });
    await store.endSession("old", "found");
    await store.setSlot({ type: "slot", slot: 2, state: "running", sessionId: "old" });
    await slots.recover();
    expect(await streamOf("old")).toEqual([
      { type: "session-start", sessionId: "old", slot: 2, kind: "terminal" },
      { type: "session-end", ending: "found" },
    ]);
    expect(await slotHash(2)).toEqual({ state: "intermission", sessionId: "old" });
  });

  test("a slot in its intermission or asleep keeps its state", async () => {
    await store.setSlot({ type: "slot", slot: 0, state: "intermission", sessionId: "old" });
    await store.setSlot({ type: "slot", slot: 1, state: "sleeping" });
    await slots.recover();
    expect(await slotHash(0)).toEqual({ state: "intermission", sessionId: "old" });
    expect(await slotHash(1)).toEqual({ state: "sleeping", sessionId: "" });
  });

  test("after the slot count was lowered, slots beyond it end their Sessions and are removed", async () => {
    await admin().send("SET", [SLOT_COUNT_KEY, "5"]);
    await store.writeEvent("old", { type: "session-start", sessionId: "old", slot: 3, kind: "terminal" });
    await store.setSlot({ type: "slot", slot: 3, state: "running", sessionId: "old" });
    await store.setSlot({ type: "slot", slot: 4, state: "idle" });
    await slots.recover();
    expect((await streamOf("old")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await admin().send("EXISTS", [slotKey(3), slotKey(4)])).toBe(0);
    expect(await admin().send("GET", [SLOT_COUNT_KEY])).toBe(String(SLOT_COUNT));
  });
});

describe("liveness", () => {
  beforeEach(() => slots.recover());

  test("each tick records when its slot last ticked", async () => {
    expect(slots.lastTickAtMs()).toEqual([0, 0, 0]);
    await slots.tick(1);
    expect(slots.lastTickAtMs()).toEqual([0, clockMs, 0]);
  });

  test("a tick that fails with an error still counts: the loop is alive even when Valkey isn't", async () => {
    store.isWatched = async () => {
      throw new Error("Valkey unreachable");
    };
    await slots.tick(0);
    expect(slots.lastTickAtMs()[0]).toBe(clockMs);
  });
});
