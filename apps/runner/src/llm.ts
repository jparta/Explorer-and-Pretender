// One call to the model provider's chat completions API, through the openai package
// (D13), not streamed (D31). Any OpenAI-compatible API works (S5.2).
import OpenAI from "openai";
import { log as defaultLog, describeError, type Logger } from "./log.ts";

export type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;

// Per model call: generous while the models are tried, so slow reasoning isn't cut off
// (a timed-out call is still billed, but counts as nothing towards the spend). Three tries
// of this, plus the waits between them, is the longest a Session can stand still before
// it ends as interrupted (runner component doc, section 2.3).
export const MODEL_CALL_TIMEOUT_MS = 5 * 60_000;

// How much a model reasons before answering, as OpenRouter names the levels. For Claude
// models OpenRouter turns it into a share of max_tokens for reasoning, "none" turning it
// off; a model with fewer levels gets the nearest one it has. Claude needs max_tokens
// above the reasoning budget, which is at least 1,024 tokens, so a low MAX_MESSAGE_TOKENS
// with reasoning on makes every call fail.
export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export type ModelResult =
  // wasCutOff: the message reached the length cap (S5.3) and was cut there.
  | { ok: true; text: string; costDollars: number; wasCutOff: boolean }
  // key-limit-reached: the key's own daily limit is spent (S6.3). credits-spent: the account's
  // prepaid credit is spent (D59). costDollars: what the call cost anyway, if anything.
  | { ok: false; reason: "key-limit-reached" | "credits-spent" | "failed"; errorMessage: string; costDollars: number };

// OpenRouter's fields beyond the OpenAI API (D13). The package keeps them at runtime;
// they're only missing from its types.
type OpenRouterUsage = { cost?: number };
type OpenRouterError = { metadata?: { limit_source?: string } };

export function createModelClient(options: { baseUrl: string; apiKey: string; timeoutMs: number }): OpenAI {
  return new OpenAI({
    baseURL: options.baseUrl,
    apiKey: options.apiKey,
    timeout: options.timeoutMs,
    // The runner retries on its own, with its own timing (session.ts). The package's
    // default of 2 more tries would multiply them.
    maxRetries: 0,
  });
}

export async function callModel(request: {
  client: OpenAI;
  model: string;
  maxTokens: number;
  reasoningEffort: ReasoningEffort;
  messages: ChatMessage[];
  signal: AbortSignal;
  log?: Logger;
}): Promise<ModelResult> {
  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await request.client.chat.completions.create(
      {
        model: request.model,
        max_tokens: request.maxTokens,
        messages: request.messages,
        // OpenRouter's field (D13), missing from the package's types.
        ...({ reasoning: { effort: request.reasoningEffort } } as object),
      },
      { signal: request.signal },
    );
  } catch (error) {
    return toFailedResult(error);
  }

  const reportedCostDollars = (completion.usage as OpenRouterUsage | undefined)?.cost;
  // Without a cost, the spend cap can't work (S6.1), so it's worth a warning.
  if (reportedCostDollars === undefined) (request.log ?? defaultLog).warn("model call reported no cost", { model: request.model });
  const costDollars = reportedCostDollars ?? 0;
  // Some provider errors arrive as a 200 response without choices.
  const choice = completion.choices?.[0];

  const text = choice?.message?.content ?? "";
  // An empty answer, even one cut off at the cap (a reasoning model can spend the whole
  // cap on reasoning), is a failure to retry; it may still have cost money. So is an
  // answer the provider ended with an error, whatever text it got before that.
  if (choice?.finish_reason === ("error" as string)) {
    return { ok: false, reason: "failed", errorMessage: "the provider ended the answer with an error (finish_reason error)", costDollars };
  }
  if (text === "") {
    return { ok: false, reason: "failed", errorMessage: `empty answer (finish_reason ${choice?.finish_reason})`, costDollars };
  }
  return { ok: true, text, costDollars, wasCutOff: choice?.finish_reason === "length" };
}

function toFailedResult(error: unknown): ModelResult {
  if (error instanceof OpenAI.APIError && error.status !== undefined) {
    // OpenRouter names the limit that refused the call. Its docs disagree on whether the
    // status is 402 or 403, so only the name is used.
    const limitSource = (error.error as OpenRouterError | undefined)?.metadata?.limit_source;
    const reason =
      limitSource === "openrouter_key_limit" ? "key-limit-reached" : limitSource === "openrouter_credits" ? "credits-spent" : "failed";
    // The package's message usually starts with the status already.
    const message = error.message.startsWith(String(error.status)) ? error.message : `${error.status} ${error.message}`;
    return { ok: false, reason, errorMessage: message, costDollars: 0 };
  }
  // No HTTP status: a connection error, a timeout or a stop.
  return { ok: false, reason: "failed", errorMessage: describeError(error), costDollars: 0 };
}
