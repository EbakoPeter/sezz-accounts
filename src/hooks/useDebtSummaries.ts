import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/schema";
import { getAllDebtSummaries, type DebtSummary } from "@/db/debtSummary";

export function useDebtSummaries(): DebtSummary[] | undefined {
  return useLiveQuery(() => getAllDebtSummaries(db), []);
}
