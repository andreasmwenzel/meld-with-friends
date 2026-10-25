"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_HAND_SORT, type HandSortPrefs } from "@/engine/hand";

const KEY = "meld.cards";
const EVENT = "meld:cards";
/** A phone held sideways: wide enough to pass for a tablet, but too short for the stacked board. Matches the `short` CSS variant. */
export const SHORT_QUERY = "(orientation: landscape) and (max-height: 500px)";
/** Phone-sized cards and the fitted fan, upright or sideways. */
const PHONE_QUERY = `(max-width: 640px), ${SHORT_QUERY}`;
const COARSE_QUERY = "(pointer: coarse)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type MotionPref = "normal" | "quick" | "off";

export type CardSize = "s" | "m" | "l";

/** What is stored. `bigIndex: null` means "follow the device": on for phones, off for desktop. */
type Stored = { fourColour: boolean; bigIndex: boolean | null; size: CardSize; sort: HandSortPrefs; motion: MotionPref; confirmPlay: boolean | null; autoMeld: boolean };

/** Card display and hand sorting choices. */
export type CardPrefs = {
  fourColour: boolean; bigIndex: boolean; sort: HandSortPrefs; motion: MotionPref; confirmPlay: boolean;
  /** lay down your best meld and confirm it without any taps (default on); off means you pick the cards yourself */
  autoMeld: boolean;
};

export const HAND_WIDTH: Record<"phone" | "desktop", Record<CardSize, number>> = {
  phone: { s: 48, m: 58, l: 70 },
  desktop: { s: 72, m: 88, l: 104 },
};

const DEFAULTS: Stored = { fourColour: false, bigIndex: null, size: "m", sort: DEFAULT_HAND_SORT, motion: "normal", confirmPlay: null, autoMeld: true };

function parse(raw: string | null): Stored {
  if (!raw) return DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<Stored>;
    return {
      fourColour: v.fourColour === true,
      bigIndex: typeof v.bigIndex === "boolean" ? v.bigIndex : null,
      size: v.size === "s" || v.size === "l" ? v.size : "m",
      confirmPlay: typeof v.confirmPlay === "boolean" ? v.confirmPlay : null,
      autoMeld: v.autoMeld !== false,
      motion: v.motion === "quick" || v.motion === "off" ? v.motion : "normal",
      sort: {
        order: v.sort?.order === "suits" || v.sort?.order === "alternating" ? v.sort.order : DEFAULT_HAND_SORT.order,
        ranks: v.sort?.ranks === "low-first" ? v.sort.ranks : DEFAULT_HAND_SORT.ranks,
      },
    };
  } catch { return DEFAULTS; }
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  const reducedMq = window.matchMedia(REDUCED_MOTION_QUERY);
  const coarseMq = window.matchMedia(COARSE_QUERY);
  const shortMq = window.matchMedia(SHORT_QUERY);
  shortMq.addEventListener("change", cb);
  coarseMq.addEventListener("change", cb);
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  mq.addEventListener("change", cb);
  reducedMq.addEventListener("change", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
    mq.removeEventListener("change", cb);
    reducedMq.removeEventListener("change", cb);
    coarseMq.removeEventListener("change", cb);
    shortMq.removeEventListener("change", cb);
  };
}

function readRaw(): string { try { return window.localStorage.getItem(KEY) ?? ""; } catch { return ""; } }
function readPhone(): boolean { return window.matchMedia(PHONE_QUERY).matches; }

function readShort(): boolean { return window.matchMedia(SHORT_QUERY).matches; }

function readCoarse(): boolean { return window.matchMedia(COARSE_QUERY).matches; }

function readReducedMotion(): boolean { return window.matchMedia(REDUCED_MOTION_QUERY).matches; }

/**
 * Card display options, remembered on this browser. Server render and first paint use the
 * standard deck; the stored choice applies as soon as the client hydrates.
 */
export function useCardPrefs() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "");
  const phone = useSyncExternalStore(subscribe, readPhone, () => false);
  const coarse = useSyncExternalStore(subscribe, readCoarse, () => false);
  const short = useSyncExternalStore(subscribe, readShort, () => false);
  const reducedMotion = useSyncExternalStore(subscribe, readReducedMotion, () => false);
  const stored = useMemo(() => parse(raw || null), [raw]);

  const prefs: CardPrefs = useMemo(
    () => ({ fourColour: stored.fourColour, bigIndex: stored.bigIndex ?? phone, sort: stored.sort, motion: stored.motion, confirmPlay: stored.confirmPlay ?? coarse, autoMeld: stored.autoMeld }),
    [stored, phone, coarse],
  );
  const width = HAND_WIDTH[phone ? "phone" : "desktop"][stored.size];

  const update = useCallback((patch: Partial<Stored>) => {
    const next = { ...parse(readRaw() || null), ...patch };
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { prefs, size: stored.size, width, phone, short, reducedMotion, update };
}
