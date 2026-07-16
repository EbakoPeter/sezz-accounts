import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/schema";
import { getRecommendations, type Insight } from "@/db/recommendations";

export function useRecommendations(year: number, month: number): Insight[] | undefined {
  return useLiveQuery(() => getRecommendations(year, month, db), [year, month]);
}
