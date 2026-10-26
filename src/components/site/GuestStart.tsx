"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { api } from "@/lib/api";
import { RulesForm } from "@/components/rules/RulesForm";
import type { RulesPatch } from "@/components/rules/rules";
import { useRulesPref } from "@/components/rules/useRulesPref";
import { useCaptcha } from "@/lib/captcha";

const ALPHABET = /[^23456789BCDFGHJKMNPQRSTVWXYZ]/g;

/**
 * Start playing with just a name. Creates an anonymous session on the spot; the player can
 * attach an email or Google later from the lobby to keep history and friends.
 */
export function GuestStart({ mode = "both", code: initialCode = "", signedIn = false, defaults = null }: {
  mode?: "both" | "join"; code?: string; signedIn?: boolean; defaults?: RulesPatch | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode.toUpperCase().replace(ALPHABET, "").slice(0, 6));
  const [busy, setBusy] = useState<"deal" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { rules, setRules, remember } = useRulesPref(defaults);
  const [showRules, setShowRules] = useState(false);
  const { captchaSlot, getToken } = useCaptcha();

  async function ensureSession() {
    if (signedIn) return;
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) return;
    const trimmed = name.trim();
    const { error } = await supabase.auth.signInAnonymously({ options: { data: { full_name: trimmed }, captchaToken: await getToken() } });
    if (error) throw new Error(error.message);
    if (trimmed) await api("/api/me", { method: "PATCH", body: { displayName: trimmed } }).catch(() => {});
  }

  async function deal(e: FormEvent) {
    e.preventDefault();
    setBusy("deal"); setError(null);
    try {
      await ensureSession();
      const t = await api<{ code: string }>("/api/tables", { body: { gameKind: "pinochle", rules } });
      void remember(rules, signedIn);
      router.push(`/t/${t.code}`);
      router.refresh();
    } catch (err) { setError((err as Error).message); setBusy(null); }
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) { setError("A table code is six letters."); return; }
    setBusy("join"); setError(null);
    try {
      await ensureSession();
      const res = await fetch(`/api/tables/${code}`, { cache: "no-store" });
      if (res.status === 404) throw new Error("No table has that code. Check it with whoever dealt the table.");
      if (!res.ok) throw new Error("Something went wrong. Try again.");
      router.push(`/t/${code}`);
      router.refresh();
    } catch (err) { setError((err as Error).message); setBusy(null); }
  }

  const needsName = !signedIn;

  return (
    <div className="panel p-5 sm:p-6">
      {needsName && (
        <label className="block text-sm text-ink-soft">
          What should the table call you?
          <input className="field mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your first name" maxLength={40} autoComplete="given-name" />
        </label>
      )}
      <div className={`grid gap-3 ${needsName ? "mt-4" : ""} ${mode === "both" ? "sm:grid-cols-2" : ""}`}>
        {mode === "both" && (
          <form onSubmit={deal}>
            <button className="btn btn-ink w-full" disabled={busy !== null || (needsName && !name.trim())}>
              {busy === "deal" ? "Dealing" : "Deal a new table"}
            </button>
            <p className="mt-1.5 flex items-center justify-between gap-3 text-xs text-ink-soft">
              You get a code to share.
              <button type="button" className="text-sm text-deck-blue underline" aria-expanded={showRules} onClick={() => setShowRules((v) => !v)}>
                {showRules ? "Hide house rules" : "House rules"}
              </button>
            </p>
          </form>
        )}
        <form onSubmit={join} className="flex gap-2">
          <label htmlFor="join-code" className="sr-only">Table code</label>
          <input
            id="join-code" className="field uppercase" style={{ letterSpacing: ".18em", fontWeight: 600 }}
            value={code} placeholder="CODE" maxLength={6} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(ALPHABET, "").slice(0, 6))}
          />
          <button className="btn btn-chalk shrink-0" style={{ boxShadow: "inset 0 0 0 1.5px var(--chalk-dim)" }}
            disabled={busy !== null || code.length !== 6 || (needsName && !name.trim())}>
            {busy === "join" ? "Finding" : "Join"}
          </button>
        </form>
      </div>
      {mode === "both" && showRules && <div className="mt-3"><RulesForm value={rules} onChange={setRules} compact /></div>}
      {needsName && captchaSlot}
      {error && <p className="mt-3 text-sm text-pip-red">{error}</p>}
      {needsName && (
        <p className="mt-4 text-xs text-ink-soft">
          No account needed. You can add an email later to keep your history and friends.
        </p>
      )}
    </div>
  );
}
