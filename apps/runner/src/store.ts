// The runner's reads and writes in Valkey (architecture 3), each allowed by the runner's
// user in deploy/base/valkey/users.acl (D46).
import { RedisClient } from "bun";
import type { z } from "zod";
import {
  DAILY_KEY_EXPIRE_SECONDS,
  type Ending,
  fromStreamFields,
  PRESENCE_KEY,
  SESSION_EXPIRE_SECONDS,
  UNENDED_SESSION_EXPIRE_SECONDS,
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

export class ValkeyStore {
  constructor(
    private readonly client: RedisClient,
    private readonly log: Logger = defaultLog,
  ) {}

  async ping(): Promise<void> {
    await this.client.ping();
  }

  async writeEvent(sessionId: string, event: SessionEvent): Promise<void> {
    await this.append(sessionKey(sessionId), SESSION_MAX_ENTRIES, event);
  }

  // Writes session-start and gives the stream a day to live, so it goes away even if its
  // ending is never written (D68).
  async startSession(sessionId: string, slotIndex: number): Promise<void> {
    await this.writeEvent(sessionId, { type: "session-start", sessionId, slot: slotIndex, kind: "terminal" });
    await this.client.expire(sessionKey(sessionId), UNENDED_SESSION_EXPIRE_SECONDS);
  }

  async endSession(sessionId: string, ending: Ending): Promise<void> {
    await this.writeEvent(sessionId, { type: "session-end", ending });
    await this.expireSession(sessionId);
  }

  // Lets an ended Session's stream expire a minute later (D19).
  async expireSession(sessionId: string): Promise<void> {
    await this.client.expire(sessionKey(sessionId), SESSION_EXPIRE_SECONDS);
  }

  // The stream's last event, or nothing if there's no stream or its last entry can't be read.
  async readLastEvent(sessionId: string): Promise<SessionEvent | undefined> {
    return this.readLast(sessionKey(sessionId), SessionEvent, "unreadable stream entry", { sessionId });
  }

  // Writes every slot's state as one event on the slots stream (D65). Its last entry is
  // the current state of every slot, for the web server and for the next runner.
  async writeSlotStates(slots: SlotStateWithSession[]): Promise<void> {
    await this.append(SLOT_STATES_KEY, SLOT_STATES_MAX_ENTRIES, { type: "slots", slots });
  }

  // Every slot's state as last written, or nothing if none was written yet or the last
  // entry can't be read.
  async readSlotStates(): Promise<SlotStateWithSession[] | undefined> {
    return (await this.readLast(SLOT_STATES_KEY, SlotStatesEvent, "unreadable slot states", {}))?.slots;
  }

  // Adds an event to a stream. "~" lets Valkey trim in whole blocks, which is cheaper;
  // the limit is a safety net.
  private async append(key: string, maxEntries: number, event: SessionEvent | SlotStatesEvent): Promise<void> {
    await this.client.xadd(key, "MAXLEN", "~", String(maxEntries), "*", ...toStreamFields(event));
  }

  // A stream's last event, checked against its schema; nothing if the stream is empty, or
  // with a warning if the entry doesn't match.
  private async readLast<T>(
    key: string,
    schema: z.ZodType<T>,
    warning: string,
    logFields: Record<string, unknown>,
  ): Promise<T | undefined> {
    const fields = (await this.client.xrevrange(key, "+", "-", "COUNT", "1"))?.[0]?.[1];
    if (!fields) return undefined;
    const decoded = fromStreamFields(schema, fields);
    if (!decoded.ok) {
      this.log.warn(warning, { ...logFields, error: decoded.error });
      return undefined;
    }
    return decoded.value;
  }

  async isPresent(): Promise<boolean> {
    return this.exists(PRESENCE_KEY);
  }

  async isWatched(slotIndex: number): Promise<boolean> {
    return this.exists(watchingKey(slotIndex));
  }

  // The day's spend in dollars; a day without a key counts as 0 (architecture 8).
  async readSpendDollars(date: string): Promise<number> {
    const value = await this.client.get(spendKey(date));
    return value === null ? 0 : Number(value);
  }

  // Adds one call's cost and returns the day's total.
  async addSpend(date: string, costDollars: number): Promise<number> {
    const totalDollars = await this.client.incrbyfloat(spendKey(date), costDollars);
    await this.client.expire(spendKey(date), DAILY_KEY_EXPIRE_SECONDS);
    return Number(totalDollars);
  }

  async isSleeping(date: string): Promise<boolean> {
    return this.exists(sleepingKey(date));
  }

  private async exists(key: string): Promise<boolean> {
    return this.client.exists(key);
  }

  async setSleeping(date: string): Promise<void> {
    await this.client.set(sleepingKey(date), "1", "EX", DAILY_KEY_EXPIRE_SECONDS);
  }
}
