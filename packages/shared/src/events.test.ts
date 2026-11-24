import { describe, expect, test } from "bun:test";
import {
  fromStreamFields,
  SseEvent,
  parseAndValidateJson,
  SessionEvent,
  SlotStateEvent,
  toStreamFields,
} from "./events.ts";

const sessionEvents: SessionEvent[] = [
  { type: "session-start", sessionId: "9f2c", slot: 2, kind: "terminal" },
  { type: "message", role: "explorer", text: "ls -la" },
  { type: "message", role: "explorer", text: "cat verbose-keepalive-hibernates", codeword: "verbose-keepalive-hibernates" },
  { type: "message", role: "pretender", text: "total 0" },
  { type: "session-end", ending: "found" },
  { type: "session-end", ending: "sleeping" },
];

describe("stream entries", () => {
  test.each(sessionEvents)("a $type event survives the trip", (event) => {
    expect(fromStreamFields(SessionEvent, toStreamFields(event))).toEqual({ ok: true, value: event });
  });

  test("a slot status survives the trip", () => {
    const status: SlotStateEvent = { type: "slot", slot: 0, state: "running", sessionId: "9f2c" };
    expect(fromStreamFields(SlotStateEvent, toStreamFields(status))).toEqual({ ok: true, value: status });
  });

  test("the event field is found among other fields", () => {
    const message: SessionEvent = { type: "message", role: "explorer", text: "ls" };
    const fields = ["other", "x", ...toStreamFields(message)];
    expect(fromStreamFields(SessionEvent, fields).ok).toBe(true);
  });

  test("a missing event field is an error", () => {
    expect(fromStreamFields(SessionEvent, ["other", "x"])).toEqual({ ok: false, error: 'no "event" field' });
  });

  test("a value named event is not mistaken for the field", () => {
    expect(fromStreamFields(SessionEvent, ["other", "event"]).ok).toBe(false);
  });

  test("broken JSON is an error", () => {
    expect(fromStreamFields(SessionEvent, ["event", "{not json"])).toEqual({ ok: false, error: "not valid JSON" });
  });
});

describe("checking shapes", () => {
  const rejected: [string, unknown][] = [
    ["an unknown type", { type: "shout", text: "hi" }],
    ["an unknown role", { type: "message", role: "viewer", text: "hi" }],
    ["a missing text", { type: "message", role: "explorer" }],
    ["an unknown ending", { type: "session-end", ending: "exploded" }],
    ["a negative slot", { type: "session-start", sessionId: "9f2c", slot: -1, kind: "terminal" }],
    ["a fractional slot", { type: "session-start", sessionId: "9f2c", slot: 1.5, kind: "terminal" }],
    ["an unknown kind", { type: "session-start", sessionId: "9f2c", slot: 1, kind: "spaceship" }],
    ["an empty Codeword", { type: "message", role: "explorer", text: "x", codeword: "" }],
  ];

  test.each(rejected)("rejects %s", (_, data) => {
    const result = parseAndValidateJson(SessionEvent, JSON.stringify(data));
    expect(result.ok).toBe(false);
  });

  test("the error says what is wrong", () => {
    const result = parseAndValidateJson(SessionEvent, JSON.stringify({ type: "message", role: "viewer", text: "hi" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("role");
  });
});

describe("SSE events", () => {
  test("a Session event needs its slot", () => {
    expect(parseAndValidateJson(SseEvent, JSON.stringify({ type: "message", role: "explorer", text: "ls" })).ok).toBe(false);
    expect(parseAndValidateJson(SseEvent, JSON.stringify({ slot: 1, type: "message", role: "explorer", text: "ls" })).ok).toBe(true);
  });

  test("a slot status is an SSE event as it is", () => {
    expect(parseAndValidateJson(SseEvent, JSON.stringify({ type: "slot", slot: 0, state: "idle" })).ok).toBe(true);
  });
});
