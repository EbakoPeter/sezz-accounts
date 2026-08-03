import { parseNotification, type ParsedNotification } from "@/lib/notificationParser";

/**
 * The shape of the native Capacitor plugin, when one is present. In a
 * plain browser/PWA there is no native layer at all, so every method
 * here is optional and the wrapper below degrades gracefully rather
 * than throwing — the paste-the-text import flow keeps working with or
 * without the native listener.
 */
export interface NativeNotificationPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  openPermissionSettings(): Promise<void>;
  addListener(
    eventName: "onMobileMoneyNotification",
    handler: (data: { title?: string; text: string; packageName?: string }) => void,
  ): Promise<{ remove: () => void }>;
}

/** Package names of the apps whose notifications are worth parsing. Used
 * on the native side to filter, but kept here too so the bridge can be
 * reasoned about and tested in one place. */
export const MOBILE_MONEY_PACKAGES = [
  "com.orange.omoney", // Orange Money
  "cm.orange.omoney",
  "com.mtn.momo", // MTN MoMo
  "cm.mtn.momo",
] as const;

/**
 * Resolves the native plugin if the app is running inside the Capacitor
 * native shell AND the plugin was registered; otherwise undefined. This
 * is intentionally defensive: the exact same web bundle runs as a plain
 * PWA (where no native plugin exists) and inside the native app, so this
 * must never assume the plugin is there.
 */
export function getNativePlugin(): NativeNotificationPlugin | undefined {
  const cap = (globalThis as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  const plugin = cap?.Plugins?.["NotificationBridge"];
  return plugin as NativeNotificationPlugin | undefined;
}

export interface NotificationListenerHandle {
  /** Whether a real native listener was actually attached — false when
   * running as a plain PWA, so the caller can show the right UI (e.g.
   * "install the Android app for automatic detection"). */
  active: boolean;
  remove: () => void;
}

/**
 * Starts listening for Mobile Money notifications, if running natively
 * with permission granted. Each captured notification is run through the
 * exact same parser the paste-the-text flow uses, then handed to
 * `onParsed` as a draft — never recorded automatically, consistent with
 * the confirm-first (Option B) design: the native layer only *captures*,
 * the user still confirms.
 *
 * Returns a handle whose `active` flag tells the caller whether a real
 * listener was attached. In a plain PWA it returns `{ active: false }`
 * immediately, no error — the paste flow remains the way to import.
 */
export async function startNotificationListener(
  onParsed: (draft: ParsedNotification, rawText: string) => void,
  ownNumber?: string,
): Promise<NotificationListenerHandle> {
  const plugin = getNativePlugin();
  if (!plugin) {
    return { active: false, remove: () => {} };
  }

  const { granted } = await plugin.checkPermission();
  if (!granted) {
    // Don't force the settings screen open here — let the caller decide
    // when to prompt (openNotificationPermissionSettings below). Just
    // report that we couldn't attach.
    return { active: false, remove: () => {} };
  }

  const listener = await plugin.addListener("onMobileMoneyNotification", (data) => {
    const draft = parseNotification(data.text, ownNumber);
    if (draft) onParsed(draft, data.text);
    // If the parser doesn't recognize it, we simply drop it — a
    // notification we can't understand is not worth surfacing as a
    // broken draft; the user can always paste it manually.
  });

  return {
    active: true,
    remove: () => listener.remove(),
  };
}

/** Opens the Android "notification access" settings screen so the user
 * can grant permission. No-op (resolves) when not running natively. */
export async function openNotificationPermissionSettings(): Promise<void> {
  const plugin = getNativePlugin();
  if (!plugin) return;
  await plugin.openPermissionSettings();
}

/** Whether automatic capture is even possible in the current runtime —
 * i.e. we're in the native shell with the plugin present. Lets the UI
 * show "paste your notification" vs "automatic detection is on". */
export async function isAutomaticCaptureAvailable(): Promise<boolean> {
  const plugin = getNativePlugin();
  if (!plugin) return false;
  const { granted } = await plugin.checkPermission();
  return granted;
}
