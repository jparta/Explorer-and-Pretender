// One Session's conversation, with scripted models on a fake clock: turns, each side's
// history, endings, retries, pacing and spend.
import { describe, expect, test } from "bun:test";
import type { Role, SessionEvent } from "@exhibition/shared";
import type { ChatMessage, ModelResult } from "./llm.ts";
import { fillPrompt, PACING_FACTOR, runSession, type SessionSetup } from "./session.ts";

type Message = Extract<SessionEvent, { type: "message" }>;

const CODEWORD = "verbose-keepalive-hibernates";
const setup: SessionSetup = {
  codeword: CODEWORD,
  explorerPrompt: "find it",
  pretenderPrompt: `be a terminal, hide ${CODEWORD}`,
  turnCap: 3,
  revealRateCharsPerSecond: { explorer: 10, pretender: 40 },
  maxAttempts: 3,
  retryWaitMs: 1_000,
};

// Runs a Session against scripted models on a fake clock: sleeping only moves the
// clock, so pacing can be checked exactly and the tests take no time.
async function run(
  answer: (role: Role, call: number) => ModelResult | Promise<ModelResult>,
  options: {
    setup?: Partial<SessionSetup>;
    generationMs?: number;
    signal?: AbortSignal;
    write?: (event: Message) => Promise<void>;
  } = {},
) {
  let clock = 0;
  const calls: { role: Role; messages: ChatMessage[]; at: number }[] = [];
  const written: { event: Message; at: number }[] = [];
  const spent: number[] = [];
  const ending = await runSession(
    { ...setup, ...options.setup },
    {
      callModel: async (role, messages) => {
        calls.push({ role, messages: structuredClone(messages), at: clock });
        clock += options.generationMs ?? 0;
        return answer(role, calls.length);
      },
      write:
        options.write ??
        (async (event) => {
          written.push({ event, at: clock });
        }),
      addSpend: async (costDollars) => {
        spent.push(costDollars);
      },
      now: () => clock,
      sleep: async (ms, signal) => {
        if (signal.aborted) throw signal.reason;
        clock += ms;
      },
    },
    options.signal ?? new AbortController().signal,
  );
  return { ending, calls, written, spent };
}

const ok = (text: string, costDollars = 0.001): ModelResult => ({ ok: true, text, costDollars, cutOff: false });
const failed: ModelResult = { ok: false, reason: "failed", error: "502", costDollars: 0 };
// Never says the Codeword: the Explorer types commands, the Pretender answers.
const chatter = (role: Role, call: number) => ok(role === "explorer" ? `cmd ${call}` : `out ${call}`);

describe("fillPrompt", () => {
  test("puts the Codeword in place of <Codeword>", () => {
    expect(fillPrompt("The secret is `<Codeword>`", CODEWORD)).toBe(`The secret is \`${CODEWORD}\``);
  });
});

describe("runSession", () => {
  test("alternates, Explorer first, and gives each model the history from its own side (S2.2, S5.4)", async () => {
    const { calls, written } = await run(chatter);
    expect(written.map((w) => w.event.role)).toEqual([
      "explorer", "pretender", "explorer", "pretender", "explorer", "pretender",
    ]);
    // The Explorer's instructions are its first user message; its own messages are its
    // own (assistant), the Pretender's come from the other party (user).
    expect(calls[2]).toMatchObject({
      role: "explorer",
      messages: [
        { role: "user", content: "find it" },
        { role: "assistant", content: "cmd 1" },
        { role: "user", content: "out 2" },
      ],
    });
    // The Pretender's instructions, with the Codeword, are its system prompt (S3.3).
    expect(calls[3]).toMatchObject({
      role: "pretender",
      messages: [
        { role: "system", content: setup.pretenderPrompt },
        { role: "user", content: "cmd 1" },
        { role: "assistant", content: "out 2" },
        { role: "user", content: "cmd 3" },
      ],
    });
    // Only the Pretender is given the Codeword.
    for (const call of calls.filter((c) => c.role === "explorer")) {
      expect(JSON.stringify(call.messages)).not.toContain(CODEWORD);
    }
  });

  test("ran its course: ends after the turn cap's exchanges (S2.4)", async () => {
    const { ending, written } = await run(chatter);
    expect(ending).toBe("ran-its-course");
    expect(written).toHaveLength(2 * setup.turnCap);
  });

  test("found: an Explorer message with the Codeword carries it and ends the Session (S2.3)", async () => {
    const { ending, written } = await run((role, call) =>
      call === 3 ? ok(`cat codeword.txt # ${CODEWORD}`) : chatter(role, call),
    );
    expect(ending).toBe("found");
    expect(written.at(-1)!.event).toEqual({
      type: "message",
      role: "explorer",
      text: `cat codeword.txt # ${CODEWORD}`,
      codeword: CODEWORD,
    });
    expect(written).toHaveLength(3);
    expect(written.slice(0, -1).every((w) => w.event.codeword === undefined)).toBe(true);
  });

  test("the Codeword must appear exactly; in the Pretender's output it doesn't count", async () => {
    const { ending } = await run((role, call) =>
      role === "pretender" ? ok(CODEWORD) : ok(call === 3 ? CODEWORD.toUpperCase() : "ls"),
    );
    expect(ending).toBe("ran-its-course");
  });

  test("adds each call's cost to the spend", async () => {
    const { spent } = await run((_role, call) => ok("x", call / 1000));
    expect(spent).toEqual([0.001, 0.002, 0.003, 0.004, 0.005, 0.006]);
  });

  test("every call's cost is counted and logged, failed calls included, even when it's 0 (S6.5)", async () => {
    let call = 0;
    const { spent } = await run((role, n) => {
      call++;
      if (call === 1) return { ok: false, reason: "failed", error: "cut off empty", costDollars: 0.004 };
      if (call === 2) return { ok: false, reason: "failed", error: "502", costDollars: 0 };
      return chatter(role, n);
    });
    expect(spent.slice(0, 3)).toEqual([0.004, 0, 0.001]);
  });

  test("paces: a message is written only once the previous one has been revealed, with 10% slack (architecture 7)", async () => {
    const { written } = await run(chatter, { generationMs: 100 });
    for (let i = 1; i < written.length; i++) {
      const previous = written[i - 1]!;
      const rate = setup.revealRateCharsPerSecond[previous.event.role];
      const revealMs = (PACING_FACTOR * previous.event.text.length * 1000) / rate;
      // Generation (100 ms) is shorter than revealing, so the wait is exactly the reveal time.
      expect(written[i]!.at - previous.at).toBeCloseTo(revealMs, 6);
    }
    // The first message is written as soon as it arrives.
    expect(written[0]!.at).toBe(100);
  });

  test("generation longer than the reveal shows as a pause, with no extra wait", async () => {
    const { written } = await run(chatter, { generationMs: 5_000 });
    expect(written[1]!.at - written[0]!.at).toBe(5_000);
  });

  test("retries a failed call, waiting between tries", async () => {
    // The Pretender's first answer fails twice, then succeeds on the third try.
    let failures = 2;
    const { ending, calls } = await run((role, call) => {
      if (role === "pretender" && failures > 0) {
        failures--;
        return failed;
      }
      return chatter(role, call);
    });
    expect(ending).toBe("ran-its-course");
    expect(calls.slice(1, 4).map((c) => c.role)).toEqual(["pretender", "pretender", "pretender"]);
    expect(calls[2]!.at - calls[1]!.at).toBe(setup.retryWaitMs);
    expect(calls[3]!.at - calls[2]!.at).toBe(setup.retryWaitMs);
  });

  test("interrupted: the same message fails three times in a row (S2.5)", async () => {
    const { ending, calls, written } = await run((role, call) => (call >= 2 ? failed : chatter(role, call)));
    expect(ending).toBe("interrupted");
    expect(calls).toHaveLength(1 + setup.maxAttempts);
    expect(written).toHaveLength(1);
  });

  test.each(["key-limit", "credits"] as const)(
    "sleeping: a %s refusal stops the Session at once, without retrying (S6.2, D59)",
    async (reason) => {
      const { ending, calls } = await run((role, call) =>
        call === 2 ? { ok: false, reason, error: "refused", costDollars: 0 } : chatter(role, call),
      );
      expect(ending).toBe("sleeping");
      expect(calls).toHaveLength(2);
    },
  );

  test("interrupted: stopped from outside, it makes no more calls, and the answer in flight still counts towards the spend", async () => {
    const stop = new AbortController();
    const { ending, calls, written, spent } = await run(
      (role, call) => {
        if (call === 2) stop.abort();
        return chatter(role, call);
      },
      { signal: stop.signal },
    );
    expect(ending).toBe("interrupted");
    expect(calls).toHaveLength(2);
    expect(written).toHaveLength(1);
    expect(spent).toHaveLength(2);
  });

  test("a write that fails rejects, for the slot loop to record as interrupted", async () => {
    const result = run(chatter, {
      write: async () => {
        throw new Error("Connection closed");
      },
    });
    await expect(result).rejects.toThrow("Connection closed");
  });
});
