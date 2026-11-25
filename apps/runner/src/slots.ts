// The slot loops (architecture 6.1, 6.2): each slot is checked once a second, a *tick*,
// and moves between idle, running, intermission and sleeping. The runner is the only
// writer of slot state (D24 keeps it to one runner), so the state here is the truth and
// Valkey's copy is for the web server and for the next runner after a restart. Doesn't
// touch the network itself: Valkey, the Sessions and the clock are passed in.
import { type Ending, type SlotState, utcDate } from "@exhibition/shared";
import { errorFields, log as defaultLog, type Logger } from "./log.ts";
import type { Store } from "./store.ts";

export type RunSession = (slot: number, sessionId: string, signal: AbortSignal) => Promise<Ending>;

export type SlotsOptions = {
  store: Store;
  slotCount: number;
  intermissionMs: number;
  presenceTimeoutMs: number;
  dailySpendCapDollars: number;
  now: () => number; // milliseconds since the epoch
  runSession: RunSession;
  newSessionId?: () => string;
  log?: Logger;
};

// Why the runner stopped a Session: nobody was present, or the runner is shutting down.
type StopReason = "absent" | "shutdown";

// A Session that has ended, and why.
type Finished = { sessionId: string; ending: Ending; stopReason?: StopReason };

type Running = {
  state: "running";
  sessionId: string;
  abort: AbortController;
  stopReason?: StopReason;
  presentAtMs: number; // when presence was last confirmed
  done: Promise<void>;
};

type Intermission = {
  state: "intermission";
  sessionId?: string;
  intermissionEndsAtMs: number;
  // An ending that couldn't be written to Valkey yet; the next tick tries again.
  unrecorded?: Finished;
};

type Slot = { state: "idle" } | Running | Intermission | { state: "sleeping" };

export class Slots {
  private readonly slots: Slot[];
  private readonly ticks: number[];
  private readonly log: Logger;
  private readonly newSessionId: () => string;
  private stopping = false;

  constructor(private readonly options: SlotsOptions) {
    this.slots = Array.from({ length: options.slotCount }, (): Slot => ({ state: "idle" }));
    this.ticks = Array.from({ length: options.slotCount }, () => 0);
    this.log = options.log ?? defaultLog;
    this.newSessionId = options.newSessionId ?? (() => crypto.randomUUID());
  }

  // On start-up: picks up the slot states a previous runner left (architecture 9).
  async recover(): Promise<void> {
    const { store, slotCount } = this.options;

    // Slots beyond a lowered count: end their Sessions and remove them, so no reader
    // sees them running forever. Then write the count for the web server (D58).
    const previousCount = (await store.readSlotCount()) ?? 0;
    for (let n = slotCount; n < previousCount; n++) {
      const previousState = await store.readSlot(n);
      if (previousState?.state === "running" && previousState.sessionId) {
        await this.endIfUnended(n, previousState.sessionId);
      }
      await store.deleteSlot(n);
    }
    await store.writeSlotCount(slotCount);

    for (let n = 0; n < slotCount; n++) {
      const previousState = await store.readSlot(n);
      switch (previousState?.state) {
        case "running":
          // Only a crash leaves a slot running: a clean shutdown moves it to its intermission.
          if (previousState.sessionId) await this.endIfUnended(n, previousState.sessionId);
          await this.enter(n, this.intermission(previousState.sessionId));
          break;
        case "intermission":
          this.slots[n] = this.intermission(previousState.sessionId);
          break;
        case "sleeping":
          this.slots[n] = { state: "sleeping" };
          break;
        case "idle":
          this.slots[n] = { state: "idle" };
          break;
        default:
          await this.enter(n, { state: "idle" });
      }
    }
  }

  async tickAll(): Promise<void> {
    await Promise.all(this.slots.map((_, n) => this.tick(n)));
  }

  // One check of slot n. Errors are logged, and the next tick tries again.
  async tick(n: number): Promise<void> {
    try {
      if (!this.stopping) await this.step(n);
    } catch (error) {
      this.log.error("slot check failed", { slot: n, ...errorFields(error) });
    } finally {
      this.ticks[n] = this.options.now();
    }
  }

  // When each slot last finished a tick, for the liveness probe.
  lastTickAtMs(): number[] {
    return [...this.ticks];
  }

  // Resolves once slot n's running Session, if any, has ended and its ending is handled.
  async whenFinished(n: number): Promise<void> {
    const slot = this.slots[n];
    if (slot?.state === "running") await slot.done;
  }

  // Ends running Sessions as interrupted and starts their intermission (architecture 9).
  async shutdown(): Promise<void> {
    this.stopping = true;
    const running = this.slots.filter((slot): slot is Running => slot.state === "running");
    for (const slot of running) this.stop(slot, "shutdown");
    await Promise.all(running.map((slot) => slot.done));
  }

  private async step(n: number): Promise<void> {
    const { store, now } = this.options;
    const slot = this.slots[n];
    if (!slot) throw new Error(`No slot ${n}`);
    switch (slot.state) {
      case "idle":
        if (await this.asleep()) await this.enter(n, { state: "sleeping" });
        else if (await store.isWatched(n)) await this.start(n);
        return;
      case "running":
        await this.checkPresence(slot);
        return;
      case "intermission":
        if (slot.unrecorded) await this.writeEndingAndMoveOn(n, slot.unrecorded);
        else if (await this.asleep()) await this.enter(n, { state: "sleeping" });
        else if (now() >= slot.intermissionEndsAtMs) {
          if (await store.isWatched(n)) await this.start(n);
          else await this.enter(n, { state: "idle" });
        }
        return;
      case "sleeping":
        if (!(await this.asleep())) await this.enter(n, { state: "idle" });
        return;
    }
  }

  // The machine sleeps once the day's spend reaches the cap, or once the provider
  // refused a call because the key's daily limit or the prepaid credit is spent (S6.2,
  // D59). The date is always today's in UTC, so sleeping ends at midnight.
  private async asleep(): Promise<boolean> {
    const { store, now, dailySpendCapDollars } = this.options;
    const date = utcDate(new Date(now()));
    return (await store.isSleeping(date)) || (await store.spend(date)) >= dailySpendCapDollars;
  }

  // Nobody present: stop the Session. Presence that can't be checked because of an error
  // counts as present until the timeout runs out (runner component doc, section 2.5).
  private async checkPresence(slot: Running): Promise<void> {
    const { store, now, presenceTimeoutMs } = this.options;
    let present: boolean;
    try {
      present = await store.isPresent();
    } catch (error) {
      if (now() - slot.presentAtMs > presenceTimeoutMs) this.stop(slot, "absent");
      throw error;
    }
    if (present) slot.presentAtMs = now();
    else this.stop(slot, "absent");
  }

  private stop(slot: Running, reason: StopReason): void {
    slot.stopReason ??= reason;
    slot.abort.abort();
  }

  // Announces a new Session: the stream first, then the slot state, so the stream
  // exists before anyone is told about it (architecture 6.2).
  private async start(n: number): Promise<void> {
    const { store, now, runSession } = this.options;
    const sessionId = this.newSessionId();
    await store.writeEvent(sessionId, { type: "session-start", sessionId, slot: n, kind: "terminal" });
    try {
      await store.setSlot({ type: "slot", slot: n, state: "running", sessionId });
    } catch (error) {
      // Nobody was told about this Session: end its stream so it doesn't stay behind.
      await store.endSession(sessionId, "interrupted").catch(() => {});
      throw error;
    }

    const abort = new AbortController();
    const running: Running = { state: "running", sessionId, abort, presentAtMs: now(), done: Promise.resolve() };
    this.slots[n] = running;
    this.log.info("Session started", { slot: n, sessionId });
    running.done = runSession(n, sessionId, abort.signal)
      .catch((error): Ending => {
        this.log.error("Session failed", { slot: n, sessionId, ...errorFields(error) });
        return "interrupted";
      })
      .then((ending) => {
        this.log.info("Session ended", { slot: n, sessionId, ending });
        return this.writeEndingAndMoveOn(n, { sessionId, ending, stopReason: running.stopReason });
      });
  }

  // Writes the ending, then moves the slot on: to idle if nobody is there to see the
  // ending, to sleeping if the machine sleeps now, otherwise to the intermission. If a
  // write fails, the slot waits in its intermission and the next tick tries again, so
  // the stream still gets its session-end and its expiry.
  private async writeEndingAndMoveOn(n: number, finished: Finished): Promise<void> {
    const { store, now } = this.options;
    try {
      // A retry checks first whether the earlier try got as far as session-end, and
      // then still sets the expiry, which may be what failed.
      const isRetry = this.slots[n]?.state === "intermission" && this.slots[n].unrecorded !== undefined;
      if (isRetry && (await store.lastEvent(finished.sessionId))?.type === "session-end") {
        await store.expireSession(finished.sessionId);
      } else {
        await store.endSession(finished.sessionId, finished.ending);
      }
      if (finished.ending === "sleeping") await store.setSleeping(utcDate(new Date(now())));
      if (finished.stopReason === "absent") await this.enter(n, { state: "idle" });
      else if (finished.stopReason !== "shutdown" && (await this.asleep())) await this.enter(n, { state: "sleeping" });
      else await this.enter(n, this.intermission(finished.sessionId));
    } catch (error) {
      this.slots[n] = { ...this.intermission(finished.sessionId), unrecorded: finished };
      this.log.error("recording the ending failed", { slot: n, sessionId: finished.sessionId, ...errorFields(error) });
    }
  }

  // Ends a Session left by an earlier runner, unless it already has its session-end:
  // a runner can die between writing session-end and moving the slot on.
  private async endIfUnended(n: number, sessionId: string): Promise<void> {
    const { store } = this.options;
    if ((await store.lastEvent(sessionId))?.type === "session-end") return;
    await store.endSession(sessionId, "interrupted");
    this.log.info("ended a Session left running", { slot: n, sessionId });
  }

  private intermission(sessionId: string | undefined): Intermission {
    return {
      state: "intermission",
      ...(sessionId ? { sessionId } : {}),
      intermissionEndsAtMs: this.options.now() + this.options.intermissionMs,
    };
  }

  // Sets slot n's state, here and in Valkey.
  private async enter(n: number, newSlot: Exclude<Slot, Running>): Promise<void> {
    const state: SlotState = newSlot.state;
    const sessionId = newSlot.state === "intermission" ? newSlot.sessionId : undefined;
    await this.options.store.setSlot({ type: "slot", slot: n, state, ...(sessionId ? { sessionId } : {}) });
    this.slots[n] = newSlot;
    this.log.info(`slot ${state}`, { slot: n, ...(sessionId ? { sessionId } : {}) });
  }
}
