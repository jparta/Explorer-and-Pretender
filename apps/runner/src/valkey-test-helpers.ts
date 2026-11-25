// For tests: read keys back as plain values, whichever shape the client returns.
import type { RedisClient } from "bun";
import { EVENT_FIELD } from "@exhibition/shared";
import { fieldsToObject } from "./store.ts";

// A hash as an object. RESP3 returns a map, RESP2 a flat list of field, value, ...
export async function hash(client: RedisClient, key: string): Promise<Record<string, string>> {
  const reply = await client.send("HGETALL", [key]);
  return Array.isArray(reply) ? fieldsToObject(reply) : (reply ?? {});
}

// A stream's events, oldest first, parsed from their one JSON field.
export async function entries(client: RedisClient, key: string): Promise<unknown[]> {
  const reply = (await client.send("XRANGE", [key, "-", "+"])) as [string, string[]][];
  return reply.map(([, fields]) => JSON.parse(fieldsToObject(fields)[EVENT_FIELD]!));
}
