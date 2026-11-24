// The slot states writer on its own, with a fake write. slots.test.ts covers it
// through the slot loops, against Valkey.
import { expect, test } from "bun:test";
import type { SlotStateWithSession } from "@exhibition/shared";
import type { Logger } from "./log.ts";
import { SlotStatesWriter } from "./slot-states-writer.ts";

const log: Logger = { info: () => {}, warn: () => {}, error: () => {} };

test("a change made as soon as the previous write succeeded is written too", async () => {
  let slotStates: SlotStateWithSession[] = [{ state: "idle" }];
  const written: SlotStateWithSession[][] = [];
  const writer = new SlotStatesWriter({
    currentSlotStates: () => slotStates,
    write: async (slots) => {
      written.push(slots);
    },
    retryPauseMs: 10,
    log,
  });
  const nextChangeMade = writer.writeChange().then(() => {
    slotStates = [{ state: "sleeping" }];
    return writer.writeChange();
  });
  await nextChangeMade;
  expect(written.at(-1)).toEqual([{ state: "sleeping" }]);
});

test("a change counts as written only once a write with it has succeeded, after any failed tries", async () => {
  const written: SlotStateWithSession[][] = [];
  let failuresLeft = 2;
  const writer = new SlotStatesWriter({
    currentSlotStates: () => [{ state: "sleeping" }],
    write: async (slots) => {
      if (failuresLeft-- > 0) throw new Error("Connection closed");
      written.push(slots);
    },
    retryPauseMs: 10,
    log,
  });
  await writer.writeChange();
  expect(written).toEqual([[{ state: "sleeping" }]]);
});
