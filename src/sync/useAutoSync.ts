import { useEffect, useRef } from "react";
import { getSyncSession } from "@/sync/syncClient";
import { syncNow } from "@/sync/syncEngine";

/** How often to retry sync automatically while the app stays open. A
 * personal finance app doesn't need near-real-time sync — every few
 * minutes is frequent enough to feel "automatic" without syncing so often
 * it meaningfully affects battery/data usage on a phone. */
const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Runs a sync automatically: once when the app opens, again every
 * AUTO_SYNC_INTERVAL_MS while it stays open, and once more whenever the
 * device regains network connectivity (the `online` event) — covering the
 * common case of "was offline for a while, is back now" without waiting
 * for the next interval tick. Does nothing at all if no sync account is
 * configured on this device (see syncClient.ts).
 *
 * Deliberately silent on failure: there is no good place to surface an
 * error from a trigger nobody consciously initiated. The outcome (success
 * or failure) is still recorded via syncNow's own status tracking, so the
 * Synchronisation tab reflects it whenever the person next looks —
 * whether this hook or the manual button caused it.
 *
 * Only one attempt runs at a time: if the interval or the online event
 * fires while a sync is still in flight, that trigger is simply skipped
 * rather than queued or overlapping the one already running.
 */
export function useAutoSync(): void {
  const syncingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function attemptSync() {
      if (syncingRef.current || cancelled) return;
      const session = await getSyncSession();
      if (!session || cancelled) return;

      syncingRef.current = true;
      try {
        await syncNow(session);
      } catch {
        // Intentionally swallowed — see the module-level comment above.
      } finally {
        syncingRef.current = false;
      }
    }

    void attemptSync();
    const interval = setInterval(() => void attemptSync(), AUTO_SYNC_INTERVAL_MS);
    const handleOnline = () => void attemptSync();
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", handleOnline);
    };
  }, []);
}
