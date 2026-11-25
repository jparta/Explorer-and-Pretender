// The slot loops (architecture 6.1, 6.2): each slot is checked once a second, a *tick*,
// and moves between idle, running, intermission and sleeping. The runner is the only
// writer of slot state (D24 keeps it to one runner), so the state here is the truth.
// Every change writes every slot's state to Valkey as one event (D65), for the web server
// and for the next runner after a restart. Doesn't touch the network itself: Valkey, the
// Sessions and the clock are passed in.
import { type Ending, type SlotStateWithSession, utcDate } from "@exhibition/shared";
import { errorFields, log as defaultLog, type Logger } from "./log.ts";
import { SlotStatesWriter } from "./slot-states-writer.ts";
import type { ValkeyStore } from "./store.ts";

export type RunSession = (slot: number, sessionId: string, signal: AbortSignal) => Promise<Ending>;

export type SlotLoopsOptions = {
  store: ValkeyStore;
  slotCount: number;
  intermissionMs: number;
  presenceTimeoutMs: number;
  dailySpendCapDollars: number;
  slotStatesRetryPauseMs: number; // the pause before writing the slot states again after a failure
  nowMs: () => number; // since the epoch
  runSession: RunSession;
  newSessionId?: () => string;
  log?: Logger;
};

// Why the runner stopped a Session: nobody was present, or the runner is shutting down.
type StopReason = "absent" | "shutdown";

// A Session that has ended, and why.
type EndedSession = { sessionId: string; ending: Ending; stopReason?: StopReason };

type Running = {
  state: "running";
  sessionId: string;
  abortController: AbortController;
  stopReason?: StopReason;
  presenceConfirmedAtMs: number; // when presence was last confirmed
  endingHandled: Promise<void>;
};

type Intermission = {
  state: "intermission";
  sessionId?: string;
  intermissionEndsAtMs: number;
  // An ending that couldn't be written to Valkey yet; the next tick tries again.
  unrecordedEnding?: EndedSession;
};

type Slot = { state: "idle" } | Running | Intermission | { state: "sleeping" };

export class SlotLoops {
  private readonly slotStates: Slot[];
  private readonly lastTickAtMsBySlot: number[];
  private readonly log: Logger;
  private readonly newSessionId: () => string;
  private readonly slotStatesWriter: SlotStatesWriter;
  private stopping = false;

  constructor(private readonly options: SlotLoopsOptions) {
    this.slotStates = Array.from({ length: options.slotCount }, (): Slot => ({ state: "idle" }));
    this.lastTickAtMsBySlot = Array.from({ length: options.slotCount }, () => 0);
    this.log = options.log ?? defaultLog;
    this.newSessionId = options.newSessionId ?? (() => crypto.randomUUID());
    this.slotStatesWriter = new SlotStatesWriter({
      currentSlotStates: () => this.slotStatesForValkey(),
      write: (slots) => options.store.writeSlotStates(slots),
      retryPauseMs: options.slotStatesRetryPauseMs,
      log: this.log,
    });
  }

  // On start-up: picks up the slot states a previous runner left (architecture 9), and
  // writes every slot's state, so the list has the current slot count (D65).
  async resumePreviousSlotStates(): Promise<void> {
    const { store, slotCount } = this.options;
    const previousStates = (await store.readSlotStates()) ?? [];
    for (let slotNumber = 0; slotNumber < Math.max(slotCount, previousStates.length); slotNumber++) {
      const previousState = previousStates[slotNumber];
      // Only a crash leaves a slot running: a clean shutdown moves it to its intermission.
      // A slot beyond a lowered count gets its Session ended too, and drops out of the list.
      if (previousState?.state === "running" && previousState.sessionId) {
        await this.endIfUnended(slotNumber, previousState.sessionId);
      }
      if (slotNumber >= slotCount) continue;
      switch (previousState?.state) {
        case "running":
        case "intermission":
          void this.setSlotState(slotNumber, this.intermissionStartingNow(previousState.sessionId));
          break;
        case "sleeping":
          void this.setSlotState(slotNumber, { state: "sleeping" });
          break;
        default:
          void this.setSlotState(slotNumber, { state: "idle" });
      }
    }
    await this.whenSlotStatesWritten();
    // The loops start now: until each has ticked once, they count as having just ticked.
    this.lastTickAtMsBySlot.fill(this.options.nowMs());
  }

  async tickAll(): Promise<void> {
    await Promise.all(this.slotStates.map((_, slotNumber) => this.tick(slotNumber)));
  }

  // One check of a slot. Errors are logged, and the next tick tries again.
  async tick(slotNumber: number): Promise<void> {
    try {
      if (!this.stopping) await this.advanceSlot(slotNumber);
    } catch (error) {
      this.log.error("slot check failed", { slot: slotNumber, ...errorFields(error) });
    } finally {
      this.lastTickAtMsBySlot[slotNumber] = this.options.nowMs();
    }
  }

  // When each slot last finished a tick, for the liveness probe.
  lastTickAtMs(): number[] {
    return [...this.lastTickAtMsBySlot];
  }

  // Resolves once the slot's running Session, if any, has ended and its ending is handled.
  async whenSessionEnded(slotNumber: number): Promise<void> {
    const slot = this.slotStates[slotNumber];
    if (slot?.state === "running") await slot.endingHandled;
  }

  // Resolves once Valkey has every slot's latest state.
  whenSlotStatesWritten(): Promise<void> {
    return this.slotStatesWriter.whenWritten();
  }

  // Ends running Sessions as interrupted and starts their intermission (architecture 9).
  async shutdown(): Promise<void> {
    this.stopping = true;
    const running = this.slotStates.filter((slot): slot is Running => slot.state === "running");
    for (const slot of running) this.stop(slot, "shutdown");
    await Promise.all(running.map((slot) => slot.endingHandled));
    await this.slotStatesWriter.whenWritten();
  }

  private async advanceSlot(slotNumber: number): Promise<void> {
    const { store, nowMs } = this.options;
    const slot = this.slotStates[slotNumber];
    if (!slot) throw new Error(`No slot ${slotNumber}`);
    switch (slot.state) {
      case "idle":
        if (await this.isMachineSleeping()) void this.setSlotState(slotNumber, { state: "sleeping" });
        else if (await store.isWatched(slotNumber)) await this.startSession(slotNumber);
        return;
      case "running":
        await this.stopIfNobodyPresent(slot);
        return;
      case "intermission":
        if (slot.unrecordedEnding) await this.endSessionAndSetNextState(slotNumber, slot.unrecordedEnding);
        else if (await this.isMachineSleeping()) void this.setSlotState(slotNumber, { state: "sleeping" });
        else if (nowMs() >= slot.intermissionEndsAtMs) {
          if (await store.isWatched(slotNumber)) await this.startSession(slotNumber);
          else void this.setSlotState(slotNumber, { state: "idle" });
        }
        return;
      case "sleeping":
        if (!(await this.isMachineSleeping())) void this.setSlotState(slotNumber, { state: "idle" });
        return;
    }
  }

  // The machine sleeps once the day's spend reaches the cap, or once the provider
  // refused a call because the key's daily limit or the prepaid credit is spent (S6.2,
  // D59). The date is always today's in UTC, so sleeping ends at midnight.
  private async isMachineSleeping(): Promise<boolean> {
    const { store, nowMs, dailySpendCapDollars } = this.options;
    const date = utcDate(new Date(nowMs()));
    return (await store.isSleeping(date)) || (await store.readSpendDollars(date)) >= dailySpendCapDollars;
  }

  // Nobody present: stop the Session. Presence that can't be checked because of an error
  // counts as present until the timeout runs out (runner component doc, section 2.5).
  private async stopIfNobodyPresent(slot: Running): Promise<void> {
    const { store, nowMs, presenceTimeoutMs } = this.options;
    let present: boolean;
    try {
      present = await store.isPresent();
    } catch (error) {
      if (nowMs() - slot.presenceConfirmedAtMs > presenceTimeoutMs) this.stop(slot, "absent");
      throw error;
    }
    if (present) slot.presenceConfirmedAtMs = nowMs();
    else this.stop(slot, "absent");
  }

  private stop(slot: Running, reason: StopReason): void {
    slot.stopReason ??= reason;
    slot.abortController.abort();
  }

  // Announces a new Session: the stream first, then the slot state, so the stream
  // exists before anyone is told about it (architecture 6.2).
  private async startSession(slotNumber: number): Promise<void> {
    const { store, nowMs, runSession } = this.options;
    const sessionId = this.newSessionId();
    await store.startSession(sessionId, slotNumber);
    const abortController = new AbortController();
    const running: Running = { state: "running", sessionId, abortController, presenceConfirmedAtMs: nowMs(), endingHandled: Promise.resolve() };
    // The conversation starts once Valkey shows the slot running, however long that
    // takes, so it only starts once everyone can know about it. endingHandled covers the
    // wait too, so a shutdown meanwhile waits for this Session's ending; the conversation
    // then never starts.
    const announced = this.setSlotState(slotNumber, running);
    running.endingHandled = announced
      .then((): Promise<Ending> => {
        if (abortController.signal.aborted) return Promise.resolve("interrupted");
        this.log.info("Session started", { slot: slotNumber, sessionId });
        return runSession(slotNumber, sessionId, abortController.signal);
      })
      .catch((error): Ending => {
        this.log.error("Session failed", { slot: slotNumber, sessionId, ...errorFields(error) });
        return "interrupted";
      })
      .then((ending) => {
        this.log.info("Session ended", { slot: slotNumber, sessionId, ending });
        return this.endSessionAndSetNextState(slotNumber, { sessionId, ending, stopReason: running.stopReason });
      });
    await announced;
  }

  // Writes the ending, then moves the slot on: to idle if nobody is there to see the
  // ending, to sleeping if the machine sleeps now, otherwise to the intermission. If a
  // write fails, the slot waits in its intermission and the next tick tries again, so
  // the stream still gets its session-end and its expiry.
  private async endSessionAndSetNextState(slotNumber: number, endedSession: EndedSession): Promise<void> {
    const { store, nowMs } = this.options;
    try {
      // A retry checks first whether the earlier try got as far as session-end, and
      // then still sets the expiry, which may be what failed.
      const isRetry = this.slotStates[slotNumber]?.state === "intermission" && this.slotStates[slotNumber].unrecordedEnding !== undefined;
      if (isRetry && (await store.readLastEvent(endedSession.sessionId))?.type === "session-end") {
        await store.expireSession(endedSession.sessionId);
      } else {
        await store.endSession(endedSession.sessionId, endedSession.ending);
      }
      if (endedSession.ending === "sleeping") await store.setSleeping(utcDate(new Date(nowMs())));
      if (endedSession.stopReason === "absent") void this.setSlotState(slotNumber, { state: "idle" });
      else if (endedSession.stopReason !== "shutdown" && (await this.isMachineSleeping())) void this.setSlotState(slotNumber, { state: "sleeping" });
      else void this.setSlotState(slotNumber, this.intermissionStartingNow(endedSession.sessionId));
    } catch (error) {
      void this.setSlotState(slotNumber, { ...this.intermissionStartingNow(endedSession.sessionId), unrecordedEnding: endedSession });
      this.log.error("recording the ending failed", { slot: slotNumber, sessionId: endedSession.sessionId, ...errorFields(error) });
    }
  }

  // Ends a Session left by an earlier runner, unless it already has its session-end:
  // a runner can die between writing session-end and moving the slot on.
  private async endIfUnended(slotNumber: number, sessionId: string): Promise<void> {
    const { store } = this.options;
    if ((await store.readLastEvent(sessionId))?.type === "session-end") return;
    await store.endSession(sessionId, "interrupted");
    this.log.info("ended a Session left running", { slot: slotNumber, sessionId });
  }

  private intermissionStartingNow(sessionId: string | undefined): Intermission {
    return {
      state: "intermission",
      ...(sessionId ? { sessionId } : {}),
      intermissionEndsAtMs: this.options.nowMs() + this.options.intermissionMs,
    };
  }

  // Every change of a slot's state goes through here: it sets the state in memory, logs
  // it, and has every slot's state written to Valkey. Resolves once Valkey has it; starting a
  // Session waits for that (start-up and shutdown wait for the writer too). Other changes
  // don't, so a write that keeps failing
  // doesn't hold up stopping a Session nobody watches, or recording an ending.
  private setSlotState(slotNumber: number, nextState: Slot): Promise<void> {
    this.slotStates[slotNumber] = nextState;
    const sessionId = nextState.state === "running" || nextState.state === "intermission" ? nextState.sessionId : undefined;
    this.log.info(`slot ${nextState.state}`, { slot: slotNumber, ...(sessionId ? { sessionId } : {}) });
    return this.slotStatesWriter.writeChange();
  }

  private slotStatesForValkey(): SlotStateWithSession[] {
    return this.slotStates.map((slot) => {
      const sessionId = slot.state === "running" || slot.state === "intermission" ? slot.sessionId : undefined;
      return { state: slot.state, ...(sessionId ? { sessionId } : {}) };
    });
  }
}
