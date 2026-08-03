import { describe, it, expect } from "vitest";
import {
  computeSchedule,
  drawPayoutOrder,
  seededShuffle,
  recomputeAfterJoin,
  type Membership,
  type TontineParams,
} from "./tontineEngine";

describe("seededShuffle", () => {
  it("is deterministic — the same seed gives the same order", () => {
    const items = ["a", "b", "c", "d", "e"];
    expect(seededShuffle(items, 12345)).toEqual(seededShuffle(items, 12345));
  });

  it("gives different orders for different seeds (in general)", () => {
    const items = ["a", "b", "c", "d", "e", "f", "g", "h"];
    // Not a guarantee for every pair of seeds, but overwhelmingly likely
    // for these two on a list this size — documents the intent.
    expect(seededShuffle(items, 1)).not.toEqual(seededShuffle(items, 2));
  });

  it("preserves every element (a permutation, nothing lost or added)", () => {
    const items = ["a", "b", "c", "d"];
    expect([...seededShuffle(items, 99)].sort()).toEqual([...items].sort());
  });
});

describe("drawPayoutOrder", () => {
  it("produces one payout slot per share", () => {
    const memberships: Membership[] = [
      { memberId: "M1", shares: 1 },
      { memberId: "M2", shares: 2 },
      { memberId: "M3", shares: 1 },
    ];
    const order = drawPayoutOrder(memberships, 42);
    expect(order).toHaveLength(4);
    expect(order.filter((m) => m === "M2")).toHaveLength(2);
  });
});

// ── Scenario A — the market flash tontine ──────────────────────────────
// Daily, minimum 5 000 FCFA, cap 7 days. M1:1, M2:2, M3:1, M4:2 → 6
// shares → pot 30 000/day, natural length 6 days (< cap), so validated
// at 6 days, one winner of 30 000 each day.
describe("Scenario A — market flash tontine", () => {
  const params: TontineParams = { periodicity: "daily", minimumShare: 5000, cycleCap: 7 };
  const memberships: Membership[] = [
    { memberId: "M1", shares: 1 },
    { memberId: "M2", shares: 2 },
    { memberId: "M3", shares: 1 },
    { memberId: "M4", shares: 2 },
  ];

  it("computes a 30 000 FCFA daily pot over 6 days with a single winner each day", () => {
    const schedule = computeSchedule(params, memberships, 42);
    expect(schedule.periodicPot).toBe(30000);
    expect(schedule.totalShares).toBe(6);
    expect(schedule.cycleLength).toBe(6);
    expect(schedule.rebalanced).toBe(false);
    expect(schedule.turns).toHaveLength(6);
    for (const turn of schedule.turns) {
      expect(turn.winners).toHaveLength(1);
      expect(turn.potPerWinner).toBe(30000);
    }
  });

  it("gives every share exactly one payout turn across the cycle", () => {
    const schedule = computeSchedule(params, memberships, 42);
    const allWinners = schedule.turns.flatMap((t) => t.winners);
    expect(allWinners).toHaveLength(6);
    expect(allWinners.filter((m) => m === "M2")).toHaveLength(2);
    expect(allWinners.filter((m) => m === "M4")).toHaveLength(2);
    expect(allWinners.filter((m) => m === "M1")).toHaveLength(1);
    expect(allWinners.filter((m) => m === "M3")).toHaveLength(1);
  });
});

// ── Scenario B — subscription explosion on the annual ──────────────────
// Monthly, minimum 50 000, cap 12 months. 18 shares → natural 18 months,
// refused → locked to 12. Pot 900 000/month. 6 months single winner + 6
// months two winners → all 18 payout turns distributed in 12 months.
describe("Scenario B — capped rebalancing with doubled turns", () => {
  const params: TontineParams = { periodicity: "monthly", minimumShare: 50000, cycleCap: 12 };
  // 18 shares spread across members (the exact split doesn't matter to
  // the totals; using a handful of multi-share members).
  const memberships: Membership[] = [
    { memberId: "M1", shares: 4 },
    { memberId: "M2", shares: 4 },
    { memberId: "M3", shares: 4 },
    { memberId: "M4", shares: 3 },
    { memberId: "M5", shares: 3 },
  ];

  it("locks the cycle to the 12-month cap instead of running the natural 18 months", () => {
    const schedule = computeSchedule(params, memberships, 7);
    expect(schedule.totalShares).toBe(18);
    expect(schedule.cycleLength).toBe(12);
    expect(schedule.rebalanced).toBe(true);
  });

  it("collects a 900 000 FCFA pot each month", () => {
    const schedule = computeSchedule(params, memberships, 7);
    expect(schedule.periodicPot).toBe(900000);
  });

  it("schedules exactly 6 doubled months and 6 single months (18 payouts over 12)", () => {
    const schedule = computeSchedule(params, memberships, 7);
    const doubled = schedule.turns.filter((t) => t.winners.length === 2);
    const single = schedule.turns.filter((t) => t.winners.length === 1);
    expect(doubled).toHaveLength(6);
    expect(single).toHaveLength(6);
    // Every winner in every month receives a full 900 000 pot.
    for (const turn of schedule.turns) {
      for (const _winner of turn.winners) expect(turn.potPerWinner).toBe(900000);
    }
  });

  it("distributes all 18 payout turns — each share paid exactly once", () => {
    const schedule = computeSchedule(params, memberships, 7);
    const allWinners = schedule.turns.flatMap((t) => t.winners);
    expect(allWinners).toHaveLength(18);
    expect(allWinners.filter((m) => m === "M1")).toHaveLength(4);
    expect(allWinners.filter((m) => m === "M4")).toHaveLength(3);
  });
});

// ── Manager override of the draw order ─────────────────────────────────
describe("manager override of the winner order", () => {
  const params: TontineParams = { periodicity: "daily", minimumShare: 5000, cycleCap: 7 };
  const memberships: Membership[] = [
    { memberId: "M1", shares: 1 },
    { memberId: "M2", shares: 2 },
    { memberId: "M3", shares: 1 },
  ];

  it("honors an explicit winner order over the seeded draw", () => {
    const explicit = ["M3", "M1", "M2", "M2"];
    const schedule = computeSchedule(params, memberships, 1, explicit);
    const allWinners = schedule.turns.flatMap((t) => t.winners);
    expect(allWinners).toEqual(explicit);
  });
});

// ── Determinism / auditability ─────────────────────────────────────────
describe("auditability", () => {
  it("produces an identical schedule from the same seed — reproducible draw", () => {
    const params: TontineParams = { periodicity: "monthly", minimumShare: 50000, cycleCap: 12 };
    const memberships: Membership[] = [
      { memberId: "A", shares: 2 },
      { memberId: "B", shares: 3 },
      { memberId: "C", shares: 1 },
    ];
    const first = computeSchedule(params, memberships, 2026);
    const second = computeSchedule(params, memberships, 2026);
    expect(first).toEqual(second);
  });
});

// ── Scenario C — a new member joins mid-cycle (day 3) ──────────────────
// Reprises Scenario A (6 shares, 30 000/day, 6 days). On day 3, M5 joins
// with 2 shares (10 000). From day 4 the daily pot rises to 40 000, and
// M5's 2 payout turns must land before day 6 — so days 5 and 6 become
// doubled turns.
describe("Scenario C — mid-cycle join with evolving recompute", () => {
  const params: TontineParams = { periodicity: "daily", minimumShare: 5000, cycleCap: 7 };
  const memberships: Membership[] = [
    { memberId: "M1", shares: 1 },
    { memberId: "M2", shares: 2 },
    { memberId: "M3", shares: 1 },
    { memberId: "M4", shares: 2 },
  ];

  it("raises the daily pot to 40 000 from the next period and leaves settled days untouched", () => {
    const initial = computeSchedule(params, memberships, 42);
    const { schedule, newPeriodicPot } = recomputeAfterJoin({
      current: initial,
      completedThrough: 3,
      newMember: { memberId: "M5", shares: 2 },
      params,
      seed: 99,
    });

    expect(newPeriodicPot).toBe(40000);

    // Days 1–3 unchanged (same winners, original 30 000 pot).
    for (let period = 1; period <= 3; period++) {
      const before = initial.turns.find((t) => t.period === period)!;
      const after = schedule.turns.find((t) => t.period === period)!;
      expect(after.winners).toEqual(before.winners);
      expect(after.potPerWinner).toBe(30000);
    }
  });

  it("still ends at day 6 (never past the cap) with the new member's turns inserted before the deadline", () => {
    const initial = computeSchedule(params, memberships, 42);
    const { schedule } = recomputeAfterJoin({
      current: initial,
      completedThrough: 3,
      newMember: { memberId: "M5", shares: 2 },
      params,
      seed: 99,
    });

    // Cycle length unchanged — still 6 days.
    expect(Math.max(...schedule.turns.map((t) => t.period))).toBe(6);

    // M5's two payout turns both appear, after day 3.
    const m5Turns = schedule.turns.filter((t) => t.winners.includes("M5"));
    const m5PayoutCount = schedule.turns.flatMap((t) => t.winners).filter((m) => m === "M5").length;
    expect(m5PayoutCount).toBe(2);
    for (const turn of m5Turns) expect(turn.period).toBeGreaterThan(3);
  });

  it("distributes 8 total payout turns (6 original + 2 new) with days 4–6 carrying the extra", () => {
    const initial = computeSchedule(params, memberships, 42);
    const { schedule } = recomputeAfterJoin({
      current: initial,
      completedThrough: 3,
      newMember: { memberId: "M5", shares: 2 },
      params,
      seed: 99,
    });

    const allWinners = schedule.turns.flatMap((t) => t.winners);
    expect(allWinners).toHaveLength(8);
    // The 3 remaining periods (days 4,5,6) must absorb the not-yet-paid
    // original slots plus M5's 2 — more than 3 slots over 3 periods, so
    // at least one doubled day.
    const remaining = schedule.turns.filter((t) => t.period > 3);
    const remainingSlots = remaining.flatMap((t) => t.winners).length;
    expect(remainingSlots).toBe(5); // 3 original still owed (days 4-6) + 2 new
    expect(remaining.some((t) => t.winners.length === 2)).toBe(true);
  });
});
