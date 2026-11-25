// The events of architecture section 4, as Zod schemas. Each TypeScript type is
// derived from its schema, so the compile-time type and the runtime check can't drift.
// Readers check every event before using it (shared component doc, section 2.1).
import { z } from "zod";

// Slot indexes start from 0 (shared component doc, section 2.3).
const slotIndex = z.number().int().nonnegative();

export const Role = z.enum(["explorer", "pretender"]);
export type Role = z.infer<typeof Role>;

export const Ending = z.enum(["found", "ran-its-course", "interrupted", "sleeping"]);
export type Ending = z.infer<typeof Ending>;

// Phase 1 has one kind of Pretender; more come in Phase 3.
export const PretenderKind = z.enum(["terminal"]);
export type PretenderKind = z.infer<typeof PretenderKind>;

export const SessionEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session-start"),
    sessionId: z.string().min(1),
    slot: slotIndex,
    kind: PretenderKind,
  }),
  z.object({
    type: z.literal("message"),
    role: Role,
    text: z.string(),
    // Set when this Explorer message contains the Codeword (architecture section 6.3).
    codeword: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("session-end"),
    ending: Ending,
  }),
]);
export type SessionEvent = z.infer<typeof SessionEvent>;

// The message event on its own, as the conversation writes it.
export type MessageEvent = Extract<SessionEvent, { type: "message" }>;

export const SlotState = z.enum(["idle", "running", "intermission", "sleeping"]);
export type SlotState = z.infer<typeof SlotState>;

// One slot's state, with its Session while it's running and during the intermission.
export const SlotStateWithSession = z.object({
  state: SlotState,
  sessionId: z.string().min(1).optional(),
});
export type SlotStateWithSession = z.infer<typeof SlotStateWithSession>;

// Every slot's state, written whenever one changes (D65). A slot's position in the list
// is its index, and the list's length is the slot count.
export const SlotStatesEvent = z.object({
  type: z.literal("slots"),
  slots: z.array(SlotStateWithSession),
});
export type SlotStatesEvent = z.infer<typeof SlotStatesEvent>;

// What the browser receives over SSE: a Session event tagged with its slot, or every
// slot's state. A session-start then carries its slot twice, both the same (D55).
export const SseEvent = z.union([
  SessionEvent.and(z.object({ slot: slotIndex })),
  SlotStatesEvent,
]);
export type SseEvent = z.infer<typeof SseEvent>;

// --- Stream entries (shared component doc, section 2.2) ---

// The one field of each stream entry, holding the event as JSON.
export const EVENT_FIELD = "event";

export type Decoded<T> = { ok: true; value: T } | { ok: false; error: string };

// The field-value pairs for XADD: ["event", "<json>"].
export function toStreamFields(event: SessionEvent | SlotStatesEvent): [string, string] {
  return [EVENT_FIELD, JSON.stringify(event)];
}

// Reads an entry's fields, as Valkey returns them: [field, value, field, value, ...].
export function fromStreamFields<T>(schema: z.ZodType<T>, fields: readonly string[]): Decoded<T> {
  const index = fields.findIndex((field, i) => i % 2 === 0 && field === EVENT_FIELD);
  const json = index === -1 ? undefined : fields[index + 1];
  if (json === undefined) {
    return { ok: false, error: `no "${EVENT_FIELD}" field` };
  }
  return parseAndValidateJson(schema, json);
}

// Parses and checks one event's JSON, as the browser does with SSE data.
export function parseAndValidateJson<T>(schema: z.ZodType<T>, json: string): Decoded<T> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
  const result = schema.safeParse(data);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: z.prettifyError(result.error) };
}
