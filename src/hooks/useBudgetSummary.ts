import { useLiveQuery } from "dexie-react-hooks";
import { getBudgetSummary, type CategorySummary } from "@/db/budgetSummary";

export function useBudgetSummary(year: number, month: number): CategorySummary[] | undefined {
  return useLiveQuery(() => getBudgetSummary(year, month), [year, month]);
}
