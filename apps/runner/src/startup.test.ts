// Start-up's wait for Valkey, with a fake ping.
import { expect, test } from "bun:test";
import type { Logger } from "./log.ts";
import { waitUntilValkeyAnswers } from "./startup.ts";

const warnings: string[] = [];
const log: Logger = { info: () => {}, warn: (msg) => warnings.push(msg), error: () => {} };

test("a refused ping is tried again only after a pause, not at once", async () => {
  let pings = 0;
  const pausesMs: number[] = [];
  await waitUntilValkeyAnswers(
    async () => {
      if (++pings <= 2) throw new Error("WRONGPASS");
    },
    {
      answerTimeoutMs: 5_000,
      retryPauseMs: 1_000,
      log,
      // The answer timeouts never run out here: each ping settles at once.
      sleep: async (ms) => {
        if (ms !== 1_000) return new Promise(() => {});
        pausesMs.push(ms);
      },
    },
  );
  expect(pings).toBe(3);
  expect(pausesMs).toEqual([1_000, 1_000]);
});

test("a ping that gets no answer is followed by another once the answer timeout runs out", async () => {
  let pings = 0;
  await waitUntilValkeyAnswers(() => (++pings === 1 ? new Promise(() => {}) : Promise.resolve()), {
    answerTimeoutMs: 10,
    retryPauseMs: 1_000,
    log,
  });
  expect(pings).toBe(2);
  expect(warnings).toContain("start-up: waiting for Valkey");
});
