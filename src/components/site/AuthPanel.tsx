"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { useCaptcha } from "@/lib/captcha";
import { authRetrySeconds, startAuthRetry } from "./authRetry";

export function AuthPanel({ next = "/" }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");
  const [retrySeconds, setRetrySeconds] = useState(0);
  const cancelRetry = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelRetry.current?.();
    };
  }, []);
  const { captchaSlot, getToken } = useCaptcha();

  async function sendLink(e: FormEvent) {
    e.preventDefault();
    if (state === "sending" || retrySeconds > 0) return;
    setState("sending");
    const supabase = createClient();
    let captchaToken: string | undefined;
    try { captchaToken = await getToken(); } catch (err) { setState("error"); setMessage((err as Error).message); return; }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { captchaToken, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (!mounted.current) return;
    if (error) {
      const seconds = authRetrySeconds(error.message);
      if (seconds !== null) {
        setState("idle");
        setMessage("");
        setRetrySeconds(seconds);
        cancelRetry.current?.();
        cancelRetry.current = startAuthRetry(seconds, setRetrySeconds);
      } else {
        setState("error");
        setMessage(error.message);
      }
    } else {
      setState("sent");
    }
  }

  async function google() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  }

  if (state === "sent") {
    return (
      <div className="panel p-6">
        <p className="display" style={{ fontSize: 26 }}>Check your email</p>
        <p className="mt-2 text-ink-soft">
          A sign-in link is on its way to {email}. Open it on this device and you&rsquo;ll land at the table.
        </p>
        <button className="tap mt-2 text-sm underline text-deck-blue" onClick={() => setState("idle")}>
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <div className="panel p-5 sm:p-6">
      <form onSubmit={sendLink} className="flex flex-col gap-3">
        <label className="text-sm text-ink-soft" htmlFor="email">Sign in with your email</label>
        <div className="flex gap-2">
          <input
            id="email"
            className="field"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="btn btn-ink shrink-0" disabled={state === "sending" || retrySeconds > 0}>
            {retrySeconds > 0 ? `Retry in ${retrySeconds}s` : state === "sending" ? "Sending" : "Send link"}
          </button>
        </div>
        {state === "error" && (
          <p className="text-sm text-pip-red">Couldn&rsquo;t send the link: {message}</p>
        )}
        {captchaSlot}
      </form>
      <div className="my-4 flex items-center gap-3 text-ink-soft text-sm">
        <span className="h-px flex-1 bg-chalk-dim" /> or <span className="h-px flex-1 bg-chalk-dim" />
      </div>
      <button className="btn btn-chalk w-full" style={{ boxShadow: "inset 0 0 0 1.5px var(--chalk-dim)" }} onClick={google}>
        Continue with Google
      </button>
      <p className="mt-4 text-xs text-ink-soft">No password to remember. Free, no ads, friends only.</p>
    </div>
  );
}
