import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/schema";
import { getMonthlyReport, type MonthlyReportRow } from "@/db/monthlyReport";

export function useMonthlyReport(year: number): MonthlyReportRow[] | undefined {
  return useLiveQuery(() => getMonthlyReport(year, db), [year]);
}
