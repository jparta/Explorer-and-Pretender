// Codewords: the word lists' form, refusing an empty list, and drawing from every list.
import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { loadWordLists, makeCodeword } from "./codeword.ts";

const words = await loadWordLists("terminal");

describe("word lists", () => {
  test.each(Object.entries(words))("%s: lowercase letters only, no repeats", (_, list) => {
    expect(list.length).toBeGreaterThanOrEqual(10);
    for (const word of list) expect(word).toMatch(/^[a-z]+$/);
    expect(new Set(list).size).toBe(list.length);
  });

  test("an empty list stops the runner at start-up, naming the file", async () => {
    const dir = pathToFileURL(`${tmpdir()}/words-${crypto.randomUUID()}/`);
    for (const name of ["adjectives", "nouns"]) await Bun.write(new URL(`terminal/${name}.txt`, dir), "word\n");
    await Bun.write(new URL("terminal/verbs.txt", dir), "\n");
    await expect(loadWordLists("terminal", dir)).rejects.toThrow("terminal/verbs.txt");
  });
});

describe("makeCodeword", () => {
  test("is adjective-noun-verb, one word from each list (S3.1, D63)", () => {
    const parts = makeCodeword(words).split("-");
    expect(parts).toHaveLength(3);
    const [adjective, noun, verb] = parts;
    expect(words.adjectives).toContain(adjective!);
    expect(words.nouns).toContain(noun!);
    expect(words.verbs).toContain(verb!);
  });

  test("can draw the first and the last word of every list", () => {
    expect(makeCodeword(words, () => 0)).toBe(
      [words.adjectives[0], words.nouns[0], words.verbs[0]].join("-"),
    );
    expect(makeCodeword(words, () => 0.999999)).toBe(
      [words.adjectives.at(-1), words.nouns.at(-1), words.verbs.at(-1)].join("-"),
    );
  });

  test("is drawn at random, not the same every time", () => {
    const codewords = new Set(Array.from({ length: 20 }, () => makeCodeword(words)));
    expect(codewords.size).toBeGreaterThan(1);
  });
});
