// The slot loops (architecture 6.1, 6.2, 8, 9), against a throwaway Valkey with the
// cluster's user list, logged in as the runner's own user. The Sessions themselves are
// fakes that end when a test says so; session.test.ts covers what happens inside one.
// Needs Docker.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { RedisClient } from "bun";
import {
  type Ending,
  SLOT_STATES_KEY,
  type SlotStatesEvent,
  PRESENCE_KEY,
  sessionKey,
  sleepingKey,
  spendKey,
  utcDate,
  watchingKey,
} from "@exhibition/shared";
import { startValkey, type TestValkey } from "@exhibition/shared/testing";
import type { Logger } from "./log.ts";
import { SlotLoops } from "./slots.ts";
import { connectValkey, ValkeyStore } from "./store.ts";
import { readStreamEvents } from "./valkey-test-helpers.ts";

// Every time and amount in these tests derives from these.
const START_MS = Date.parse("2026-11-17T12:00:00Z");
const TODAY = utcDate(new Date(START_MS));
const NEXT_MIDNIGHT_MS = Date.parse(`${TODAY}T00:00:00Z`) + 24 * 60 * 60 * 1000;
const SPEND_CAP_DOLLARS = 2;
const INTERMISSION_SECONDS = 10;
const PRESENCE_TIMEOUT_SECONDS = 30;
const SLOT_COUNT = 3;
const SLOT_STATES_RETRY_PAUSE_MS = 10;

let valkey: TestValkey;
let client: RedisClient;

beforeAll(async () => {
  valkey = await startValkey();
  client = connectValkey(valkey.urlFor("runner"));
}, 30_000);
afterAll(() => {
  client?.close();
  valkey?.stop();
});

let clockMs: number;
let sessions: { slot: number; sessionId: string; signal: AbortSignal; end: (ending: Ending) => void; fail: (error: Error) => void }[];
let errors: { msg: string; fields?: Record<string, unknown> }[];
let store: ValkeyStore;
let slots: SlotLoops;

const log: Logger = {
  info: () => {},
  warn: () => {},
  error: (msg, fields) => errors.push({ msg, fields }),
};

beforeEach(async () => {
  await valkey.adminClient.send("FLUSHALL", []);
  clockMs = START_MS;
  sessions = [];
  errors = [];
  store = new ValkeyStore(client, log);
  let sessionsCreated = 0;
  slots = new SlotLoops({
    store,
    slotCount: SLOT_COUNT,
    intermissionSeconds: INTERMISSION_SECONDS,
    presenceTimeoutSeconds: PRESENCE_TIMEOUT_SECONDS,
    dailySpendCapDollars: SPEND_CAP_DOLLARS,
    slotStatesRetryPauseMs: SLOT_STATES_RETRY_PAUSE_MS,
    nowMs: () => clockMs,
    newSessionId: () => `s${++sessionsCreated}`,
    log,
    runSession: (slot, sessionId, signal) =>
      new Promise((resolve, reject) => {
        sessions.push({ slot, sessionId, signal, end: resolve, fail: reject });
        signal.addEventListener("abort", () => resolve("interrupted"));
      }),
  });
});

// The web server's side: a viewer is present, a viewer has slot n in focus.
const adminClient = () => valkey.adminClient;
const setPresent = () => adminClient().send("SET", [PRESENCE_KEY, "1"]);
const clearPresent = () => adminClient().send("DEL", [PRESENCE_KEY]);
const setWatching = (slot: number) => adminClient().send("SET", [watchingKey(slot), "1"]);
const clearWatching = (slot: number) => adminClient().send("DEL", [watchingKey(slot)]);
const setSpend = (dollars: number) => adminClient().send("SET", [spendKey(TODAY), String(dollars)]);

// Every slot's state in the slots stream, once the runner has written its latest
// changes, and one slot's from it.
const currentSlotStates = async () => {
  await slots.whenSlotStatesWritten();
  return ((await readStreamEvents(adminClient(), SLOT_STATES_KEY)).at(-1) as SlotStatesEvent | undefined)?.slots;
};
const slotState = async (slot: number) => (await currentSlotStates())?.[slot];
const streamEvents = (sessionId: string) => readStreamEvents(adminClient(), sessionKey(sessionId));
// Ends the fake Session started as number sessionIndex (from 0) and waits until the runner has recorded the ending.
const endFakeSession = async (sessionIndex: number, ending: Ending) => {
  const session = sessions[sessionIndex]!;
  session.end(ending);
  await slots.whenSessionEnded(session.slot);
};

describe("starting", () => {
  beforeEach(() => slots.resumePreviousSlotStates());

  test("on start-up, every slot's state is written, and slots that were never used are idle (D65)", async () => {
    expect(await currentSlotStates()).toEqual([{ state: "idle" }, { state: "idle" }, { state: "idle" }]);
  });

  test("two slots changing in the same tick both show in the last entry", async () => {
    await setPresent();
    await setWatching(0);
    await setWatching(2);
    await slots.tickAll();
    expect(await currentSlotStates()).toEqual([
      { state: "running", sessionId: "s1" },
      { state: "idle" },
      { state: "running", sessionId: "s2" },
    ]);
  });

  test("only one write of the slot states is under way at a time, and the last one has every change", async () => {
    const writeSlotStates = store.writeSlotStates.bind(store);
    let writesUnderWay = 0;
    let mostWritesUnderWay = 0;
    store.writeSlotStates = async (states) => {
      mostWritesUnderWay = Math.max(mostWritesUnderWay, ++writesUnderWay);
      await Bun.sleep(5);
      await writeSlotStates(states);
      writesUnderWay--;
    };
    await setPresent();
    await Promise.all([setWatching(0), setWatching(1), setWatching(2)]);
    await slots.tickAll();
    expect(mostWritesUnderWay).toBe(1);
    expect(await currentSlotStates()).toEqual([
      { state: "running", sessionId: "s1" },
      { state: "running", sessionId: "s2" },
      { state: "running", sessionId: "s3" },
    ]);
  });

  test("a write that failed is tried again after a pause, without waiting for a change", async () => {
    const writeSlotStates = store.writeSlotStates.bind(store);
    let failuresLeft = 1;
    store.writeSlotStates = async (states) => {
      if (failuresLeft-- > 0) throw new Error("Connection closed");
      return writeSlotStates(states);
    };
    await setSpend(SPEND_CAP_DOLLARS);
    await slots.tick(0);
    await slots.whenSlotStatesWritten();
    expect(await slotState(0)).toEqual({ state: "sleeping" });
  });

  test("a start whose write fails is written on the retry, and only then does its Session start", async () => {
    // The first write waits until the test fails it; the ones after it go through.
    const writeSlotStates = store.writeSlotStates.bind(store);
    let failFirstWrite = () => {};
    let writesStarted = 0;
    store.writeSlotStates = (states) => {
      if (++writesStarted > 1) return writeSlotStates(states);
      return new Promise((_, reject) => {
        failFirstWrite = () => reject(new Error("Connection closed"));
      });
    };
    await setPresent();
    await setWatching(0);
    const slot0Tick = slots.tick(0);
    while (writesStarted < 1) await Bun.sleep(1);
    await Bun.sleep(20);
    expect(sessions).toHaveLength(0); // not before the slot shows as running
    failFirstWrite();
    await slot0Tick;
    expect(sessions.map((s) => s.sessionId)).toEqual(["s1"]);
    expect(await slotState(0)).toEqual({ state: "running", sessionId: "s1" });
    expect(await streamEvents("s1")).toEqual([{ type: "session-start", sessionId: "s1", slot: 0, kind: "terminal" }]);
  });

  test("an idle slot that someone watches starts a Session; the others stay idle (S2.6)", async () => {
    await setPresent();
    await setWatching(1);
    await slots.tickAll();
    expect(sessions.map((s) => [s.slot, s.sessionId])).toEqual([[1, "s1"]]);
    expect(await slotState(1)).toEqual({ state: "running", sessionId: "s1" });
    expect(await slotState(0)).toEqual({ state: "idle" });
    expect(await streamEvents("s1")).toEqual([{ type: "session-start", sessionId: "s1", slot: 1, kind: "terminal" }]);
  });

  test("a new Session's stream expires within a day even if its ending is never written (D68)", async () => {
    await setPresent();
    await setWatching(0);
    await slots.tick(0);
    const ttlSeconds = Number(await adminClient().send("TTL", [sessionKey("s1")]));
    expect(ttlSeconds).toBeGreaterThan(60);
    expect(ttlSeconds).toBeLessThanOrEqual(24 * 60 * 60);
  });

  test("shutting down while a Session is announced: its conversation never starts, and its ending is written before shutdown resolves", async () => {
    // The write that announces the Session waits until the test lets it through.
    const writeSlotStates = store.writeSlotStates.bind(store);
    let letThrough = () => {};
    store.writeSlotStates = (states) =>
      states.some((slot) => slot.state === "running")
        ? new Promise((resolve) => {
            letThrough = () => writeSlotStates(states).then(resolve);
          })
        : writeSlotStates(states);
    await setPresent();
    await setWatching(0);
    const slot0Tick = slots.tick(0);
    while ((await streamEvents("s1")).length === 0) await Bun.sleep(1);
    await Bun.sleep(20);
    const shutdown = slots.shutdown();
    letThrough();
    await shutdown;
    expect(sessions).toHaveLength(0);
    expect((await streamEvents("s1")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    await slot0Tick;
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
    await slots.resumePreviousSlotStates();
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
  });

  test("a Session's ending is written, then the intermission starts (S2.8)", async () => {
    await endFakeSession(0, "found");
    expect((await streamEvents("s1")).at(-1)).toEqual({ type: "session-end", ending: "found" });
    expect(await slotState(0)).toEqual({ state: "intermission", sessionId: "s1" });
  });

  test("after the intermission, an unwatched slot goes idle", async () => {
    await endFakeSession(0, "ran-its-course");
    await clearWatching(0);
    clockMs += INTERMISSION_SECONDS * 1000 - 1;
    await slots.tickAll();
    expect((await slotState(0))?.state).toBe("intermission");
    clockMs += 1;
    await slots.tickAll();
    expect(await slotState(0)).toEqual({ state: "idle" });
  });

  test("after the intermission, a watched slot starts the next Session", async () => {
    await endFakeSession(0, "ran-its-course");
    clockMs += INTERMISSION_SECONDS * 1000;
    await slots.tickAll();
    expect(await slotState(0)).toEqual({ state: "running", sessionId: "s2" });
  });

  test("nobody present: the Session ends as interrupted and the slot goes idle (S2.7)", async () => {
    await clearPresent();
    await slots.tickAll();
    await slots.whenSessionEnded(0);
    expect(sessions[0]!.signal.aborted).toBe(true);
    expect((await streamEvents("s1")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await slotState(0)).toEqual({ state: "idle" });
  });

  test("nobody present stops the Session even while the slot states can't be written", async () => {
    store.writeSlotStates = async () => {
      throw new Error("NOPERM");
    };
    await setSpend(SPEND_CAP_DOLLARS);
    await slots.tick(1); // slot 1 goes to sleep, and that change can't be written
    await clearPresent();
    await slots.tick(0);
    expect(sessions[0]!.signal.aborted).toBe(true);
    store.writeSlotStates = ValkeyStore.prototype.writeSlotStates;
    await slots.whenSlotStatesWritten();
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
    clockMs += PRESENCE_TIMEOUT_SECONDS * 1000;
    await slots.tickAll();
    expect(sessions[0]!.signal.aborted).toBe(false);
    clockMs += 1;
    await slots.tickAll();
    await slots.whenSessionEnded(0);
    expect(sessions[0]!.signal.aborted).toBe(true);
  });

  test("a Session that fails, such as a write to Valkey failing, is logged with its stack and recorded as interrupted", async () => {
    sessions[0]!.fail(new Error("Connection closed"));
    await slots.whenSessionEnded(0);
    expect((await streamEvents("s1")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await slotState(0)).toEqual({ state: "intermission", sessionId: "s1" });
    expect(errors[0]!.fields).toMatchObject({ error: "Connection closed", stack: expect.stringContaining("Error") });
  });

  test("an ending that couldn't be recorded is recorded by a later tick, so the stream still gets its end and expiry", async () => {
    const endSession = store.endSession.bind(store);
    let failuresLeft = 1;
    store.endSession = async (sessionId, ending) => {
      if (failuresLeft-- > 0) throw new Error("Connection closed");
      return endSession(sessionId, ending);
    };
    await endFakeSession(0, "found");
    expect(await streamEvents("s1")).toHaveLength(1);
    await slots.tick(0);
    expect((await streamEvents("s1")).at(-1)).toEqual({ type: "session-end", ending: "found" });
    expect(Number(await adminClient().send("TTL", [sessionKey("s1")]))).toBeGreaterThan(0);
    expect(await slotState(0)).toEqual({ state: "intermission", sessionId: "s1" });
  });

  test("an ending whose expiry couldn't be set gets it on the retry, though session-end is already there", async () => {
    const expireSession = store.expireSession.bind(store);
    let failuresLeft = 1;
    store.expireSession = async (sessionId) => {
      if (failuresLeft-- > 0) throw new Error("Connection closed");
      return expireSession(sessionId);
    };
    const ttlSeconds = async () => Number(await adminClient().send("TTL", [sessionKey("s1")]));
    await endFakeSession(0, "found");
    expect(await ttlSeconds()).toBeGreaterThan(60); // still the day from the start (D68)
    await slots.tick(0);
    expect(await ttlSeconds()).toBeGreaterThan(0);
    expect(await ttlSeconds()).toBeLessThanOrEqual(60);
    expect(await streamEvents("s1")).toHaveLength(2);
  });

  test("shutting down ends running Sessions as interrupted and starts their intermission (architecture 9)", async () => {
    await slots.shutdown();
    expect((await streamEvents("s1")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await slotState(0)).toEqual({ state: "intermission", sessionId: "s1" });
  });
});

describe("spend cap and sleeping (S6.2)", () => {
  beforeEach(() => slots.resumePreviousSlotStates());

  test("just below the cap, a watched slot starts a Session", async () => {
    await setSpend(SPEND_CAP_DOLLARS - 0.01);
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
    expect(sessions).toHaveLength(1);
  });

  test("exactly at the cap, a watched idle slot sleeps instead of starting a Session", async () => {
    await setSpend(SPEND_CAP_DOLLARS);
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
    expect(sessions).toHaveLength(0);
    for (let slot = 0; slot < SLOT_COUNT; slot++) expect(await slotState(slot)).toEqual({ state: "sleeping" });
  });

  test("a Session running when the cap is reached finishes, then its slot sleeps without an intermission", async () => {
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
    await setSpend(SPEND_CAP_DOLLARS);
    await slots.tickAll();
    expect(sessions[0]!.signal.aborted).toBe(false);
    await endFakeSession(0, "ran-its-course");
    expect(await slotState(0)).toEqual({ state: "sleeping" });
  });

  test("a Session ending as sleeping, as when the key's limit is reached, marks the day, and every slot sleeps", async () => {
    await setPresent();
    await setWatching(0);
    await slots.tickAll();
    await endFakeSession(0, "sleeping");
    expect((await streamEvents("s1")).at(-1)).toEqual({ type: "session-end", ending: "sleeping" });
    expect(await adminClient().send("EXISTS", [sleepingKey(TODAY)])).toBe(1);
    await slots.tickAll();
    for (let slot = 0; slot < SLOT_COUNT; slot++) expect((await slotState(slot))?.state).toBe("sleeping");
  });

  test("at midnight UTC, sleeping slots wake up idle", async () => {
    await adminClient().send("SET", [sleepingKey(TODAY), "1"]);
    await slots.tickAll();
    expect((await slotState(0))?.state).toBe("sleeping");
    clockMs = NEXT_MIDNIGHT_MS - 1;
    await slots.tickAll();
    expect((await slotState(0))?.state).toBe("sleeping");
    clockMs = NEXT_MIDNIGHT_MS;
    await slots.tickAll();
    for (let slot = 0; slot < SLOT_COUNT; slot++) expect(await slotState(slot)).toEqual({ state: "idle" });
  });
});

describe("start-up after a crash (architecture 9)", () => {
  test("a Session left running is ended as interrupted, and its slot starts an intermission", async () => {
    await store.writeEvent("old", { type: "session-start", sessionId: "old", slot: 2, kind: "terminal" });
    await store.writeSlotStates([{ state: "idle" }, { state: "idle" }, { state: "running", sessionId: "old" }]);
    await slots.resumePreviousSlotStates();
    expect((await streamEvents("old")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await slotState(2)).toEqual({ state: "intermission", sessionId: "old" });
  });

  test("a runner that died between writing session-end and moving the slot on: the Session isn't ended twice", async () => {
    await store.writeEvent("old", { type: "session-start", sessionId: "old", slot: 2, kind: "terminal" });
    await store.endSession("old", "found");
    await store.writeSlotStates([{ state: "idle" }, { state: "idle" }, { state: "running", sessionId: "old" }]);
    await slots.resumePreviousSlotStates();
    expect(await streamEvents("old")).toEqual([
      { type: "session-start", sessionId: "old", slot: 2, kind: "terminal" },
      { type: "session-end", ending: "found" },
    ]);
    expect(await slotState(2)).toEqual({ state: "intermission", sessionId: "old" });
  });

  test("a slot in its intermission or asleep keeps its state", async () => {
    await store.writeSlotStates([{ state: "intermission", sessionId: "old" }, { state: "sleeping" }, { state: "idle" }]);
    await slots.resumePreviousSlotStates();
    expect(await slotState(0)).toEqual({ state: "intermission", sessionId: "old" });
    expect(await slotState(1)).toEqual({ state: "sleeping" });
  });

  test("after the slot count was lowered, Sessions in slots beyond it are ended, and the list is shorter", async () => {
    await store.writeEvent("old", { type: "session-start", sessionId: "old", slot: 3, kind: "terminal" });
    const idle = { state: "idle" } as const;
    await store.writeSlotStates([idle, idle, idle, { state: "running", sessionId: "old" }, idle]);
    await slots.resumePreviousSlotStates();
    expect((await streamEvents("old")).at(-1)).toEqual({ type: "session-end", ending: "interrupted" });
    expect(await currentSlotStates()).toEqual([idle, idle, idle]);
  });

  test("after the slot count was raised, the new slots start idle", async () => {
    await store.writeSlotStates([{ state: "sleeping" }]);
    await slots.resumePreviousSlotStates();
    expect(await currentSlotStates()).toEqual([{ state: "sleeping" }, { state: "idle" }, { state: "idle" }]);
  });
});

describe("liveness", () => {
  beforeEach(() => slots.resumePreviousSlotStates());

  test("right after start-up, every slot counts as having just ticked, so a slow first tick doesn't fail liveness", async () => {
    clockMs = START_MS + 60_000;
    await slots.resumePreviousSlotStates();
    expect(slots.lastTickAtMs()).toEqual([clockMs, clockMs, clockMs]);
  });

  test("each tick records when its slot last ticked", async () => {
    clockMs += 1_000;
    await slots.tick(1);
    expect(slots.lastTickAtMs()).toEqual([START_MS, clockMs, START_MS]);
  });

  test("a tick that fails with an error still counts: the loop is alive even when Valkey isn't", async () => {
    store.isWatched = async () => {
      throw new Error("Valkey unreachable");
    };
    await slots.tick(0);
    expect(slots.lastTickAtMs()[0]).toBe(clockMs);
  });
});
