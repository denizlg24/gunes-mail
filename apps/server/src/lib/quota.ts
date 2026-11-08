import { AsyncLocalStorage } from "node:async_hooks";

const background = new AsyncLocalStorage<true>();

/** Marks every provider call made inside `fn` as background work, which yields quota to the user's own requests. */
export function inBackground<T>(fn: () => Promise<T>): Promise<T> {
  return background.run(true, fn);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Token bucket over a provider's per-user quota. Background calls wait for the bucket
 * to cover their cost; interactive calls always go through and may drive it negative,
 * which simply makes the sync behind them wait longer.
 */
export class QuotaBucket {
  private tokens: number;
  private updatedAt = Date.now();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.updatedAt) / 1000) * this.refillPerSecond);
    this.updatedAt = now;
  }

  /** Throttled callers proceed in arrival order so a large request can't be starved by small ones. */
  take(cost: number): Promise<void> {
    if (!background.getStore()) {
      this.refill();
      this.tokens -= cost;
      return Promise.resolve();
    }
    const turn = this.queue.then(async () => {
      for (;;) {
        this.refill();
        if (this.tokens >= cost) {
          this.tokens -= cost;
          return;
        }
        await sleep(((cost - this.tokens) / this.refillPerSecond) * 1000);
      }
    });
    this.queue = turn;
    return turn;
  }

  /** Called after a 429: the provider says the window is spent, so stop background work for a while. */
  drain(seconds: number) {
    this.refill();
    this.tokens = Math.min(this.tokens, -seconds * this.refillPerSecond);
  }
}
