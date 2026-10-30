"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { DEFAULT_HAND_SORT, type HandSortPrefs } from "@/engine/hand";
import { BACKS, CARD_PREFS_KEY as KEY, CLOTHS, type Back, type Cloth } from "./look";
export { BACKS, CLOTHS, type Back, type Cloth } from "./look";

const EVENT = "meld:cards";
/** A phone held sideways: wide enough to pass for a tablet, but too short for the stacked board. Matches the `short` CSS variant. */
export const SHORT_QUERY = "(orientation: landscape) and (max-height: 500px)";
/** Phone-sized cards and the fitted fan, upright or sideways. */
const PHONE_QUERY = `(max-width: 640px), ${SHORT_QUERY}`;
const COARSE_QUERY = "(pointer: coarse)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export type MotionPref = "normal" | "quick" | "off";

export type CardSize = "s" | "m" | "l";


/**
 * What is stored. `bigIndex: null` means "follow the device": on for phones, off for desktop.
 * Version 2 split the old single sort `order` into suit order and trump placement; version 1 has no `v`.
 */
type Stored = { v: 2; fourColour: boolean; bigIndex: boolean | null; size: CardSize; sort: HandSortPrefs; motion: MotionPref; confirmPlay: boolean | null; autoMeld: boolean; trumpTint: boolean; cloth: Cloth; back: Back };

/** Card display and hand sorting choices. */
export type CardPrefs = {
  fourColour: boolean; bigIndex: boolean; sort: HandSortPrefs; motion: MotionPref; confirmPlay: boolean;
  /** lay down your best meld and confirm it without any taps (default on); off means you pick the cards yourself */
  autoMeld: boolean;
  /** a faint wash on trump cards in your hand and in tricks (default on) */
  trumpTint: boolean;
};

export const HAND_WIDTH: Record<"phone" | "desktop", Record<CardSize, number>> = {
  phone: { s: 48, m: 58, l: 70 },
  desktop: { s: 72, m: 88, l: 104 },
};

const DEFAULTS: Stored = { v: 2, fourColour: false, bigIndex: null, size: "m", sort: DEFAULT_HAND_SORT, motion: "normal", confirmPlay: null, autoMeld: true, trumpTint: true, cloth: "oxblood", back: "lattice" };

/** Version 1's single choice, mapped to the pair that lays the hand out the same way. */
const V1_ORDER: Record<string, Pick<HandSortPrefs, "suits" | "trump">> = {
  "trump-first": { suits: "fixed", trump: "left" },
  suits: { suits: "fixed", trump: "off" },
  alternating: { suits: "alternating", trump: "left" },
};

function parseSort(sort: Record<string, unknown> | undefined): HandSortPrefs {
  const ranks = sort?.ranks === "low-first" ? "low-first" : DEFAULT_HAND_SORT.ranks;
  if (sort && !("trump" in sort) && typeof sort.order === "string") {
    const placed = Object.hasOwn(V1_ORDER, sort.order) ? V1_ORDER[sort.order] : DEFAULT_HAND_SORT;
    return { suits: placed.suits, trump: placed.trump, ranks };
  }
  return {
    suits: sort?.suits === "alternating" ? "alternating" : DEFAULT_HAND_SORT.suits,
    trump: sort?.trump === "right" ? "right" : sort?.trump === "off" ? "off" : DEFAULT_HAND_SORT.trump,
    ranks,
  };
}

/** Read stored card options, upgrading older versions so nobody's hand order changes. Exported for tests. */
export function parseCardPrefs(raw: string | null): Stored {
  if (!raw) return DEFAULTS;
  try {
    const v = JSON.parse(raw) as Partial<Omit<Stored, "sort">> & { sort?: Record<string, unknown> };
    return {
      v: 2,
      fourColour: v.fourColour === true,
      bigIndex: typeof v.bigIndex === "boolean" ? v.bigIndex : null,
      size: v.size === "s" || v.size === "l" ? v.size : "m",
      confirmPlay: typeof v.confirmPlay === "boolean" ? v.confirmPlay : null,
      autoMeld: v.autoMeld !== false,
      motion: v.motion === "quick" || v.motion === "off" ? v.motion : "normal",
      trumpTint: v.trumpTint !== false,
      cloth: CLOTHS.find(([c]) => c === v.cloth)?.[0] ?? "oxblood",
      back: BACKS.find(([b]) => b === v.back)?.[0] ?? "lattice",
      sort: parseSort(v.sort),
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
  const stored = useMemo(() => parseCardPrefs(raw || null), [raw]);

  const prefs: CardPrefs = useMemo(
    () => ({ fourColour: stored.fourColour, bigIndex: stored.bigIndex ?? phone, sort: stored.sort, motion: stored.motion, confirmPlay: stored.confirmPlay ?? coarse, autoMeld: stored.autoMeld, trumpTint: stored.trumpTint }),
    [stored, phone, coarse],
  );
  const width = HAND_WIDTH[phone ? "phone" : "desktop"][stored.size];

  const update = useCallback((patch: Partial<Omit<Stored, "v">>) => {
    const next = { ...parseCardPrefs(readRaw() || null), ...patch };
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
    if (patch.cloth) applyCloth(patch.cloth);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { prefs, size: stored.size, width, phone, short, reducedMotion, look: { cloth: stored.cloth, back: stored.back }, update };
}

/** Lays the cloth on the page and tints the phone's status bar to match. CLOTH_SCRIPT does the same before first paint. */
function applyCloth(cloth: Cloth) {
  document.documentElement.dataset.cloth = cloth;
  const swatch = CLOTHS.find(([c]) => c === cloth)?.[2];
  if (swatch) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", swatch);
}


function subscribeBack(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}

/**
 * Just the card back, for the many backs on the table: none of them needs the screen-size queries useCardPrefs
 * listens to. Server render and first paint use the lattice.
 */
export function useCardBack(): Back {
  const raw = useSyncExternalStore(subscribeBack, readRaw, () => "");
  return useMemo(() => parseCardPrefs(raw || null).back, [raw]);
}
