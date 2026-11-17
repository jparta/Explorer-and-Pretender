// Valkey key names and their lifetimes (architecture section 3). The key patterns in
// deploy/base/valkey/users.acl must allow these names; keys.test.ts checks that.

// One stream per Session, holding its events.
export const sessionKey = (sessionId: string) => `session:${sessionId}`;
export const SESSION_EXPIRE_SECONDS = 60; // after the Session ends (D19)
export const SESSION_MAX_ENTRIES = 10_000; // a safety net

// Changes of slot state, for the web server to follow.
export const SLOTS_KEY = "slots";
export const SLOTS_MAX_ENTRIES = 1_000;

// The current state of one slot, a hash with `state` and `sessionId`.
export const slotKey = (slot: number) => `slot:${slot}`;

// Exists while any viewer is present. Its lifetime is the presenceTimeoutSeconds setting.
export const PRESENCE_KEY = "presence";

// Exists while someone watches the slot. The page refreshes it every HEARTBEAT_SECONDS,
// so the expiry must stay longer than that, with room for a late heartbeat.
export const watchingKey = (slot: number) => `watching:${slot}`;
export const WATCHING_EXPIRE_SECONDS = 10;
export const HEARTBEAT_SECONDS = 5;

// The day's spend in dollars, and whether the provider's key limit was reached that day.
export const spendKey = (date: string) => `spend:${date}`;
export const sleepingKey = (date: string) => `sleeping:${date}`;
export const DAILY_KEY_EXPIRE_SECONDS = 2 * 24 * 60 * 60;

// The date in UTC as YYYY-MM-DD, the {date} of spendKey and sleepingKey.
export function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
