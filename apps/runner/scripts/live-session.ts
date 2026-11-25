// A live test: one Session through the runner's own code, against the real model provider.
// Run by hand (bun run test:live, or test:live --full), never in check:all: it costs money,
// its answers vary, and it needs the real API key, read from .env. Checks the shape of
// what happens (session-start, messages, an ending, a cost), not what the models say, and
// prints the conversation for reading. Valkey is a throwaway container, so Docker must run.
import { type Ending, type SessionEvent, sessionKey, utcDate } from "@exhibition/shared";
import { startValkey } from "@exhibition/shared/testing";
import { loadWordLists } from "../src/codeword.ts";
import { loadRunnerConfig } from "../src/config.ts";
import { createModelClient, MODEL_CALL_TIMEOUT_MS } from "../src/llm.ts";
import { createSessionRunner, loadPrompts } from "../src/runner.ts";
import { connectValkey, ValkeyStore } from "../src/store.ts";
import { readStreamEvents } from "../src/valkey-test-helpers.ts";

const repoRoot = new URL("../../../", import.meta.url);
const SHORT_EXCHANGE_CAP = 2;

const isFull = process.argv.includes("--full");
const apiKey = process.env.LLM_API_KEY;
if (!apiKey || apiKey.startsWith("placeholder")) {
  console.error("No real LLM_API_KEY in .env: the live test needs one.");
  process.exit(1);
}

// The settings as the cluster has them: the literals of both ConfigMaps.
async function configMapLiterals(path: string): Promise<Record<string, string>> {
  const kustomization = Bun.YAML.parse(await Bun.file(new URL(path, repoRoot)).text()) as {
    configMapGenerator: { literals: string[] }[];
  };
  const literals = kustomization.configMapGenerator.flatMap((generator) => generator.literals);
  return Object.fromEntries(literals.map((literal) => literal.split(/=(.*)/s).slice(0, 2) as [string, string]));
}

const valkey = await startValkey();
const valkeyClient = connectValkey(valkey.urlFor("runner"));
try {
  const config = loadRunnerConfig({
    ...(await configMapLiterals("deploy/base/kustomization.yaml")),
    ...(await configMapLiterals("deploy/base/runner/kustomization.yaml")),
    ...(isFull ? {} : { EXCHANGE_CAP: String(SHORT_EXCHANGE_CAP) }),
    // Pacing isn't under test here, so messages are written as soon as they arrive.
    REVEAL_RATE_EXPLORER_CHARS_PER_SECOND: "1000000",
    REVEAL_RATE_PRETENDER_CHARS_PER_SECOND: "1000000",
  });
  const store = new ValkeyStore(valkeyClient);
  const runSession = createSessionRunner({
    config,
    modelClient: createModelClient({ baseUrl: config.llmBaseUrl, apiKey, timeoutMs: MODEL_CALL_TIMEOUT_MS }),
    store,
    prompts: await loadPrompts(),
    words: await loadWordLists("terminal"),
  });

  const sessionId = crypto.randomUUID();
  const startedAtMs = Date.now();
  console.log(
    `Live Session: exchange cap ${config.exchangeCap}, models ${config.explorerModel} / ${config.pretenderModel}, ` +
      `reasoning effort ${config.reasoningEffort.explorer} / ${config.reasoningEffort.pretender}`,
  );
  await store.startSession(sessionId, 0);
  const ending = await runSession(0, sessionId, new AbortController().signal);
  await store.endSession(sessionId, ending);
  const minutes = ((Date.now() - startedAtMs) / 60_000).toFixed(1);

  const events = (await readStreamEvents(valkey.adminClient, sessionKey(sessionId))) as SessionEvent[];
  const messages = events.filter((event) => event.type === "message");
  for (const message of messages) console.log(`\n--- ${message.role}\n${message.text}`);
  const spentDollars = await store.readSpendDollars(utcDate());
  console.log(`\nEnding: ${ending}, ${messages.length} messages, ${minutes} min, $${spentDollars.toFixed(4)}`);

  // The endings a working Session can have; interrupted and sleeping mean a call failed.
  const SUCCESSFUL_ENDINGS: Ending[] = ["found", "ran-its-course"];
  // Each entry is its problem when the check fails, and false when it passes.
  const problems = [
    events[0]?.type !== "session-start" && "the stream doesn't open with session-start",
    events.at(-1)?.type !== "session-end" && "the stream doesn't close with session-end",
    messages.length === 0 && "no messages",
    !SUCCESSFUL_ENDINGS.includes(ending) && `the Session ended as ${ending}`,
    spentDollars <= 0 && "no cost was counted",
  ].filter((problem) => problem !== false);
  if (problems.length > 0) {
    console.error(["FAILED:", ...problems.map((problem) => `- ${problem}`)].join("\n"));
    process.exitCode = 1;
  } else {
    console.log("PASSED");
  }
} finally {
  valkeyClient.close();
  valkey.stop();
}
