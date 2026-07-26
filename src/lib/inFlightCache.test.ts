import { describe, it, expect, vi } from "vitest";
import { dedupeInFlight } from "./inFlightCache";

describe("dedupeInFlight", () => {
  it("returns the computed value", async () => {
    const result = await dedupeInFlight("key-1", async () => 42);
    expect(result).toBe(42);
  });

  it("shares one computation between calls that overlap in time", async () => {
    const compute = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "value";
    });

    const [a, b, c] = await Promise.all([
      dedupeInFlight("shared-key", compute),
      dedupeInFlight("shared-key", compute),
      dedupeInFlight("shared-key", compute),
    ]);

    expect(a).toBe("value");
    expect(b).toBe("value");
    expect(c).toBe("value");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("does not share a computation between calls that don't overlap in time", async () => {
    const compute = vi.fn(async () => "value");

    await dedupeInFlight("sequential-key", compute);
    await dedupeInFlight("sequential-key", compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("does not share computations across different keys", async () => {
    const compute = vi.fn(async () => "value");

    await Promise.all([dedupeInFlight("key-a", compute), dedupeInFlight("key-b", compute)]);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("never serves a stale result: the very next call after resolution recomputes", async () => {
    let counter = 0;
    const compute = vi.fn(async () => {
      counter += 1;
      return counter;
    });

    const first = await dedupeInFlight("recompute-key", compute);
    const second = await dedupeInFlight("recompute-key", compute);

    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it("clears the in-flight entry even when the computation throws, so a later call is not stuck failing forever", async () => {
    let attempt = 0;
    const compute = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("first attempt fails");
      return "recovered";
    });

    await expect(dedupeInFlight("failing-key", compute)).rejects.toThrow("first attempt fails");
    const result = await dedupeInFlight("failing-key", compute);
    expect(result).toBe("recovered");
  });

  it("propagates a rejection to every caller sharing the in-flight computation", async () => {
    const compute = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("shared failure");
    });

    const results = await Promise.allSettled([
      dedupeInFlight("shared-failure-key", compute),
      dedupeInFlight("shared-failure-key", compute),
    ]);

    expect(results[0]?.status).toBe("rejected");
    expect(results[1]?.status).toBe("rejected");
    expect(compute).toHaveBeenCalledTimes(1);
  });
});
