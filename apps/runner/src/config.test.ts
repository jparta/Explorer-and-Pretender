// The runner's settings and Secret files: values, defaults, and refusing what's missing or invalid.
import { describe, expect, test } from "bun:test";
import { loadRunnerConfig, readSecretFile } from "./config.ts";

const models = { EXPLORER_MODEL: "vendor/explorer", PRETENDER_MODEL: "vendor/pretender" };

describe("loadRunnerConfig", () => {
  test("starts with only the models set", () => {
    const config = loadRunnerConfig(models);
    expect(config.explorerModel).toBe("vendor/explorer");
    expect(config.pretenderModel).toBe("vendor/pretender");
    expect(config.slotCount).toBeGreaterThan(0);
  });

  test("takes each value from its variable, its own and the shared ones", () => {
    const config = loadRunnerConfig({
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
    });
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
      loadRunnerConfig({ ...models, EXCHANGE_CAP: "0", DAILY_SPEND_CAP_DOLLARS: "abc", PRESENCE_TIMEOUT_SECONDS: "-1" });
    expect(load).toThrow(/EXCHANGE_CAP/);
    expect(load).toThrow(/DAILY_SPEND_CAP_DOLLARS/);
    expect(load).toThrow(/PRESENCE_TIMEOUT_SECONDS/);
  });

  test("refuses a base URL that isn't a URL", () => {
    expect(() => loadRunnerConfig({ ...models, LLM_BASE_URL: "openrouter" })).toThrow(/LLM_BASE_URL/);
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
