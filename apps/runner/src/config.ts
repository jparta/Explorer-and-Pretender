// The runner's settings (spec section 7), from environment variables set by the
// ConfigMaps (D45): the shared settings, extended with the runner's own and checked
// in one go, so one error names every invalid variable.
import { z } from "zod";
import { positiveWholeNumber, SharedEnvironment, toSettings } from "@exhibition/shared";

const Environment = SharedEnvironment.extend({
  SLOTS: positiveWholeNumber.default(3), // the runner owns the slot count (D58)
  TURN_CAP: positiveWholeNumber.default(15), // exchanges (S2.4)
  INTERMISSION_SECONDS: positiveWholeNumber.default(10), // S2.8
  DAILY_SPEND_CAP: z.coerce.number().positive().default(2), // dollars (S6.1)
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
  const result = Environment.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid settings:\n${z.prettifyError(result.error)}`);
  }
  const vars = result.data;
  return {
    shared: toSettings(vars),
    slotCount: vars.SLOTS,
    turnCap: vars.TURN_CAP,
    intermissionSeconds: vars.INTERMISSION_SECONDS,
    dailySpendCapDollars: vars.DAILY_SPEND_CAP,
    maxMessageTokens: vars.MAX_MESSAGE_TOKENS,
    llmBaseUrl: vars.LLM_BASE_URL,
    explorerModel: vars.EXPLORER_MODEL,
    pretenderModel: vars.PRETENDER_MODEL,
    valkeyHost: vars.VALKEY_HOST,
    valkeyPort: vars.VALKEY_PORT,
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
