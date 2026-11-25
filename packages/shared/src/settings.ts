// The settings of spec section 7 that more than one component reads
// (shared component doc, section 4). Defaults are the spec's starting values.
import { z } from "zod";

export const positiveWholeNumber = z.coerce.number().int().positive();

// Exported so a component can extend it with its own settings and check everything in
// one go, getting one error that names every invalid variable.
export const SharedEnvironment = z.object({
  PRESENCE_TIMEOUT_SECONDS: positiveWholeNumber.default(30),
  REVEAL_RATE_EXPLORER: positiveWholeNumber.default(30), // characters per second
  REVEAL_RATE_PRETENDER: positiveWholeNumber.default(120),
});

export type Settings = ReturnType<typeof toSettings>;

// From checked variables to the settings object.
export function toSettings(vars: z.infer<typeof SharedEnvironment>) {
  return {
    presenceTimeoutSeconds: vars.PRESENCE_TIMEOUT_SECONDS,
    revealRateCharsPerSecond: { explorer: vars.REVEAL_RATE_EXPLORER, pretender: vars.REVEAL_RATE_PRETENDER },
  };
}

// Throws one error naming every invalid variable, so a misconfigured component stops at start-up.
export function loadSettings(env: Record<string, string | undefined> = process.env): Settings {
  const result = SharedEnvironment.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid settings:\n${z.prettifyError(result.error)}`);
  }
  return toSettings(result.data);
}
