// Codewords of the form adjective-noun-verb (S3.1, D60, D63), drawn from word lists
// per kind of Pretender in apps/runner/words/<kind>/, chosen and checked by the author,
// which is how offensive words are kept out (S3.2).
import type { Kind } from "@exhibition/shared";

const wordsDir = new URL("../words/", import.meta.url);

export type WordLists = {
  adjectives: string[];
  nouns: string[];
  verbs: string[];
};

// Refuses an empty list, so the runner stops at start-up rather than failing later,
// when a Codeword is drawn.
export async function loadWordLists(kind: Kind, dir: URL = wordsDir): Promise<WordLists> {
  const read = async (name: string) => {
    const path = `${kind}/${name}.txt`;
    const words = (await Bun.file(new URL(path, dir)).text())
      .split("\n")
      .map((word) => word.trim())
      .filter(Boolean);
    if (words.length === 0) throw new Error(`Word list empty: ${path}`);
    return words;
  };
  return {
    adjectives: await read("adjectives"),
    nouns: await read("nouns"),
    verbs: await read("verbs"),
  };
}

// `random` returns a number in [0, 1), as Math.random does.
export function makeCodeword(words: WordLists, random: () => number = Math.random): string {
  const pick = (list: string[]) => {
    const word = list[Math.floor(random() * list.length)];
    if (word === undefined) throw new Error("Can't draw a word from an empty list");
    return word;
  };
  return [pick(words.adjectives), pick(words.nouns), pick(words.verbs)].join("-");
}
