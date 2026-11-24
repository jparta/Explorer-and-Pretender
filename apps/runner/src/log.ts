// Structured logs: one JSON object per line on stdout (D47).

export type Logger = Record<"info" | "warn" | "error", (msg: string, fields?: Record<string, unknown>) => void>;

const logAtLevel = (level: string) => (msg: string, fields: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ time: new Date().toISOString(), level, component: "runner", msg, ...fields }));
};

export const log: Logger = { info: logAtLevel("info"), warn: logAtLevel("warn"), error: logAtLevel("error") };

// Errors don't survive JSON.stringify. The message alone, for errors logged often,
// such as the start-up retries while Valkey isn't up yet.
export const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The message and the stack, for top-level catches, so a failure can be traced from the logs.
export const errorFields = (error: unknown) => ({
  error: describeError(error),
  ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
});
