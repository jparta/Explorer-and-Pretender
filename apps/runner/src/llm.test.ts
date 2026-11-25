// Model calls against a fake provider served from this test process: requests, cost,
// cut-off messages, OpenRouter's limit refusals, failures, timeouts and stopping.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { callModel, createModelClient } from "./llm.ts";
import type { Logger } from "./log.ts";

// A fake for the provider: answers each request with the response a test sets.
let requests: { headers: Headers; body: Record<string, unknown> }[] = [];
let respond: () => Response | Promise<Response> = () => new Response("not set", { status: 500 });
const provider = Bun.serve({
  port: 0,
  async fetch(request) {
    requests.push({ headers: request.headers, body: (await request.json()) as Record<string, unknown> });
    return respond();
  },
});
afterAll(() => provider.stop(true));
let warnings: { msg: string; fields?: Record<string, unknown> }[] = [];
const log: Logger = { info: () => {}, warn: (msg, fields) => warnings.push({ msg, fields }), error: () => {} };
beforeEach(() => {
  requests = [];
  warnings = [];
});

const makeClient = (timeoutMs = 2_000) =>
  createModelClient({ baseUrl: `http://localhost:${provider.port}/api/v1`, apiKey: "sk-test", timeoutMs });

const call = (options: { timeoutMs?: number; signal?: AbortSignal } = {}) =>
  callModel({
    client: makeClient(options.timeoutMs),
    model: "vendor/model",
    maxTokens: 200,
    reasoningEffort: "low",
    messages: [{ role: "user", content: "hello" }],
    signal: options.signal ?? new AbortController().signal,
    log,
  });

const answer = (content: string | null, finishReason = "stop", usage: object = { cost: 0.0012 }) =>
  Response.json({
    id: "gen-1",
    object: "chat.completion",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: finishReason }],
    usage,
  });

const refusal = (status: number, limitSource: string) =>
  Response.json({ error: { code: status, message: "refused", metadata: { limit_source: limitSource } } }, { status });

describe("callModel", () => {
  test("sends a chat completion and returns the text and cost", async () => {
    respond = () => answer("ls -la");
    expect(await call()).toEqual({ ok: true, text: "ls -la", costDollars: 0.0012, wasCutOff: false });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get("authorization")).toBe("Bearer sk-test");
    expect(requests[0]!.body).toMatchObject({
      model: "vendor/model",
      max_tokens: 200,
      messages: [{ role: "user", content: "hello" }],
      reasoning: { effort: "low" },
    });
  });

  test("counts a missing cost as 0, for providers that don't report one, and warns, since the spend cap then can't work", async () => {
    respond = () => answer("pwd", "stop", {});
    expect(await call()).toMatchObject({ ok: true, costDollars: 0 });
    expect(warnings).toEqual([{ msg: "model call reported no cost", fields: { model: "vendor/model" } }]);
  });

  test("a reported cost gives no warning", async () => {
    respond = () => answer("pwd");
    await call();
    expect(warnings).toEqual([]);
  });

  test("an answer whose choice has no message is a failure to retry", async () => {
    respond = () => Response.json({ id: "gen-1", choices: [{ index: 0, finish_reason: "error" }], usage: { cost: 0.0012 } });
    expect(await call()).toMatchObject({ ok: false, reason: "failed", costDollars: 0.0012 });
  });

  test("an answer that ended with an error is a failure, even with some text", async () => {
    respond = () => answer("ls -l", "error");
    expect(await call()).toMatchObject({ ok: false, reason: "failed", errorMessage: expect.stringContaining("error"), costDollars: 0.0012 });
  });

  test("a message cut off at the length cap is kept, and marked", async () => {
    respond = () => answer("ls -la /ho", "length");
    expect(await call()).toEqual({ ok: true, text: "ls -la /ho", costDollars: 0.0012, wasCutOff: true });
  });

  test("an empty message cut off at the cap is a failure that still cost money", async () => {
    // A reasoning model can spend the whole cap on reasoning.
    respond = () => answer("", "length");
    expect(await call()).toMatchObject({ ok: false, reason: "failed", costDollars: 0.0012 });
  });

  test.each([402, 403])("the key's own limit, under status %d, is recognized by OpenRouter's limit_source", async (status) => {
    respond = () => refusal(status, "openrouter_key_limit");
    expect(await call()).toMatchObject({ ok: false, reason: "key-limit-reached", costDollars: 0 });
  });

  test.each([402, 403])("spent prepaid credit, under status %d, is recognized (D59)", async (status) => {
    respond = () => refusal(status, "openrouter_credits");

    expect(await call()).toMatchObject({ ok: false, reason: "credits-spent" });
  });

  test("other refusals and errors are failures, reporting the HTTP status", async () => {
    for (const [response, status] of [
      [() => new Response("bad gateway", { status: 502 }), "502"],
      [() => refusal(402, "openrouter_in_flight_budget"), "402"],
      [() => Response.json({ error: { message: "slow down" } }, { status: 429 }), "429"],
    ] as const) {
      respond = response;
      const result = await call();
      expect(result).toMatchObject({ ok: false, reason: "failed" });
      expect(!result.ok && result.errorMessage).toContain(status);
    }
  });

  test("an answer without choices, as some provider errors arrive, is a failure to retry", async () => {
    respond = () => Response.json({ id: "gen-1", object: "chat.completion", error: { message: "upstream error" } });
    expect(await call()).toMatchObject({ ok: false, reason: "failed" });
  });

  test("an empty answer is a failure", async () => {

    respond = () => answer("");
    expect(await call()).toMatchObject({ ok: false, reason: "failed" });
  });

  test("never retries by itself: the runner does its own retries", async () => {
    respond = () => new Response("unavailable", { status: 503 });
    await call();
    expect(requests).toHaveLength(1);
  });

  test("gives up on a call that takes too long", async () => {
    respond = async () => {
      await Bun.sleep(500);
      return answer("late");
    };
    expect(await call({ timeoutMs: 50 })).toMatchObject({ ok: false, reason: "failed" });
  });

  test("stops when the Session is stopped", async () => {
    respond = async () => {
      await Bun.sleep(500);
      return answer("late");
    };
    const stop = new AbortController();
    const result = call({ signal: stop.signal });
    stop.abort();
    expect(await result).toMatchObject({ ok: false, reason: "failed" });
  });
});
