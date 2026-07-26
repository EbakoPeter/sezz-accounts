import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAutoSync } from "./useAutoSync";
import * as syncClient from "./syncClient";
import * as syncEngine from "./syncEngine";

const fakeSession = {
  serverUrl: "https://sync.example.com",
  token: "tok",
  syncAccountId: "acct-1",
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAutoSync", () => {
  it("does nothing when no sync session is configured", async () => {
    vi.spyOn(syncClient, "getSyncSession").mockResolvedValue(undefined);
    const syncNowSpy = vi.spyOn(syncEngine, "syncNow");

    renderHook(() => useAutoSync());
    await vi.waitFor(() => expect(syncClient.getSyncSession).toHaveBeenCalled());

    expect(syncNowSpy).not.toHaveBeenCalled();
  });

  it("syncs once automatically when the app opens, if a session exists", async () => {
    vi.spyOn(syncClient, "getSyncSession").mockResolvedValue(fakeSession);
    const syncNowSpy = vi.spyOn(syncEngine, "syncNow").mockResolvedValue({
      push: { pushed: 0 },
      pull: { pulled: 0, deleted: 0 },
    });

    renderHook(() => useAutoSync());
    await vi.waitFor(() => expect(syncNowSpy).toHaveBeenCalledTimes(1));
  });

  it("syncs again after the interval elapses", async () => {
    vi.spyOn(syncClient, "getSyncSession").mockResolvedValue(fakeSession);
    const syncNowSpy = vi.spyOn(syncEngine, "syncNow").mockResolvedValue({
      push: { pushed: 0 },
      pull: { pulled: 0, deleted: 0 },
    });

    renderHook(() => useAutoSync());
    await vi.waitFor(() => expect(syncNowSpy).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await vi.waitFor(() => expect(syncNowSpy).toHaveBeenCalledTimes(2));
  });

  it("syncs when the device comes back online", async () => {
    vi.spyOn(syncClient, "getSyncSession").mockResolvedValue(fakeSession);
    const syncNowSpy = vi.spyOn(syncEngine, "syncNow").mockResolvedValue({
      push: { pushed: 0 },
      pull: { pulled: 0, deleted: 0 },
    });

    renderHook(() => useAutoSync());
    await vi.waitFor(() => expect(syncNowSpy).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(syncNowSpy).toHaveBeenCalledTimes(2));
  });

  it("does not overlap a second attempt while one is still in flight", async () => {
    vi.spyOn(syncClient, "getSyncSession").mockResolvedValue(fakeSession);
    let resolveFirst!: () => void;
    const firstAttempt = new Promise<syncEngine.SyncResult>((resolve) => {
      resolveFirst = () => resolve({ push: { pushed: 0 }, pull: { pulled: 0, deleted: 0 } });
    });
    const syncNowSpy = vi.spyOn(syncEngine, "syncNow").mockReturnValueOnce(firstAttempt);

    renderHook(() => useAutoSync());
    await vi.waitFor(() => expect(syncNowSpy).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event("online"));
    await Promise.resolve();
    expect(syncNowSpy).toHaveBeenCalledTimes(1);

    resolveFirst();
  });

  it("does not sync again after unmounting", async () => {
    vi.spyOn(syncClient, "getSyncSession").mockResolvedValue(fakeSession);
    const syncNowSpy = vi.spyOn(syncEngine, "syncNow").mockResolvedValue({
      push: { pushed: 0 },
      pull: { pulled: 0, deleted: 0 },
    });

    const { unmount } = renderHook(() => useAutoSync());
    await vi.waitFor(() => expect(syncNowSpy).toHaveBeenCalledTimes(1));

    unmount();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(syncNowSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows a sync failure silently rather than throwing", async () => {
    vi.spyOn(syncClient, "getSyncSession").mockResolvedValue(fakeSession);
    const syncNowSpy = vi
      .spyOn(syncEngine, "syncNow")
      .mockRejectedValue(new Error("Panne serveur."));

    expect(() => renderHook(() => useAutoSync())).not.toThrow();
    await vi.waitFor(() => expect(syncNowSpy).toHaveBeenCalled());
  });
});
