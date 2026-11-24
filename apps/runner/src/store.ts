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
  SLOT_STATES_KEY,
  SLOT_STATES_MAX_ENTRIES,
  type SlotStateWithSession,
  SlotStatesEvent,
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

export class ValkeyStore {
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
  async readLastEvent(sessionId: string): Promise<SessionEvent | undefined> {
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

  // Writes every slot's state as one event on the slots stream (D65). Its last entry is
  // the current state of every slot, for the web server and for the next runner.
  async writeSlotStates(slots: SlotStateWithSession[]): Promise<void> {
    await this.client.send("XADD", [
      SLOT_STATES_KEY, "MAXLEN", "~", String(SLOT_STATES_MAX_ENTRIES), "*", ...toStreamFields({ type: "slots", slots }),
    ]);
  }

  // Every slot's state as last written, or nothing if none was written yet or the last
  // entry can't be read.
  async readSlotStates(): Promise<SlotStateWithSession[] | undefined> {
    const reply = (await this.client.send("XREVRANGE", [SLOT_STATES_KEY, "+", "-", "COUNT", "1"])) as
      | [string, string[]][]
      | null;
    const fields = reply?.[0]?.[1];
    if (!fields) return undefined;
    const decoded = fromStreamFields(SlotStatesEvent, fields);
    if (!decoded.ok) {
      this.log.warn("unreadable slot states", { error: decoded.error });
      return undefined;
    }
    return decoded.value.slots;
  }

  async isPresent(): Promise<boolean> {
    return (await this.client.send("EXISTS", [PRESENCE_KEY])) === 1;
  }

  async isWatched(slot: number): Promise<boolean> {
    return (await this.client.send("EXISTS", [watchingKey(slot)])) === 1;
  }

  // The day's spend in dollars; a day without a key counts as 0 (architecture 8).
  async readSpendDollars(date: string): Promise<number> {
    const value = await this.client.send("GET", [spendKey(date)]);
    return value === null ? 0 : Number(value);
  }

  // Adds one call's cost and returns the day's total.
  async addSpend(date: string, costDollars: number): Promise<number> {
    const totalDollars = await this.client.send("INCRBYFLOAT", [spendKey(date), String(costDollars)]);
    await this.client.send("EXPIRE", [spendKey(date), String(DAILY_KEY_EXPIRE_SECONDS)]);
    return Number(totalDollars);
  }

  async isSleeping(date: string): Promise<boolean> {
    return (await this.client.send("EXISTS", [sleepingKey(date)])) === 1;
  }

  async setSleeping(date: string): Promise<void> {
    await this.client.send("SET", [sleepingKey(date), "1", "EX", String(DAILY_KEY_EXPIRE_SECONDS)]);
  }
}
