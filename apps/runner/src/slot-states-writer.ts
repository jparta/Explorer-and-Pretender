// Writes every slot's state to Valkey (D65), one write at a time. Each write takes the
// states as they are in memory when it starts; if they changed during a write, another
// follows, and a write that failed is tried again after a pause. With only one write
// under way, writes can't finish out of order, so the last entry in Valkey is always
// the latest state in memory once the writer is done. It never gives up: while Valkey
// refuses, it keeps trying, and whoever waits for a change waits too.
import type { SlotStateWithSession } from "@exhibition/shared";
import { errorFields, type Logger } from "./log.ts";

type Waiter = { changeNumber: number; resolve: () => void };

export class SlotStatesWriter {
  private changeCount = 0; // changes asked for so far
  private writtenChangeCount = 0; // changes in the last write that succeeded
  private waiters: Waiter[] = [];
  // The running round of writes, or nothing while Valkey is up to date. It also marks
  // whether a round is running, so a change starts one only if none is.
  private writing: Promise<void> | undefined;

  constructor(
    private readonly options: {
      currentSlotStates: () => SlotStateWithSession[];
      write: (slots: SlotStateWithSession[]) => Promise<void>;
      retryPauseMs: number;
      log: Logger;
    },
  ) {}

  // Call after each change in memory. Resolves once a write that includes the change
  // has succeeded; never rejects.
  writeChange(): Promise<void> {
    const changeNumber = ++this.changeCount;
    const written = new Promise<void>((resolve) => this.waiters.push({ changeNumber, resolve }));
    this.writing ??= this.writeUntilUpToDate();
    return written;
  }

  // Resolves once Valkey has the latest states, or at once if it already has.
  async whenWritten(): Promise<void> {
    while (this.writing) await this.writing;
  }

  // Marks itself done in the same step as it finds nothing left to write, so a change
  // made right after (by a waiter it just resolved, say) starts a new round of writes.
  private async writeUntilUpToDate(): Promise<void> {
    await Promise.resolve(); // so that `writing` is set before this can clear it
    while (this.writtenChangeCount < this.changeCount) {
      const changeCount = this.changeCount;
      try {
        await this.options.write(this.options.currentSlotStates());
        this.writtenChangeCount = changeCount;
        this.resolveWaiters(changeCount);
      } catch (error) {
        this.options.log.error("writing the slot states failed, trying again", errorFields(error));
        await Bun.sleep(this.options.retryPauseMs);
      }
    }
    this.writing = undefined;
  }

  // Resolves the waiters for every change up to changeCount.
  private resolveWaiters(changeCount: number): void {
    const written = this.waiters.filter((waiter) => waiter.changeNumber <= changeCount);
    this.waiters = this.waiters.filter((waiter) => waiter.changeNumber > changeCount);
    for (const waiter of written) waiter.resolve();
  }
}
