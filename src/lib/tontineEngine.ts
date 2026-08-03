/**
 * NKaP Community — tontine (ROSCA) calculation engine.
 *
 * Pure, deterministic, and entirely free of any money movement: this
 * only ever *computes and coordinates* a rotating savings schedule —
 * who is due to receive the pot on which turn — exactly as a traditional
 * tontine's organizer would work it out on paper. Members exchange the
 * actual money among themselves; the app never holds or moves it. That's
 * a deliberate design and legal choice (see the module's scoping
 * discussion), and it's why nothing here touches accounts, Mobile Money,
 * or balances.
 *
 * Everything is driven off an explicit `seed` so a draw is reproducible:
 * the same inputs always produce the same schedule. That makes the
 * engine testable, and — more importantly for a real tontine — makes the
 * random draw auditable: any member can recompute the schedule from the
 * seed and confirm the order was honest, nobody rigged it.
 */

export type Periodicity = "daily" | "weekly" | "monthly";

export interface TontineParams {
  /** How often the pot is collected and paid out. */
  periodicity: Periodicity;
  /** The base ticket — the minimum share. Members subscribe in whole
   * multiples of this (1 share, 2 shares, ...), never fractions. In the
   * account's currency unit (FCFA). */
  minimumShare: number;
  /** The hard ceiling on how many periods the cycle may run. If total
   * shares would naturally run longer than this, the engine forces
   * multiple winners per turn to close on time rather than extending
   * (see rule 2 in the spec). */
  cycleCap: number;
}

export interface Membership {
  memberId: string;
  /** Whole number of shares this member takes — each share is one unit of
   * the minimum ticket, both what they contribute per period and one
   * future payout turn they're owed. */
  shares: number;
}

export interface ScheduledTurn {
  /** 1-based period index (day 1, day 2, ... / month 1, ...). */
  period: number;
  /** The member(s) receiving the pot this period. More than one only
   * when the cap forced doubling-up to fit every share's payout in
   * before the deadline. */
  winners: string[];
  /** The pot each winner receives this period — the full periodic pot.
   * When two winners share a period, each receives a full pot (the
   * period simply collects and pays out twice), matching the spec's
   * "deux gagnants simultanés qui touchent chacun 900 000 FCFA". */
  potPerWinner: number;
}

export interface TontineSchedule {
  /** The pot collected (and paid out per winner) each period. */
  periodicPot: number;
  /** Total number of shares across all members — also the number of
   * payout turns that must be distributed. */
  totalShares: number;
  /** How many periods the cycle actually runs — min(totalShares, cap). */
  cycleLength: number;
  /** Whether the cap forced doubling-up (totalShares > cap). */
  rebalanced: boolean;
  turns: ScheduledTurn[];
}

/**
 * A small, seeded pseudo-random generator (mulberry32). Deterministic
 * from a 32-bit seed — the same seed always yields the same sequence, so
 * a draw can be reproduced and audited. Not cryptographic, and doesn't
 * need to be: the seed itself is what must be unpredictable in advance
 * (generated randomly at cycle creation), and once revealed anyone can
 * confirm the draw followed from it.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded Fisher–Yates shuffle — deterministic from the seed, so the
 * winner order is reproducible and auditable. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = [...items];
  const rand = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

/**
 * Builds the ordered list of payout "slots" — one per share, since every
 * share is owed exactly one payout turn. A member with 3 shares appears
 * 3 times. The order is the seeded random draw by default; a manager can
 * later override it (the spec allows manual reordering, with everyone
 * notified), but that override is applied on top of this, not here.
 */
export function drawPayoutOrder(memberships: readonly Membership[], seed: number): string[] {
  // One slot per share. Built in a stable member order first (so the
  // pre-shuffle input is itself deterministic regardless of how the
  // memberships array happened to be ordered), then shuffled by seed.
  const slots: string[] = [];
  const sorted = [...memberships].sort((a, b) => a.memberId.localeCompare(b.memberId));
  for (const m of sorted) {
    for (let i = 0; i < m.shares; i++) slots.push(m.memberId);
  }
  return seededShuffle(slots, seed);
}

/**
 * The core calculation. Given the parameters and the current
 * memberships, produces the full payout schedule following the spec:
 *
 *  - periodic pot = sum of every member's contribution (shares ×
 *    minimum), collected each period;
 *  - natural cycle length = total shares (one payout turn per share);
 *  - if that exceeds the cap, the cycle is locked to the cap and turns
 *    are doubled up (more than one winner per period) so every share's
 *    payout still lands before the deadline — never extending past the
 *    cap (rule 2).
 *
 * `winnerOrder`, when given, is an explicit ordered list of member ids
 * (one entry per share) that overrides the seeded draw — this is how a
 * manager's manual reordering is applied. When omitted, the seeded draw
 * from `seed` is used.
 */
export function computeSchedule(
  params: TontineParams,
  memberships: readonly Membership[],
  seed: number,
  winnerOrder?: readonly string[],
): TontineSchedule {
  const totalShares = memberships.reduce((sum, m) => sum + m.shares, 0);
  const periodicPot = totalShares * params.minimumShare;

  const order = winnerOrder ? [...winnerOrder] : drawPayoutOrder(memberships, seed);

  // The cycle runs for the natural length (one period per share) unless
  // that would break the cap, in which case it locks to the cap and
  // turns double up.
  const cycleLength = Math.min(totalShares, params.cycleCap);
  const rebalanced = totalShares > params.cycleCap;

  // Distribute the ordered payout slots across the available periods as
  // evenly as possible: with N slots over L periods, some periods get
  // ceil(N/L) winners and the rest get floor(N/L). The spec's example —
  // 18 shares over 12 months → 6 months of 2 winners then 6 of 1 —
  // falls out of this exactly (12 periods, 18 slots: 6 doubled, 6 single).
  const turns: ScheduledTurn[] = [];
  let slotIndex = 0;
  for (let period = 1; period <= cycleLength; period++) {
    const remainingPeriods = cycleLength - period + 1;
    const remainingSlots = order.length - slotIndex;
    const winnersThisTurn = Math.ceil(remainingSlots / remainingPeriods);
    const winners = order.slice(slotIndex, slotIndex + winnersThisTurn);
    slotIndex += winnersThisTurn;
    turns.push({ period, winners, potPerWinner: periodicPot });
  }

  return { periodicPot, totalShares, cycleLength, rebalanced, turns };
}

export interface MidCycleJoinInput {
  /** The schedule as it currently stands, before the new member joins. */
  current: TontineSchedule;
  /** The period that has just completed — turns at or before this are
   * settled history and must not change; only periods strictly after it
   * are recomputed. In Scenario C, the join happens on day 3, so
   * completedThrough = 3 and only days 4..6 are reworked. */
  completedThrough: number;
  /** The joining member's shares. */
  newMember: Membership;
  /** The parameters (unchanged — periodicity, minimum, cap). */
  params: TontineParams;
  /** Seed for drawing the new member's payout slots into the remaining
   * periods — again deterministic and auditable. */
  seed: number;
}

export interface MidCycleJoinResult {
  schedule: TontineSchedule;
  /** The new per-period pot from the next period onward — higher, since
   * the new member's contribution is added. Surfaced so the UI can build
   * the "your winnings rise to X" notification the spec calls for. */
  newPeriodicPot: number;
}

/**
 * Rule 3 — a member joining after the cycle has started. Per the spec:
 * past periods are untouched; from the next period the pot rises by the
 * new member's contribution; the new member's own payout turns are
 * inserted into the periods that remain before the cap; and the caller
 * notifies everyone of the revaluation.
 *
 * Deliberately keeps the already-completed turns exactly as they were —
 * those payouts have happened in real life and recomputing them would be
 * wrong. It's only the remaining periods that are rebuilt, now including
 * the new member's shares among their winners.
 */
export function recomputeAfterJoin(input: MidCycleJoinInput): MidCycleJoinResult {
  const { current, completedThrough, newMember, params, seed } = input;

  const settledTurns = current.turns.filter((t) => t.period <= completedThrough);
  const remainingPeriods = current.turns
    .filter((t) => t.period > completedThrough)
    .map((t) => t.period);

  // The new pot: every share still contributing, now including the new
  // member's. Members who already won still contribute (that's how a
  // tontine works — you keep paying in after your turn), so the pot is
  // simply the full membership's shares once the new member is added.
  const newTotalShares = current.totalShares + newMember.shares;
  const newPeriodicPot = newTotalShares * params.minimumShare;

  // Which payout slots still need placing in the remaining periods: every
  // winner not yet paid out in the settled turns, plus the new member's
  // shares. We reconstruct the not-yet-paid slots from the current
  // schedule's remaining turns, then add the newcomer's, then re-draw
  // their order across the remaining periods.
  const alreadyPaid = settledTurns.flatMap((t) => t.winners);
  const stillOwed: string[] = [];
  // Rebuild remaining owed slots from the current schedule's future turns.
  for (const turn of current.turns) {
    if (turn.period > completedThrough) stillOwed.push(...turn.winners);
  }
  // Add the newcomer's shares as new owed slots.
  for (let i = 0; i < newMember.shares; i++) stillOwed.push(newMember.memberId);

  const drawnRemaining = seededShuffle(stillOwed, seed);

  // Distribute across the remaining periods, doubling up as needed to fit
  // before the cap — same even-spread rule as the base schedule.
  const rebuiltTurns: ScheduledTurn[] = [];
  let slotIndex = 0;
  for (let i = 0; i < remainingPeriods.length; i++) {
    const period = remainingPeriods[i]!;
    const periodsLeft = remainingPeriods.length - i;
    const slotsLeft = drawnRemaining.length - slotIndex;
    const winnersThisTurn = Math.ceil(slotsLeft / periodsLeft);
    const winners = drawnRemaining.slice(slotIndex, slotIndex + winnersThisTurn);
    slotIndex += winnersThisTurn;
    rebuiltTurns.push({ period, winners, potPerWinner: newPeriodicPot });
  }

  const schedule: TontineSchedule = {
    periodicPot: newPeriodicPot,
    totalShares: newTotalShares,
    cycleLength: current.cycleLength,
    rebalanced: current.rebalanced || stillOwed.length > remainingPeriods.length,
    // Settled turns keep their original pots; only future turns carry the
    // new, higher pot.
    turns: [...settledTurns, ...rebuiltTurns],
  };

  // alreadyPaid is intentionally unused in the result but computed above
  // to document that settled winners are excluded from re-drawing.
  void alreadyPaid;

  return { schedule, newPeriodicPot };
}
