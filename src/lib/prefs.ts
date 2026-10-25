"use client";

import { useSyncExternalStore } from "react";
import type { RulesPatch } from "@/components/rules/rules";

const KEY = "meld.rules";

/** Last-used house rules on this browser. Works for guests; the profile copy wins when signed in. */
export function loadRulesPref(): RulesPatch {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as RulesPatch) : {};
  } catch { return {}; }
}

export function saveRulesPref(rules: RulesPatch) {
  try { window.localStorage.setItem(KEY, JSON.stringify(rules)); } catch {}
}

const HIDE_OPPONENT_POINTS_KEY = "meld.hideOpponentPoints";
const POINTS_EVENT = "meld:opponent-points";

function readHideOpponentPoints(): boolean {
  try { return window.localStorage.getItem(HIDE_OPPONENT_POINTS_KEY) === "1"; } catch { return false; }
}

function subscribePoints(cb: () => void) {
  window.addEventListener(POINTS_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(POINTS_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function setHideOpponentPoints(hidden: boolean) {
  try { window.localStorage.setItem(HIDE_OPPONENT_POINTS_KEY, hidden ? "1" : "0"); } catch {}
  window.dispatchEvent(new Event(POINTS_EVENT));
}

/** Local score display choice, shared by the options and scorepad. */
export function useOpponentPointsPref() {
  const hideOpponentPoints = useSyncExternalStore(subscribePoints, readHideOpponentPoints, () => false);
  return { hideOpponentPoints, setHideOpponentPoints };
}
