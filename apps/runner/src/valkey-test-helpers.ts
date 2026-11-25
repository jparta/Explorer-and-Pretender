// For tests: read streams back as events, checked against the shared schemas.
import type { RedisClient } from "bun";
import { fromStreamFields, SessionEvent, SlotStatesEvent } from "@exhibition/shared";
import { z } from "zod";

const StreamEvent = z.union([SessionEvent, SlotStatesEvent]);

// A stream's events, oldest first. An entry that doesn't match its schema fails the test.
export async function readStreamEvents(client: RedisClient, key: string): Promise<z.infer<typeof StreamEvent>[]> {
  const reply = (await client.send("XRANGE", [key, "-", "+"])) as [string, string[]][];
  return reply.map(([id, fields]) => {
    const decoded = fromStreamFields(StreamEvent, fields);
    if (!decoded.ok) throw new Error(`${key} ${id}: ${decoded.error}`);
    return decoded.value;
  });
}
