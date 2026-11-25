// The runner's start-up and shutdown: loads its settings and Secrets, waits for Valkey,
// picks up what a previous runner left, runs a loop per slot, and ends running Sessions
// cleanly on SIGTERM. runner.test.ts runs everything else end to end.
import { loadWordLists } from "./codeword.ts";
import { loadRunnerConfig, readSecretFile } from "./config.ts";
import { isAlive, startHealthServer } from "./health.ts";
import { createModelClient } from "./llm.ts";
import { describeError, errorFields, log } from "./log.ts";
import { createSessionRunner, loadPrompts } from "./runner.ts";
import { Slots } from "./slots.ts";
import { connectValkey, Store } from "./store.ts";

// Where the Secrets are mounted (D37), and the constants of the loop.
const API_KEY_FILE = "/etc/llm-api/LLM_API_KEY";
const VALKEY_PASSWORD_FILE = "/etc/valkey-password/runner";
const HEALTH_PORT = 8080; // the liveness probe's port, named in the Deployment
const TICK_MS = 1_000; // each slot is checked once a second (architecture 6.2)
const STALE_MS = 10_000; // a loop that hasn't ticked for this long fails liveness (D29)
// Per model call: generous while the models are tried, so slow reasoning isn't cut off
// (a timed-out call is still billed, but counts as nothing towards the spend). Three tries
// of this, plus the waits between them, is the longest a Session can stand still before
// it ends as interrupted (runner component doc, section 2.3).
const CALL_TIMEOUT_MS = 5 * 60_000;
const VALKEY_WAIT_MS = 5_000; // how long each start-up check waits for Valkey to answer

// A start-up error, such as a missing setting or Secret file, is logged as a JSON line
// with its stack, and the process exits so Kubernetes restarts the container.
start().catch((error) => {
  log.error("start-up failed", errorFields(error));
  process.exit(1);
});

async function start() {
  const config = loadRunnerConfig();
  const apiKey = await readSecretFile(API_KEY_FILE);
  const valkeyPassword = await readSecretFile(VALKEY_PASSWORD_FILE);

  const client = connectValkey(
    `valkey://runner:${encodeURIComponent(valkeyPassword)}@${config.valkeyHost}:${config.valkeyPort}`,
  );
  const store = new Store(client);

  const slots = new Slots({
    store,
    slotCount: config.slotCount,
    intermissionMs: config.intermissionSeconds * 1000,
    presenceTimeoutMs: config.shared.presenceTimeoutSeconds * 1000,
    dailySpendCapDollars: config.dailySpendCapDollars,
    now: Date.now,
    runSession: createSessionRunner({
      config,
      modelClient: createModelClient({ baseUrl: config.llmBaseUrl, apiKey, timeoutMs: CALL_TIMEOUT_MS }),
      store,
      prompts: await loadPrompts(),
      words: await loadWordLists("terminal"),
    }),
  });

  let loopsStarted = false;
  let stopping = false;
  // Alive while starting up; after that, while every slot loop keeps ticking.
  const health = startHealthServer(
    HEALTH_PORT,
    () => !loopsStarted || isAlive(slots.lastTickAtMs(), Date.now(), STALE_MS),
  );

  // While Valkey is down, the endings wait in the offline queue too, so shutdown waits
  // until Kubernetes kills the pod after its 30 s grace period; the next runner's
  // recover() then ends those Sessions (runner component doc, section 2.1).
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down");
    await slots.shutdown();
    client.close();
    health.stop(true);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  // Valkey may not be reachable yet, right after the cluster starts. Commands then wait in
  // the client's offline queue rather than fail, so each check waits a few seconds for an
  // answer and logs that it's still waiting. If picking up the slot states fails, for
  // example because Valkey went away again, it waits and starts over.
  for (;;) {
    const answered = await Promise.race([
      store.ping().then(() => true),
      Bun.sleep(VALKEY_WAIT_MS).then(() => false),
    ]).catch((error) => {
      log.warn("start-up: Valkey refused", { error: describeError(error) });
      return false;
    });
    if (!answered) {
      log.warn("start-up: waiting for Valkey");
      continue;
    }
    try {
      await slots.recover();
      break;
    } catch (error) {
      log.warn("start-up: picking up the slot states failed, retrying", { error: describeError(error) });
      await Bun.sleep(VALKEY_WAIT_MS);
    }
  }

  log.info("runner started", {
    slots: config.slotCount,
    models: { explorer: config.explorerModel, pretender: config.pretenderModel },
  });
  loopsStarted = true;
  for (let n = 0; n < config.slotCount; n++) {
    void (async () => {
      while (!stopping) {
        await slots.tick(n);
        await Bun.sleep(TICK_MS);
      }
    })();
  }
}
