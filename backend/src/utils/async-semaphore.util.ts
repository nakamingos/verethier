/** Bounded asynchronous work; waiting callers do not occupy provider queues. */
export class AsyncSemaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid concurrency limit');
  }
  async acquire(): Promise<() => void> {
    if (this.active < this.limit) this.active++;
    else await new Promise<void>(resolve => this.waiting.push(resolve));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    };
  }
  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try { return await work(); } finally { release(); }
  }
}
