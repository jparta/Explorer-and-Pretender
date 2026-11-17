import { expect, test } from "bun:test";
import { loadSettings } from "./settings.ts";

test("starts without any settings in the environment", () => {
  expect(() => loadSettings({})).not.toThrow();
});

test("takes each value from its environment variable", () => {
  const settings = loadSettings({
    SLOTS: "5",
    PRESENCE_TIMEOUT_SECONDS: "45",
    REVEAL_RATE_EXPLORER: "20",
    REVEAL_RATE_PRETENDER: "200",
  });
  expect(settings).toEqual({
    slots: 5,
    presenceTimeoutSeconds: 45,
    revealRate: { explorer: 20, pretender: 200 },
  });
});

test("ignores unrelated variables", () => {
  expect(() => loadSettings({ PATH: "/usr/bin", HOME: "/root" })).not.toThrow();
});

test.each(["0", "-1", "2.5", "abc", ""])("refuses %p", (value) => {
  expect(() => loadSettings({ SLOTS: value })).toThrow(/SLOTS/);
});

test("one error names every invalid variable", () => {
  const load = () => loadSettings({ SLOTS: "0", PRESENCE_TIMEOUT_SECONDS: "abc", REVEAL_RATE_EXPLORER: "2.5" });
  expect(load).toThrow(/SLOTS/);
  expect(load).toThrow(/PRESENCE_TIMEOUT_SECONDS/);
  expect(load).toThrow(/REVEAL_RATE_EXPLORER/);
});
