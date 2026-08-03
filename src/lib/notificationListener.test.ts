import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getNativePlugin,
  startNotificationListener,
  isAutomaticCaptureAvailable,
  openNotificationPermissionSettings,
  type NativeNotificationPlugin,
} from "./notificationListener";

// A stand-in for the native Capacitor plugin. Installing it onto
// globalThis.Capacitor.Plugins.NotificationBridge is exactly how the
// real native shell exposes it, so this exercises the real resolution
// path in getNativePlugin().
function installMockPlugin(plugin: Partial<NativeNotificationPlugin>) {
  (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
    Plugins: { NotificationBridge: plugin },
  };
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  vi.restoreAllMocks();
});

describe("notificationListener bridge — running as a plain PWA (no native plugin)", () => {
  it("getNativePlugin returns undefined", () => {
    expect(getNativePlugin()).toBeUndefined();
  });

  it("startNotificationListener reports inactive rather than throwing", async () => {
    const onParsed = vi.fn();
    const handle = await startNotificationListener(onParsed);
    expect(handle.active).toBe(false);
    expect(onParsed).not.toHaveBeenCalled();
    // remove() must be safe to call even when nothing was attached
    expect(() => handle.remove()).not.toThrow();
  });

  it("isAutomaticCaptureAvailable is false", async () => {
    expect(await isAutomaticCaptureAvailable()).toBe(false);
  });

  it("openNotificationPermissionSettings resolves quietly", async () => {
    await expect(openNotificationPermissionSettings()).resolves.toBeUndefined();
  });
});

describe("notificationListener bridge — running natively", () => {
  it("does not attach when permission hasn't been granted", async () => {
    installMockPlugin({
      checkPermission: async () => ({ granted: false }),
      addListener: vi.fn(),
    });
    const onParsed = vi.fn();
    const handle = await startNotificationListener(onParsed);
    expect(handle.active).toBe(false);
  });

  it("attaches and parses a captured MoMo notification into a draft when permission is granted", async () => {
    let capturedHandler: ((data: { text: string }) => void) | undefined;
    const remove = vi.fn();
    installMockPlugin({
      checkPermission: async () => ({ granted: true }),
      addListener: async (_event, handler) => {
        capturedHandler = handler;
        return { remove };
      },
    });

    const onParsed = vi.fn();
    const handle = await startNotificationListener(onParsed);
    expect(handle.active).toBe(true);

    // Simulate the native layer delivering a real MoMo notification
    capturedHandler?.({
      text: "Vous avez recu 450 XAF de HONORINE (237679963987) sur votre compte Mobile Money. Votre nouveau solde est de 11103 FCFA. Transaction ID: 18136684316.",
    });

    expect(onParsed).toHaveBeenCalledTimes(1);
    const draft = onParsed.mock.calls[0]![0];
    expect(draft.source).toBe("mtn-momo");
    expect(draft.direction).toBe("income");
    expect(draft.amount).toBe(450);

    handle.remove();
    expect(remove).toHaveBeenCalled();
  });

  it("silently drops a captured notification the parser doesn't recognize, without calling onParsed", async () => {
    let capturedHandler: ((data: { text: string }) => void) | undefined;
    installMockPlugin({
      checkPermission: async () => ({ granted: true }),
      addListener: async (_event, handler) => {
        capturedHandler = handler;
        return { remove: vi.fn() };
      },
    });

    const onParsed = vi.fn();
    await startNotificationListener(onParsed);
    capturedHandler?.({ text: "Promo: -50% sur ton forfait ce week-end!" });

    expect(onParsed).not.toHaveBeenCalled();
  });

  it("passes the user's own number through so an Orange Money transfer resolves direction", async () => {
    let capturedHandler: ((data: { text: string }) => void) | undefined;
    installMockPlugin({
      checkPermission: async () => ({ granted: true }),
      addListener: async (_event, handler) => {
        capturedHandler = handler;
        return { remove: vi.fn() };
      },
    });

    const onParsed = vi.fn();
    await startNotificationListener(onParsed, "656480453");
    capturedHandler?.({
      text: "Transfert de 656262382 AWOULOU vers 656480453 EBAKO AGBOR reussi. Montant Transaction: 30000FCFA, Nouveau Solde: 30386.78 FCFA.",
    });

    const draft = onParsed.mock.calls[0]![0];
    // 656480453 is the recipient → income, resolved (not left unknown)
    expect(draft.direction).toBe("income");
    expect(draft.needsReview).toBe(false);
  });

  it("isAutomaticCaptureAvailable reflects the granted permission", async () => {
    installMockPlugin({ checkPermission: async () => ({ granted: true }) });
    expect(await isAutomaticCaptureAvailable()).toBe(true);
  });
});
