// The runner's settings and Secret files: values, defaults, and refusing what's missing or invalid.
import { describe, expect, test } from "bun:test";
import { loadRunnerConfig, readSecretFile } from "./config.ts";

const models = { EXPLORER_MODEL: "vendor/explorer", PRETENDER_MODEL: "vendor/pretender" };
// Every setting, the runner's and the shared ones.
const env = {
  ...models,
  SLOT_COUNT: "2",
  EXCHANGE_CAP: "4",
  INTERMISSION_SECONDS: "7",
  DAILY_SPEND_CAP_DOLLARS: "0.5",
  MAX_MESSAGE_TOKENS: "300",
  LLM_BASE_URL: "http://localhost:11434/v1",
  VALKEY_HOST: "localhost",
  VALKEY_PORT: "6380",
  PRESENCE_TIMEOUT_SECONDS: "45",
  REVEAL_RATE_EXPLORER_CHARS_PER_SECOND: "30",
  REVEAL_RATE_PRETENDER_CHARS_PER_SECOND: "120",
  EXPLORER_REASONING_EFFORT: "low",
  PRETENDER_REASONING_EFFORT: "none",
};

describe("loadRunnerConfig", () => {
  test("refuses to start with settings missing, naming each: the values live only in the ConfigMaps", () => {
    const load = () => loadRunnerConfig(models);
    for (const name of ["SLOT_COUNT", "EXCHANGE_CAP", "INTERMISSION_SECONDS", "VALKEY_HOST", "PRESENCE_TIMEOUT_SECONDS"]) {
      expect(load).toThrow(new RegExp(name));
    }
  });

  test("takes each value from its variable, its own and the shared ones", () => {
    const config = loadRunnerConfig(env);
    expect(config).toMatchObject({
      slotCount: 2,
      exchangeCap: 4,
      intermissionSeconds: 7,
      dailySpendCapDollars: 0.5,
      maxMessageTokens: 300,
      llmBaseUrl: "http://localhost:11434/v1",
      valkeyHost: "localhost",
      valkeyPort: 6380,
    });
    expect(config.sharedSettings.presenceTimeoutSeconds).toBe(45);
  });

  test("refuses to start without models", () => {
    const load = () => loadRunnerConfig({});
    expect(load).toThrow(/EXPLORER_MODEL/);
    expect(load).toThrow(/PRETENDER_MODEL/);
  });

  test("one error names every invalid variable, the runner's and the shared ones", () => {
    const load = () =>
      loadRunnerConfig({ ...env, EXCHANGE_CAP: "0", DAILY_SPEND_CAP_DOLLARS: "abc", PRESENCE_TIMEOUT_SECONDS: "-1" });
    expect(load).toThrow(/EXCHANGE_CAP/);
    expect(load).toThrow(/DAILY_SPEND_CAP_DOLLARS/);
    expect(load).toThrow(/PRESENCE_TIMEOUT_SECONDS/);
  });

  test("takes each role's reasoning effort, from OpenRouter's values", () => {
    expect(loadRunnerConfig(env).reasoningEffort).toEqual({ explorer: "low", pretender: "none" });
  });

  test("refuses a reasoning effort OpenRouter doesn't know", () => {
    expect(() => loadRunnerConfig({ ...env, EXPLORER_REASONING_EFFORT: "extreme" })).toThrow(/EXPLORER_REASONING_EFFORT/);
  });

  test("refuses a base URL that isn't a URL", () => {
    expect(() => loadRunnerConfig({ ...env, LLM_BASE_URL: "openrouter" })).toThrow(/LLM_BASE_URL/);
  });
});

describe("readSecretFile", () => {
  const writeTempFile = async (content: string) => {
    const path = `${process.env.TEMP ?? "/tmp"}/runner-secret-${crypto.randomUUID()}`;
    await Bun.write(path, content);
    return path;
  };

  test("reads the value without a trailing newline", async () => {
    expect(await readSecretFile(await writeTempFile("sk-or-123\n"))).toBe("sk-or-123");
  });

  test("refuses an empty file, naming the file and nothing else", async () => {
    const path = await writeTempFile(" \n");
    await expect(readSecretFile(path)).rejects.toThrow(`Secret file empty: ${path}`);
  });

  test("refuses a missing file, naming it", async () => {
    await expect(readSecretFile("/no/such/file")).rejects.toThrow("Secret file missing: /no/such/file");
  });
});
