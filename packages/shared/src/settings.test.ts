import { expect, test } from "bun:test";
import { loadSharedSettings } from "./settings.ts";

test("starts without any settings in the environment", () => {
  expect(() => loadSharedSettings({})).not.toThrow();
});

test("takes each value from its environment variable", () => {
  const settings = loadSharedSettings({
    PRESENCE_TIMEOUT_SECONDS: "45",
    REVEAL_RATE_EXPLORER_CHARS_PER_SECOND: "20",
    REVEAL_RATE_PRETENDER_CHARS_PER_SECOND: "200",
  });
  expect(settings).toEqual({
    presenceTimeoutSeconds: 45,
    revealRateCharsPerSecond: { explorer: 20, pretender: 200 },
  });
});

test("ignores unrelated variables", () => {
  expect(() => loadSharedSettings({ PATH: "/usr/bin", HOME: "/root" })).not.toThrow();
});

test.each(["0", "-1", "2.5", "abc", ""])("refuses %p", (value) => {
  expect(() => loadSharedSettings({ PRESENCE_TIMEOUT_SECONDS: value })).toThrow(/PRESENCE_TIMEOUT_SECONDS/);
});

test("one error names every invalid variable", () => {
  const load = () =>
    loadSharedSettings({ PRESENCE_TIMEOUT_SECONDS: "abc", REVEAL_RATE_EXPLORER_CHARS_PER_SECOND: "2.5", REVEAL_RATE_PRETENDER_CHARS_PER_SECOND: "0" });
  expect(load).toThrow(/PRESENCE_TIMEOUT_SECONDS/);
  expect(load).toThrow(/REVEAL_RATE_EXPLORER_CHARS_PER_SECOND/);
  expect(load).toThrow(/REVEAL_RATE_PRETENDER_CHARS_PER_SECOND/);
});
