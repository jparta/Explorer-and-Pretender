// Puts the parts of a Session together: a new Codeword, the prompts, the model calls,
// the stream writes and the spend. The slot loop calls the function this returns to run
// each Session. Tested end to end in runner.test.ts.
import { setTimeout as sleepUnlessAborted } from "node:timers/promises";
import type OpenAI from "openai";
import { utcDate } from "@exhibition/shared";
import { makeCodeword, type WordLists } from "./codeword.ts";
import type { RunnerConfig } from "./config.ts";
import { callModel } from "./llm.ts";
import { log as defaultLog, type Logger } from "./log.ts";
import { fillPrompt, runSession } from "./session.ts";
import type { RunSession } from "./slots.ts";
import type { ValkeyStore } from "./store.ts";

const MAX_ATTEMPTS = 3; // tries per message before the Session is interrupted (S2.5)
const RETRY_WAIT_MS = 2_000; // long enough for a brief provider hiccup to pass, short enough not to show

const promptsDir = new URL("../prompts/", import.meta.url);

// The Explorer's prompt and the terminal Pretender's, with <Codeword> where the
// Codeword goes (architecture 12).
export type Prompts = { explorer: string; terminal: string };

export async function loadPrompts(dir: URL = promptsDir): Promise<Prompts> {
  return {
    explorer: await Bun.file(new URL("explorer.md", dir)).text(),
    terminal: await Bun.file(new URL("terminal.md", dir)).text(),
  };
}

export function makeRunSession(options: {
  config: RunnerConfig;
  modelClient: OpenAI;
  store: ValkeyStore;
  prompts: Prompts;
  words: WordLists;
  log?: Logger;
}): RunSession {
  const { config, modelClient, store, prompts, words } = options;
  const log = options.log ?? defaultLog;

  return (slotIndex, sessionId, signal) => {
    const codeword = makeCodeword(words);
    // Logged for debugging, such as checking why a Session did or didn't end as found.
    log.info("Codeword chosen", { slot: slotIndex, sessionId, codeword });
    return runSession(
      {
        codeword,
        explorerPrompt: prompts.explorer,
        pretenderPrompt: fillPrompt(prompts.terminal, codeword),
        exchangeCap: config.exchangeCap,
        revealRateCharsPerSecond: config.sharedSettings.revealRateCharsPerSecond,
        maxAttempts: MAX_ATTEMPTS,
        retryWaitMs: RETRY_WAIT_MS,
      },
      {
        callModel: async (role, messages, signal) => {
          const result = await callModel({
            client: modelClient,
            model: config.model[role],
            maxTokens: config.maxMessageTokens,
            reasoningEffort: config.reasoningEffort[role],
            messages,
            signal,
          });
          if (!result.ok && !signal.aborted) {
            log.warn("model call failed", { slot: slotIndex, sessionId, role, reason: result.reason, error: result.errorMessage });
          }
          if (result.ok && result.wasCutOff) log.info("message cut off at the length cap", { slot: slotIndex, sessionId, role });
          return result;
        },
        write: (event) => store.writeEvent(sessionId, event),
        // Each call's cost and the day's total go to the logs (S6.5).
        addSpend: async (costDollars) => {
          const spendTodayDollars = await store.addSpend(utcDate(), costDollars);
          log.info("call cost", { slot: slotIndex, sessionId, costDollars, spendTodayDollars });
        },
        nowMs: Date.now,
        sleep: abortableSleep,
      },
      signal,
    );
  };
}

// A sleep that a stopped Session cuts short: it rejects as soon as the signal is aborted.
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return sleepUnlessAborted(ms, undefined, { signal });
}
