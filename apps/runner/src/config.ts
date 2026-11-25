// The runner's settings (spec section 7), from environment variables set by the
// ConfigMaps (D45): the shared settings, extended with the runner's own and checked
// in one go, so one error names every missing or invalid variable. The values live only
// in the ConfigMaps, so there are no defaults here.
import { z } from "zod";
import { parseEnvironment, positiveWholeNumber, SharedEnvironment, toSettings } from "@exhibition/shared";
import { REASONING_EFFORTS } from "./llm.ts";

const RunnerEnvironment = SharedEnvironment.extend({
  SLOT_COUNT: positiveWholeNumber, // the runner owns the slot count (D65)
  EXCHANGE_CAP: positiveWholeNumber, // S2.4
  INTERMISSION_SECONDS: positiveWholeNumber, // S2.8
  DAILY_SPEND_CAP_DOLLARS: z.coerce.number().positive(), // S6.1
  // The maximum message length (S5.3), in tokens, as the provider enforces it.
  // A placeholder until trial runs show normal message lengths.
  MAX_MESSAGE_TOKENS: positiveWholeNumber,
  // Any OpenAI-compatible chat API (S5.2).
  LLM_BASE_URL: z.url(),
  EXPLORER_MODEL: z.string().min(1),
  PRETENDER_MODEL: z.string().min(1),
  // How much each model reasons before answering; to be tried in the trial runs.
  EXPLORER_REASONING_EFFORT: z.enum(REASONING_EFFORTS),
  PRETENDER_REASONING_EFFORT: z.enum(REASONING_EFFORTS),
  VALKEY_HOST: z.string().min(1),
  VALKEY_PORT: positiveWholeNumber,
});

export type RunnerConfig = ReturnType<typeof loadRunnerConfig>;

export function loadRunnerConfig(env: Record<string, string | undefined> = process.env) {
  const parsedEnv = parseEnvironment(RunnerEnvironment, env);
  return {
    sharedSettings: toSettings(parsedEnv),
    slotCount: parsedEnv.SLOT_COUNT,
    exchangeCap: parsedEnv.EXCHANGE_CAP,
    intermissionSeconds: parsedEnv.INTERMISSION_SECONDS,
    dailySpendCapDollars: parsedEnv.DAILY_SPEND_CAP_DOLLARS,
    maxMessageTokens: parsedEnv.MAX_MESSAGE_TOKENS,
    llmBaseUrl: parsedEnv.LLM_BASE_URL,
    model: { explorer: parsedEnv.EXPLORER_MODEL, pretender: parsedEnv.PRETENDER_MODEL },
    reasoningEffort: { explorer: parsedEnv.EXPLORER_REASONING_EFFORT, pretender: parsedEnv.PRETENDER_REASONING_EFFORT },
    valkeyHost: parsedEnv.VALKEY_HOST,
    valkeyPort: parsedEnv.VALKEY_PORT,
  };
}

// Reads a value from a mounted Secret file (D37). Errors name the file, never the value.
export async function readSecretFile(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new Error(`Secret file missing: ${path}`);
  const value = (await file.text()).trim();
  if (!value) throw new Error(`Secret file empty: ${path}`);
  return value;
}
