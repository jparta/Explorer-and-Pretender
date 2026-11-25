// The runner's reads and writes in Valkey (architecture 3), each allowed by the runner's
// user in deploy/base/valkey/users.acl (D46).
import { RedisClient } from "bun";
import {
  DAILY_KEY_EXPIRE_SECONDS,
  type Ending,
  fromStreamFields,
  PRESENCE_KEY,
  SESSION_EXPIRE_SECONDS,
  SESSION_MAX_ENTRIES,
  SessionEvent,
  sessionKey,
  SLOT_COUNT_KEY,
  SLOTS_KEY,
  SLOTS_MAX_ENTRIES,
  slotKey,
  SlotState,
  type SlotStatus,
  sleepingKey,
  spendKey,
  toStreamFields,
  watchingKey,
} from "@exhibition/shared";
import { log as defaultLog, type Logger } from "./log.ts";

// A client that keeps trying to reconnect for as long as Valkey is away. While it's
// disconnected, commands wait in its *offline queue* and are sent once it's back, so a
// short Valkey restart is only a stall. Bun's default gives up after 20 attempts, about
// 30 s, and then fails every command for good, even once Valkey is back (runner
// component doc, section 2.5). The highest limit Bun accepts, at most 2 s per attempt,
// is about 270 years.
export function connectValkey(url: string): RedisClient {
  return new RedisClient(url, { autoReconnect: true, maxRetries: 2 ** 32 - 1, enableOfflineQueue: true });
}

// A flat list of field, value, field, value, ... as an object.
export function fieldsToObject(list: string[]): Record<string, string> {
  const object: Record<string, string> = {};
  for (let i = 0; i + 1 < list.length; i += 2) {
    const field = list[i];
    const value = list[i + 1];
    if (field !== undefined && value !== undefined) object[field] = value;
  }
  return object;
}

export class Store {
  constructor(
    private readonly client: RedisClient,
    private readonly log: Logger = defaultLog,
  ) {}

  async ping(): Promise<void> {
    await this.client.send("PING", []);
  }

  // "~" lets Valkey trim in whole blocks, which is cheaper; the limit is a safety net.
  async writeEvent(sessionId: string, event: SessionEvent): Promise<void> {
    await this.client.send("XADD", [
      sessionKey(sessionId), "MAXLEN", "~", String(SESSION_MAX_ENTRIES), "*", ...toStreamFields(event),
    ]);
  }

  async endSession(sessionId: string, ending: Ending): Promise<void> {
    await this.writeEvent(sessionId, { type: "session-end", ending });
    await this.expireSession(sessionId);
  }

  // Lets an ended Session's stream expire a minute later (D19).
  async expireSession(sessionId: string): Promise<void> {
    await this.client.send("EXPIRE", [sessionKey(sessionId), String(SESSION_EXPIRE_SECONDS)]);
  }

  // The stream's last event, or nothing if there's no stream or its last entry can't be read.
  async lastEvent(sessionId: string): Promise<SessionEvent | undefined> {
    const reply = (await this.client.send("XREVRANGE", [sessionKey(sessionId), "+", "-", "COUNT", "1"])) as
      | [string, string[]][]
      | null;
    const fields = reply?.[0]?.[1];
    if (!fields) return undefined;
    const decoded = fromStreamFields(SessionEvent, fields);
    if (!decoded.ok) {
      this.log.warn("unreadable stream entry", { sessionId, error: decoded.error });
      return undefined;
    }
    return decoded.value;
  }

  // Writes slot:{n} in one command, then announces the change on the slots stream. A
  // state without a Session writes an empty sessionId, which means no Session
  // (architecture 3).
  async setSlot(status: SlotStatus): Promise<void> {
    await this.client.send("HSET", [slotKey(status.slot), "state", status.state, "sessionId", status.sessionId ?? ""]);
    await this.client.send("XADD", [
      SLOTS_KEY, "MAXLEN", "~", String(SLOTS_MAX_ENTRIES), "*", ...toStreamFields(status),
    ]);
  }

  // The slot's state, or nothing if it was never written or holds an unknown state.
  async readSlot(slot: number): Promise<SlotStatus | undefined> {
    const reply = await this.client.send("HGETALL", [slotKey(slot)]);
    const fields: Record<string, string> = Array.isArray(reply) ? fieldsToObject(reply) : (reply ?? {});
    if (fields.state === undefined) return undefined;
    const state = SlotState.safeParse(fields.state);
    if (!state.success) {
      this.log.warn("unknown slot state", { slot, state: fields.state });
      return undefined;
    }
    return {
      type: "slot",
      slot,
      state: state.data,
      ...(fields.sessionId ? { sessionId: fields.sessionId } : {}),
    };
  }

  async deleteSlot(slot: number): Promise<void> {
    await this.client.send("DEL", [slotKey(slot)]);
  }

  // The slot count the last runner wrote (D58), or nothing on a first start.
  async readSlotCount(): Promise<number | undefined> {
    const value = await this.client.send("GET", [SLOT_COUNT_KEY]);
    return value === null ? undefined : Number(value);
  }

  async writeSlotCount(count: number): Promise<void> {
    await this.client.send("SET", [SLOT_COUNT_KEY, String(count)]);
  }

  async isPresent(): Promise<boolean> {
    return (await this.client.send("EXISTS", [PRESENCE_KEY])) === 1;
  }

  async isWatched(slot: number): Promise<boolean> {
    return (await this.client.send("EXISTS", [watchingKey(slot)])) === 1;
  }

  // The day's spend in dollars; a day without a key counts as 0 (architecture 8).
  async spend(date: string): Promise<number> {
    const value = await this.client.send("GET", [spendKey(date)]);
    return value === null ? 0 : Number(value);
  }

  // Adds one call's cost and returns the day's total.
  async addSpend(date: string, costDollars: number): Promise<number> {
    const total = await this.client.send("INCRBYFLOAT", [spendKey(date), String(costDollars)]);
    await this.client.send("EXPIRE", [spendKey(date), String(DAILY_KEY_EXPIRE_SECONDS)]);
    return Number(total);
  }

  async isSleeping(date: string): Promise<boolean> {
    return (await this.client.send("EXISTS", [sleepingKey(date)])) === 1;
  }

  async setSleeping(date: string): Promise<void> {
    await this.client.send("SET", [sleepingKey(date), "1", "EX", String(DAILY_KEY_EXPIRE_SECONDS)]);
  }
}
