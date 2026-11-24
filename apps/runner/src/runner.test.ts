// The happy path, end to end: a watched slot starts a Session that runs through the real
// slot loop, conversation, model calls and Valkey operations, with the real prompts and
// word lists, until the Explorer finds the Codeword. Only the provider is a fake,
// served from this test process. Checks only what crosses the runner's boundaries: what
// it sends the provider, and what it leaves in Valkey. Needs Docker.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { RedisClient } from "bun";
import { PRESENCE_KEY, SLOT_STATES_KEY, type SlotStatesEvent, sessionKey, spendKey, utcDate, watchingKey } from "@exhibition/shared";
import { startValkey, type TestValkey } from "@exhibition/shared/testing";
import { loadWordLists } from "./codeword.ts";
import { loadRunnerConfig } from "./config.ts";
import { createModelClient } from "./llm.ts";
import { abortableSleep, createSessionRunner, loadPrompts } from "./runner.ts";
import { SlotLoops } from "./slots.ts";
import { connectValkey, ValkeyStore } from "./store.ts";
import { readStreamEvents } from "./valkey-test-helpers.ts";

const COST_PER_CALL_DOLLARS = 0.01;

// The fake provider plays both models. The Pretender answers with the Codeword,
// taken from the one backtick-quoted word in its system prompt; the Explorer lists
// files first, then repeats what the Pretender said.
const requests: { authorization: string | null; model: string; messages: { role: string; content: string }[] }[] = [];
const provider = Bun.serve({
  port: 0,
  async fetch(request) {
    const body = (await request.json()) as { model: string; messages: { role: string; content: string }[] };
    requests.push({ authorization: request.headers.get("authorization"), ...body });
    const messages: { role: string; content: string }[] = body.messages;
    const text =
      body.model === "test/pretender"
        ? /`([^`]+)`/.exec(messages[0]!.content)![1]!
        : messages.length === 1
          ? "ls"
          : `I found it: ${messages.at(-1)!.content}`;
    return Response.json({
      id: "gen",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
      usage: { cost: COST_PER_CALL_DOLLARS },
    });
  },
});

let valkey: TestValkey;
let client: RedisClient;

beforeAll(async () => {
  valkey = await startValkey();
  client = connectValkey(valkey.urlFor("runner"));
}, 30_000);
afterAll(() => {
  client?.close();
  valkey?.stop();
  provider.stop(true);
});

test("a watched slot runs a Session until the Explorer finds the Codeword", async () => {
  const config = loadRunnerConfig({
    EXPLORER_MODEL: "test/explorer",
    PRETENDER_MODEL: "test/pretender",
    LLM_BASE_URL: `http://localhost:${provider.port}/v1`,
    // Fast enough that pacing takes no noticeable time.
    REVEAL_RATE_EXPLORER_CHARS_PER_SECOND: "1000000",
    REVEAL_RATE_PRETENDER_CHARS_PER_SECOND: "1000000",
  });
  const store = new ValkeyStore(client);
  const slots = new SlotLoops({
    store,
    slotCount: config.slotCount,
    intermissionMs: config.intermissionSeconds * 1000,
    presenceTimeoutMs: config.sharedSettings.presenceTimeoutSeconds * 1000,
    dailySpendCapDollars: config.dailySpendCapDollars,
    slotStatesRetryPauseMs: 100,
    nowMs: Date.now,
    runSession: createSessionRunner({
      config,
      modelClient: createModelClient({ baseUrl: config.llmBaseUrl, apiKey: "sk-test", timeoutMs: 5_000 }),
      store,
      prompts: await loadPrompts(),
      words: await loadWordLists("terminal"),
    }),
  });

  await slots.resumePreviousSlotStates();
  await valkey.adminClient.send("SET", [PRESENCE_KEY, "1"]);
  await valkey.adminClient.send("SET", [watchingKey(0), "1"]);
  await slots.tickAll();
  await slots.whenSessionEnded(0);

  // Valkey holds the whole Session, and the found message carries the Codeword.
  const slotStates = async () =>
    ((await readStreamEvents(valkey.adminClient, SLOT_STATES_KEY)).at(-1) as SlotStatesEvent).slots;
  const sessionId = (await slotStates())[0]!.sessionId!;
  const events = await readStreamEvents(valkey.adminClient, sessionKey(sessionId));
  const codeword = (events[2] as { text: string }).text;
  expect(codeword).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  expect(events).toEqual([
    { type: "session-start", sessionId, slot: 0, kind: "terminal" },
    { type: "message", role: "explorer", text: "ls" },
    { type: "message", role: "pretender", text: codeword },
    { type: "message", role: "explorer", text: `I found it: ${codeword}`, codeword },
    { type: "session-end", ending: "found" },
  ]);
  expect((await slotStates())[0]).toEqual({ state: "intermission", sessionId });
  expect(Number(await valkey.adminClient.send("GET", [spendKey(utcDate())]))).toBeCloseTo(3 * COST_PER_CALL_DOLLARS);

  // The provider got each role's own model, with the API key.
  expect(requests.map((r) => r.model)).toEqual(["test/explorer", "test/pretender", "test/explorer"]);
  expect(requests.every((r) => r.authorization === "Bearer sk-test")).toBe(true);
});

describe("abortableSleep", () => {
  test("waits the given time", async () => {
    const startedAtMs = performance.now();
    await abortableSleep(30, new AbortController().signal);
    expect(performance.now() - startedAtMs).toBeGreaterThanOrEqual(25);
  });

  test("a stop cuts it short", async () => {
    const stop = new AbortController();
    const startedAtMs = performance.now();
    const sleepPromise = abortableSleep(5_000, stop.signal);
    stop.abort();
    await expect(sleepPromise).rejects.toBeDefined();
    expect(performance.now() - startedAtMs).toBeLessThan(1_000);
  });

  test("an earlier stop rejects at once", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(abortableSleep(5_000, stop.signal)).rejects.toBeDefined();
  });
});
