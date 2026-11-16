import { logger } from '../../config/logger';

/**
 * In-process FIFO work queue with bounded concurrency. Durable state lives in the database
 * (experiment status), so after a restart QUEUED experiments are re-enqueued by recovery.
 */
export class WorkQueue {
  private readonly pending: string[] = [];
  private readonly running = new Set<string>();
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly worker: (id: string) => Promise<void>,
  ) {}

  enqueue(id: string): void {
    if (this.running.has(id) || this.pending.includes(id)) return;
    this.pending.push(id);
    this.pump();
  }

  /** Removes a job that has not started yet. */
  remove(id: string): boolean {
    const i = this.pending.indexOf(id);
    if (i === -1) return false;
    this.pending.splice(i, 1);
    this.settle();
    return true;
  }

  get size() {
    return { pending: this.pending.length, running: this.running.size };
  }

  /** Resolves once no work is pending or running. */
  drain(): Promise<void> {
    if (!this.pending.length && !this.running.size) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.pending.length) {
      const id = this.pending.shift()!;
      this.running.add(id);
      this.worker(id)
        .catch((err) => logger.error({ err, id }, 'queue worker crashed'))
        .finally(() => {
          this.running.delete(id);
          this.pump();
          this.settle();
        });
    }
  }

  private settle(): void {
    if (this.pending.length || this.running.size) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }
}
