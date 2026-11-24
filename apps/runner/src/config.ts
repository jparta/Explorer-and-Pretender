// The runner's settings (spec section 7), from environment variables set by the
// ConfigMaps (D45): the shared settings, extended with the runner's own and checked
// in one go, so one error names every invalid variable.
import { z } from "zod";
import { positiveWholeNumber, SharedEnvironment, toSettings } from "@exhibition/shared";

const RunnerEnvironment = SharedEnvironment.extend({
  SLOT_COUNT: positiveWholeNumber.default(3), // the runner owns the slot count (D65)
  EXCHANGE_CAP: positiveWholeNumber.default(15), // S2.4
  INTERMISSION_SECONDS: positiveWholeNumber.default(10), // S2.8
  DAILY_SPEND_CAP_DOLLARS: z.coerce.number().positive().default(2), // S6.1
  // The maximum message length (S5.3), in tokens, as the provider enforces it.
  // A placeholder until trial runs show normal message lengths.
  MAX_MESSAGE_TOKENS: positiveWholeNumber.default(1000),
  // Any OpenAI-compatible chat API (S5.2).
  LLM_BASE_URL: z.url().default("https://openrouter.ai/api/v1"),
  // No default: the runner doesn't start without models (S5.1).
  EXPLORER_MODEL: z.string().min(1),
  PRETENDER_MODEL: z.string().min(1),
  VALKEY_HOST: z.string().min(1).default("valkey"),
  VALKEY_PORT: positiveWholeNumber.default(6379),
});

export type RunnerConfig = ReturnType<typeof loadRunnerConfig>;

export function loadRunnerConfig(env: Record<string, string | undefined> = process.env) {
  const result = RunnerEnvironment.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid settings:\n${z.prettifyError(result.error)}`);
  }
  const parsedEnv = result.data;
  return {
    sharedSettings: toSettings(parsedEnv),
    slotCount: parsedEnv.SLOT_COUNT,
    exchangeCap: parsedEnv.EXCHANGE_CAP,
    intermissionSeconds: parsedEnv.INTERMISSION_SECONDS,
    dailySpendCapDollars: parsedEnv.DAILY_SPEND_CAP_DOLLARS,
    maxMessageTokens: parsedEnv.MAX_MESSAGE_TOKENS,
    llmBaseUrl: parsedEnv.LLM_BASE_URL,
    explorerModel: parsedEnv.EXPLORER_MODEL,
    pretenderModel: parsedEnv.PRETENDER_MODEL,
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
