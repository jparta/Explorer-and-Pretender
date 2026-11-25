// The settings of spec section 7 that more than one component reads
// (shared component doc, section 4). The values live only in the ConfigMaps, so the
// code has no defaults: a missing variable stops the component at start-up.
import { z } from "zod";

export const positiveWholeNumber = z.coerce.number().int().positive();

// Exported so a component can extend it with its own settings and check everything in
// one go, getting one error that names every missing or invalid variable.
export const SharedEnvironment = z.object({
  PRESENCE_TIMEOUT_SECONDS: positiveWholeNumber,
  REVEAL_RATE_EXPLORER_CHARS_PER_SECOND: positiveWholeNumber,
  REVEAL_RATE_PRETENDER_CHARS_PER_SECOND: positiveWholeNumber,
});

export type SharedSettings = ReturnType<typeof toSettings>;

// From checked variables to the settings object.
export function toSettings(parsedEnv: z.infer<typeof SharedEnvironment>) {
  return {
    presenceTimeoutSeconds: parsedEnv.PRESENCE_TIMEOUT_SECONDS,
    revealRateCharsPerSecond: { explorer: parsedEnv.REVEAL_RATE_EXPLORER_CHARS_PER_SECOND, pretender: parsedEnv.REVEAL_RATE_PRETENDER_CHARS_PER_SECOND },
  };
}

// Checks the environment against a schema. Throws one error naming every missing or
// invalid variable, so a misconfigured component stops at start-up.
export function parseEnvironment<Schema extends z.ZodType>(
  schema: Schema,
  env: Record<string, string | undefined>,
): z.infer<Schema> {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid settings:
${z.prettifyError(result.error)}`);
  return result.data;
}

export function loadSharedSettings(env: Record<string, string | undefined> = process.env): SharedSettings {
  return toSettings(parseEnvironment(SharedEnvironment, env));
}
