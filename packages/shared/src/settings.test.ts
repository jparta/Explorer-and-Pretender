import { expect, test } from "bun:test";
import { loadSharedSettings } from "./settings.ts";

const sharedEnv = {
  PRESENCE_TIMEOUT_SECONDS: "45",
  REVEAL_RATE_EXPLORER_CHARS_PER_SECOND: "20",
  REVEAL_RATE_PRETENDER_CHARS_PER_SECOND: "200",
};

test("refuses to start with settings missing, naming each: the values live only in the ConfigMap", () => {
  const load = () => loadSharedSettings({ PRESENCE_TIMEOUT_SECONDS: "45" });
  expect(load).toThrow(/REVEAL_RATE_EXPLORER_CHARS_PER_SECOND/);
  expect(load).toThrow(/REVEAL_RATE_PRETENDER_CHARS_PER_SECOND/);
});

test("takes each value from its environment variable", () => {
  const settings = loadSharedSettings(sharedEnv);
  expect(settings).toEqual({
    presenceTimeoutSeconds: 45,
    revealRateCharsPerSecond: { explorer: 20, pretender: 200 },
  });
});

test("ignores unrelated variables", () => {
  expect(() => loadSharedSettings({ ...sharedEnv, PATH: "/usr/bin", HOME: "/root" })).not.toThrow();
});

test.each(["0", "-1", "2.5", "abc", ""])("refuses %p", (value) => {
  expect(() => loadSharedSettings({ ...sharedEnv, PRESENCE_TIMEOUT_SECONDS: value })).toThrow(/PRESENCE_TIMEOUT_SECONDS/);
});

test("one error names every invalid variable", () => {
  const load = () =>
    loadSharedSettings({ PRESENCE_TIMEOUT_SECONDS: "abc", REVEAL_RATE_EXPLORER_CHARS_PER_SECOND: "2.5", REVEAL_RATE_PRETENDER_CHARS_PER_SECOND: "0" });
  expect(load).toThrow(/PRESENCE_TIMEOUT_SECONDS/);
  expect(load).toThrow(/REVEAL_RATE_EXPLORER_CHARS_PER_SECOND/);
  expect(load).toThrow(/REVEAL_RATE_PRETENDER_CHARS_PER_SECOND/);
});
