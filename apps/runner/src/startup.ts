// Start-up's wait for Valkey (runner component doc, section 2.1), apart from main.ts so
// it can be tested.
import { describeError, type Logger } from "./log.ts";

// Resolves once ping answers. While Valkey doesn't answer, commands wait in the client's
// offline queue, so each ping gets answerTimeoutMs before the next; a ping that's refused,
// such as one with a wrong password, is tried again after retryPauseMs. Either way it logs
// that it's still waiting.
export async function waitUntilValkeyAnswers(
  ping: () => Promise<unknown>,
  options: { answerTimeoutMs: number; retryPauseMs: number; log: Logger; sleepMs?: (ms: number) => Promise<void> },
): Promise<void> {
  const sleepMs = options.sleepMs ?? ((ms: number) => Bun.sleep(ms));
  for (;;) {
    const outcome = await Promise.race([
      ping().then(() => "answered" as const),
      sleepMs(options.answerTimeoutMs).then(() => "no answer" as const),
    ]).catch((error) => {
      options.log.warn("start-up: Valkey refused", { error: describeError(error) });
      return "refused" as const;
    });
    if (outcome === "answered") return;
    // No answer yet: the answer timeout already took its time, so ping again at once.
    if (outcome === "no answer") options.log.warn("start-up: waiting for Valkey");
    // Refused: pause before the next ping, which the loop then sends.
    if (outcome === "refused") await sleepMs(options.retryPauseMs);
  }
}
