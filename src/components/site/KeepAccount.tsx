"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

/** Turns a guest session into a permanent account by attaching an email or Google. */
export function KeepAccount() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function attachEmail(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=/home` },
    );
    if (error) { setState("error"); setMessage(error.message); } else setState("sent");
  }

  async function google() {
    const supabase = createClient();
    const { error } = await supabase.auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/home` },
    });
    if (error) { setState("error"); setMessage(error.message); }
  }

  return (
    <div className="panel p-5 max-w-md">
      <p className="display" style={{ fontSize: 24 }}>Keep this account</p>
      {state === "sent" ? (
        <p className="mt-2 text-ink-soft">Check your email for a confirmation link. Once you open it, your tables and friends stay with you on any device.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-soft">
            You are playing as a guest on this browser. Add an email to keep your history and friends list.
          </p>
          <form onSubmit={attachEmail} className="mt-3 flex gap-2">
            <label htmlFor="keep-email" className="sr-only">Email</label>
            <input id="keep-email" className="field" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn btn-ink shrink-0" disabled={state === "sending"}>{state === "sending" ? "Sending" : "Add email"}</button>
          </form>
          <button className="tap mt-1 text-sm text-deck-blue underline" onClick={google}>Or link a Google account</button>
          {state === "error" && <p className="mt-2 text-sm text-pip-red">{message}</p>}
        </>
      )}
    </div>
  );
}
