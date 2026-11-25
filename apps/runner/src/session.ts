// The conversation of one Session (architecture 6.2): the Explorer and the Pretender take
// turns until an ending. Writes only the message events; the slot loop writes
// session-start and session-end, so every ending, an outside stop included, is written
// in one place. Doesn't touch the network itself: the model, Valkey and the clock are
// passed in, which lets the tests run it on a fake clock.
import type { Ending, Role, SessionEvent } from "@exhibition/shared";
import type { ChatMessage, ModelResult } from "./llm.ts";

type Message = Extract<SessionEvent, { type: "message" }>;

// The runner is this much slower than the display, so no backlog builds up in the
// browser (architecture 7). To be tuned in trial runs.
export const PACING_FACTOR = 1.1;

// What a Session starts with, fixed for its whole run.
export type SessionSetup = {
  codeword: string;
  // Sent as the Explorer's first user message (architecture 6.2).
  explorerPrompt: string;
  // The Pretender's system prompt, with the Codeword already filled in.
  pretenderPrompt: string;
  turnCap: number;
  revealRateCharsPerSecond: Record<Role, number>;
  maxAttempts: number; // tries per message before the Session is interrupted (S2.5)
  retryWaitMs: number;
};

export type SessionDeps = {
  callModel: (role: Role, messages: ChatMessage[], signal: AbortSignal) => Promise<ModelResult>;
  write: (event: Message) => Promise<void>;
  addSpend: (costDollars: number) => Promise<void>;
  now: () => number; // milliseconds
  // Rejects when the signal is aborted.
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
};

const CODEWORD_PLACEHOLDER = "<Codeword>";

export function fillPrompt(template: string, codeword: string): string {
  return template.replaceAll(CODEWORD_PLACEHOLDER, codeword);
}

// Resolves with the ending. A stop from outside (the signal) ends it as interrupted.
// A failing write or spend update rejects, for the slot loop to record as interrupted.
export async function runSession(setup: SessionSetup, deps: SessionDeps, signal: AbortSignal): Promise<Ending> {
  const history: { role: Role; text: string }[] = [];
  // When the previous message is fully revealed in browsers, with the pacing slack;
  // the next message is written no earlier.
  let nextWriteAtMs = 0;

  try {
    for (let exchange = 1; exchange <= setup.turnCap; exchange++) {
      for (const role of ["explorer", "pretender"] as const) {
        const answer = await callModelWithRetries(role, contextFor(role, setup, history), setup, deps, signal);
        if (answer.kind === "ending") return answer.ending;
        const text = answer.text;

        const wait = nextWriteAtMs - deps.now();
        if (wait > 0) await deps.sleep(wait, signal);
        if (signal.aborted) return "interrupted";

        const found = role === "explorer" && text.includes(setup.codeword);
        await deps.write({
          type: "message",
          role,
          text,
          ...(found ? { codeword: setup.codeword } : {}),
        });
        history.push({ role, text });
        nextWriteAtMs = deps.now() + (PACING_FACTOR * text.length * 1000) / setup.revealRateCharsPerSecond[role];
        if (found) return "found";
      }
    }
    return "ran-its-course";
  } catch (error) {
    if (signal.aborted) return "interrupted";
    throw error;
  }
}

// Each model sees its own earlier messages as its own (assistant) and the other's as
// coming from the other party (user). Only the text is kept, so no reasoning is carried
// over (S5.4).
function contextFor(role: Role, setup: SessionSetup, history: { role: Role; text: string }[]): ChatMessage[] {
  const instructions: ChatMessage =
    role === "explorer"
      ? { role: "user", content: setup.explorerPrompt }
      : { role: "system", content: setup.pretenderPrompt };
  return [
    instructions,
    ...history.map(
      (message): ChatMessage => ({
        role: message.role === role ? "assistant" : "user",
        content: message.text,
      }),
    ),
  ];
}

async function callModelWithRetries(
  role: Role,
  messages: ChatMessage[],
  retry: { maxAttempts: number; retryWaitMs: number },
  deps: SessionDeps,
  signal: AbortSignal,
): Promise<{ kind: "text"; text: string } | { kind: "ending"; ending: Ending }> {
  for (let attempt = 1; ; attempt++) {
    if (signal.aborted) return { kind: "ending", ending: "interrupted" };
    const result = await deps.callModel(role, messages, signal);
    // Every call's cost is counted and logged (S6.5): failed calls too, since some still
    // cost money, and calls answered after the Session was stopped.
    await deps.addSpend(result.costDollars);

    if (signal.aborted) return { kind: "ending", ending: "interrupted" };
    if (result.ok) return { kind: "text", text: result.text };
    // Retrying can't help until the next day, or until someone tops up (S6.2, D59).
    if (result.reason !== "failed") return { kind: "ending", ending: "sleeping" };
    if (attempt >= retry.maxAttempts) return { kind: "ending", ending: "interrupted" };
    await deps.sleep(retry.retryWaitMs, signal);
  }
}
