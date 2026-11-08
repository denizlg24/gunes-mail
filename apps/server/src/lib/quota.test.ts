import { describe, expect, test } from "bun:test";

import { QuotaBucket, inBackground } from "./quota";

describe("QuotaBucket", () => {
  test("background work waits for the bucket to refill", async () => {
    const bucket = new QuotaBucket(10, 100);
    const start = Date.now();
    await inBackground(async () => {
      await bucket.take(10);
      await bucket.take(10);
    });
    expect(Date.now() - start).toBeGreaterThanOrEqual(90);
  });

  test("interactive calls never wait, and push background work back", async () => {
    const bucket = new QuotaBucket(10, 100);
    const start = Date.now();
    await bucket.take(10);
    await bucket.take(10);
    expect(Date.now() - start).toBeLessThan(20);
    await inBackground(() => bucket.take(5));
    expect(Date.now() - start).toBeGreaterThanOrEqual(140);
  });

  test("a rate limit response pauses background work", async () => {
    const bucket = new QuotaBucket(100, 1000);
    bucket.drain(0.1);
    const start = Date.now();
    await inBackground(() => bucket.take(1));
    expect(Date.now() - start).toBeGreaterThanOrEqual(90);
  });
});
