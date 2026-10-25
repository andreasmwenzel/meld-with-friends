"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile for Supabase Auth's captcha check (guest sign-in and magic links).
 * The widget stays invisible unless Cloudflare wants an interaction. Without a site key
 * (local dev) `getToken` resolves undefined and Supabase must have captcha off.
 */
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface Turnstile {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  execute(id: string): void;
  reset(id: string): void;
  remove(id: string): void;
}
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement("script");
    s.src = SCRIPT; s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Captcha failed to load")));
    s.onerror = () => { loading = undefined; reject(new Error("Captcha failed to load. Check your connection.")); };
    document.head.appendChild(s);
  });
  return loading;
}

export function useCaptcha() {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: Turnstile; id: string } | null>(null);
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: Error) => void } | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    let cancelled = false;
    loadTurnstile().then((api) => {
      if (cancelled || !box.current) return;
      const id = api.render(box.current, {
        sitekey: SITE_KEY, execution: "execute", appearance: "interaction-only",
        callback: (token: string) => { pending.current?.resolve(token); pending.current = null; },
        "error-callback": () => { pending.current?.reject(new Error("Couldn't confirm you're a person. Try again.")); pending.current = null; },
        "expired-callback": () => api.reset(id),
      });
      widget.current = { api, id };
    }).catch(() => {});
    return () => { cancelled = true; if (widget.current) widget.current.api.remove(widget.current.id); widget.current = null; };
  }, []);

  /** A fresh single-use token; Supabase rejects reused ones. */
  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (!SITE_KEY) return undefined;
    if (!widget.current) await loadTurnstile();
    const w = widget.current;
    if (!w) throw new Error("Captcha is still loading. Try again in a moment.");
    w.api.reset(w.id);
    return new Promise<string>((resolve, reject) => { pending.current = { resolve, reject }; w.api.execute(w.id); });
  }, []);

  return { captchaSlot: <div ref={box} className="empty:hidden mt-3" />, getToken };
}
