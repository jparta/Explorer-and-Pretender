// The settings of spec section 7 that more than one component reads
// (shared component doc, section 4). Defaults are the spec's starting values.
import { z } from "zod";

const positiveWholeNumber = z.coerce.number().int().positive();

const Environment = z.object({
  SLOTS: positiveWholeNumber.default(3),
  PRESENCE_TIMEOUT_SECONDS: positiveWholeNumber.default(30),
  REVEAL_RATE_EXPLORER: positiveWholeNumber.default(30), // characters per second
  REVEAL_RATE_PRETENDER: positiveWholeNumber.default(120),
});

export type Settings = ReturnType<typeof loadSettings>;

// Throws one error naming every invalid variable, so a misconfigured component stops at start-up.
export function loadSettings(env: Record<string, string | undefined> = process.env) {
  const result = Environment.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid settings:\n${z.prettifyError(result.error)}`);
  }
  const vars = result.data;
  return {
    slots: vars.SLOTS,
    presenceTimeoutSeconds: vars.PRESENCE_TIMEOUT_SECONDS,
    revealRate: { explorer: vars.REVEAL_RATE_EXPLORER, pretender: vars.REVEAL_RATE_PRETENDER },
  };
}
