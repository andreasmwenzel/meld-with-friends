"use client";

import { useEffect, useRef, useState } from "react";

async function subscriptionRequest(method: "POST" | "DELETE", value: unknown) {
  const response = await fetch("/api/push/subscribe", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? "Could not save notification preferences.");
  }
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const available = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (active) setSupported(available);
      if (!available) return;
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const subscription = await registration.pushManager.getSubscription();
        if (active) setEnabled(!!subscription && Notification.permission === "granted");
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Could not register notifications.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function enable() {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try {
      if (!supported) throw new Error("Push notifications are not supported in this browser.");
      // Ask during the user's click so browsers preserve the activation gesture.
      if (await Notification.requestPermission() !== "granted") throw new Error("Notification permission was not granted.");
      const response = await fetch("/api/push/key", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the notification key.");
      const { publicKey } = await response.json();
      if (!publicKey) throw new Error("Notifications are not configured yet.");
      await navigator.serviceWorker.register("/sw.js");
      const registration = await navigator.serviceWorker.ready;
      const previous = await registration.pushManager.getSubscription();
      const subscription = previous ?? await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey),
      });
      try { await subscriptionRequest("POST", { subscription: subscription.toJSON() }); }
      catch (cause) {
        if (!previous) await subscription.unsubscribe();
        throw cause;
      }
      setEnabled(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not enable notifications."); }
    finally { running.current = false; setBusy(false); }
  }

  async function disable() {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try {
      if (!supported) throw new Error("Push notifications are not supported in this browser.");
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await subscriptionRequest("DELETE", { endpoint: subscription.endpoint });
        if (!await subscription.unsubscribe()) throw new Error("Could not unsubscribe this browser. Try again.");
      }
      setEnabled(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not disable notifications."); }
    finally { running.current = false; setBusy(false); }
  }

  return { supported, enabled, enable, disable, busy, error };
}
