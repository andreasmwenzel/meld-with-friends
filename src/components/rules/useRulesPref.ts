"use client";

import { useEffect, useState } from "react";
import { resolveRules, type RulesPatch } from "./rules";
import { loadRulesPref, saveRulesPref } from "@/lib/prefs";
import { api } from "@/lib/api";

/** New tables allow shooting unless the player has saved a choice; the engine's own default stays off. */
const fromSaved = (saved?: RulesPatch | null) => resolveRules({ shoot: "on", ...saved });

/**
 * Rules state seeded from the player's saved defaults: the profile copy when signed in,
 * otherwise whatever this browser last dealt with. `remember` persists the choice both places.
 */
export function useRulesPref(profileDefaults?: RulesPatch | null) {
  const [rules, setRules] = useState<RulesPatch>(() => fromSaved(profileDefaults));
  useEffect(() => {
    if (!profileDefaults || Object.keys(profileDefaults).length === 0) {
      const local = loadRulesPref();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage after hydration
      if (Object.keys(local).length) setRules(fromSaved(local));
    }
  }, [profileDefaults]);
  async function remember(next: RulesPatch, signedIn: boolean) {
    saveRulesPref(next);
    if (signedIn) await api("/api/me", { method: "PATCH", body: { defaultRules: next } }).catch(() => {});
  }
  return { rules, setRules, remember };
}
