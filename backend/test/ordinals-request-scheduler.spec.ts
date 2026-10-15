import { OrdinalsRequestScheduler, OrdinalRequestWork } from '../src/services/ordinals-request-scheduler.service';

const interactive = (): OrdinalRequestWork => ({ priority: 'interactive' });
const background = (): OrdinalRequestWork => ({ priority: 'background' });

describe('Ordinals request scheduling', () => {
  let scheduler: OrdinalsRequestScheduler;
  beforeEach(() => {
    jest.useFakeTimers();
    scheduler = new OrdinalsRequestScheduler();
  });
  afterEach(async () => {
    await jest.runAllTimersAsync();
    jest.useRealTimers();
  });

  it('keeps provider quotas separate and retains the gap after each request completes', async () => {
    const calls: string[] = [];
    const request = (name: string) => async () => { calls.push(name); };
    const pending = [
      scheduler.enqueue('ordnet', interactive(), request('ord1')),
      scheduler.enqueue('ordnet', interactive(), request('ord2')),
      scheduler.enqueue('xverse', interactive(), request('x1')),
      scheduler.enqueue('xverse', interactive(), request('x2')),
    ];
    await jest.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['ord1', 'x1']);
    await jest.advanceTimersByTimeAsync(649);
    expect(calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['ord1', 'x1', 'x2']);
    await jest.advanceTimersByTimeAsync(1450);
    expect(calls).toEqual(['ord1', 'x1', 'x2', 'ord2']);
    await Promise.all(pending);
  });

  it('pauses queued background requests until every active verification has finished', async () => {
    const finishFirst = scheduler.beginVerification();
    const finishSecond = scheduler.beginVerification();
    const task = jest.fn().mockResolvedValue('done');
    const pending = scheduler.enqueue('ordnet', background(), task);
    await jest.advanceTimersByTimeAsync(5000);
    finishFirst();
    finishFirst(); // Scope cleanup is idempotent.
    await jest.advanceTimersByTimeAsync(5000);
    expect(task).not.toHaveBeenCalled();
    finishSecond();
    await expect(pending).resolves.toBe('done');
    expect(task).toHaveBeenCalledWith(0);
  });

  it('serves an interactive request ahead of an earlier paused background request', async () => {
    const finish = scheduler.beginVerification();
    const calls: string[] = [];
    const bg = scheduler.enqueue('ordnet', background(), async () => { calls.push('background'); });
    const fg = scheduler.enqueue('ordnet', interactive(), async () => { calls.push('verification'); });
    await fg;
    expect(calls).toEqual(['verification']);
    finish();
    await jest.advanceTimersByTimeAsync(2100);
    await bg;
    expect(calls).toEqual(['verification', 'background']);
  });

  it('lets an in-flight background request finish before starting verification and preserves its cooldown', async () => {
    let release: () => void;
    const inFlight = new Promise<void>(resolve => { release = resolve; });
    const bg = scheduler.enqueue('ordnet', background(), () => inFlight);
    await jest.advanceTimersByTimeAsync(0);
    const finish = scheduler.beginVerification();
    const task = jest.fn().mockResolvedValue(undefined);
    const fg = scheduler.enqueue('ordnet', interactive(), task);
    await jest.advanceTimersByTimeAsync(5000);
    expect(task).not.toHaveBeenCalled();
    release();
    await bg;
    await jest.advanceTimersByTimeAsync(2099);
    expect(task).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await fg;
    finish();
  });

  it('promotes shared background work immediately without charging its paused time to the queue timeout', async () => {
    const finish = scheduler.beginVerification();
    const work = background();
    const task = jest.fn().mockResolvedValue('shared scan');
    const pending = scheduler.enqueue('ordnet', work, task);
    await jest.advanceTimersByTimeAsync(50000);
    scheduler.promote(work);
    await expect(pending).resolves.toBe('shared scan');
    expect(task).toHaveBeenCalledWith(0);
    finish();
  });

  it('allows one aged background request after five minutes, then at most one every 30 seconds', async () => {
    const finish = scheduler.beginVerification();
    const calls: number[] = [];
    const started = Date.now();
    const waits: number[] = [];
    const pending = [1, 2, 3].map(() => scheduler.enqueue('xverse', background(), async queueWait => {
      calls.push(Date.now() - started);
      waits.push(queueWait);
    }));
    await jest.advanceTimersByTimeAsync(299999);
    expect(calls).toEqual([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([300000]);
    await jest.advanceTimersByTimeAsync(29999);
    expect(calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([300000, 330000]);
    expect(waits).toEqual([0, 0]);
    finish();
    await jest.advanceTimersByTimeAsync(650);
    await Promise.all(pending);
    expect(calls).toEqual([300000, 330000, 330650]);
  });

  it('continues after failures without dropping queued work or bypassing request pacing', async () => {
    const failed = scheduler.enqueue('ordnet', interactive(), async () => { throw new Error('provider unavailable'); });
    const rejection = expect(failed).rejects.toThrow('provider unavailable');
    const task = jest.fn().mockResolvedValue('recovered');
    const next = scheduler.enqueue('ordnet', interactive(), task);
    await rejection;
    await jest.advanceTimersByTimeAsync(2099);
    expect(task).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(next).resolves.toBe('recovered');
  });
});
