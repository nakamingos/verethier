import { Injectable } from '@nestjs/common';

export type OrdinalRequestWork = { priority: 'interactive' | 'background' };

export function ordinalRequestWork(context: { ordinalMode?: 'scheduled'; ordinalWork?: OrdinalRequestWork }): OrdinalRequestWork {
  return context.ordinalWork ||= { priority: context.ordinalMode === 'scheduled' ? 'background' : 'interactive' };
}

type Provider = 'ordnet' | 'xverse' | 'ordiscan' | 'subfrost' | 'sandshrew';
type Request = {
  work: OrdinalRequestWork;
  queuedAt: number;
  accountedAt: number;
  eligibleWait: number;
  paused: boolean;
  execute: (queueWait: number) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};
type Queue = {
  requests: Request[];
  running: boolean;
  availableAt: number;
  lastBackgroundAllowance: number;
  timer?: ReturnType<typeof setTimeout>;
};

const GAP: Record<Provider, number> = { ordnet: 2100, xverse: 650, ordiscan: 650, subfrost: 1100, sandshrew: 250 };
const MAX_BACKGROUND_PAUSE = 5 * 60 * 1000;
const BACKGROUND_ALLOWANCE_GAP = 30000;

/** One application-wide coordinator, with an independent paced queue per provider. */
@Injectable()
export class OrdinalsRequestScheduler {
  private activeVerifications = 0;
  private readonly queues = new Map<Provider, Queue>();

  beginVerification(): () => void {
    this.accountWaiting();
    this.activeVerifications++;
    this.wake();
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.accountWaiting();
      this.activeVerifications--;
      this.wake();
    };
  }

  promote(work: OrdinalRequestWork): void {
    this.accountWaiting();
    work.priority = 'interactive';
    this.wake();
  }

  enqueue<T>(provider: Provider, work: OrdinalRequestWork, execute: (queueWait: number) => Promise<T>): Promise<T> {
    if (!this.queues.has(provider)) this.queues.set(provider, {
      requests: [], running: false, availableAt: 0, lastBackgroundAllowance: -Infinity,
    });
    const queue = this.queues.get(provider);
    const now = Date.now();
    const result = new Promise<T>((resolve, reject) => queue.requests.push({
      work, queuedAt: now, accountedAt: now, eligibleWait: 0,
      paused: this.activeVerifications > 0 && work.priority === 'background',
      execute, resolve, reject,
    }));
    this.pump(provider, queue);
    return result;
  }

  private accountWaiting(): void {
    const now = Date.now();
    for (const queue of this.queues.values()) for (const request of queue.requests) {
      // Deliberate background pauses must not consume the existing queue timeout.
      if (!request.paused) request.eligibleWait += now - request.accountedAt;
      request.accountedAt = now;
      request.paused = this.activeVerifications > 0 && request.work.priority === 'background';
    }
  }

  private wake(): void {
    // Recompute paused status after a scope or priority change.
    this.accountWaiting();
    for (const [provider, queue] of this.queues) this.pump(provider, queue);
  }

  private pump(provider: Provider, queue: Queue): void {
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = undefined;
    if (queue.running || !queue.requests.length) return;
    const now = Date.now();
    if (queue.availableAt > now) return this.wait(provider, queue, queue.availableAt - now);

    this.accountWaiting();
    let index = 0;
    if (this.activeVerifications > 0) {
      index = queue.requests.findIndex(request => request.work.priority === 'interactive');
      const background = queue.requests.findIndex(request => request.work.priority === 'background');
      if (background >= 0) {
        const allowedAt = Math.max(queue.requests[background].queuedAt + MAX_BACKGROUND_PAUSE,
          queue.lastBackgroundAllowance + BACKGROUND_ALLOWANCE_GAP);
        if (now >= allowedAt) {
          index = background;
          queue.lastBackgroundAllowance = now;
        } else if (index < 0) {
          return this.wait(provider, queue, allowedAt - now);
        }
      }
    }
    if (index < 0) return;
    const [request] = queue.requests.splice(index, 1);
    queue.running = true;
    void Promise.resolve().then(() => request.execute(request.eligibleWait)).then(request.resolve, request.reject).finally(() => {
      queue.running = false;
      queue.availableAt = Date.now() + GAP[provider];
      this.pump(provider, queue);
    });
  }

  private wait(provider: Provider, queue: Queue, delay: number): void {
    queue.timer = setTimeout(() => this.pump(provider, queue), delay);
    queue.timer.unref?.();
  }
}
