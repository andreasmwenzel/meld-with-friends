// The pure half of scripts/overlap.mjs: given the boxes measured on one screen, which controls sit on a hand.
// Kept free of Chrome and the DOM so src/lib/__tests__/overlapGeometry.test.ts can run it on fixture boxes.

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 * `clip` is what can show of an element: the screen cut down by ancestors that hide overflow. Defaults to the screen.
 * A hand's cards carry their id as `label`; `declared` is how many cards the page says the hand holds (data-hand-cards).
 * A control's `own` is a card it is meant to sit on (the Play button on the card it plays).
 * @typedef {{ hand: string, cards: (Box & { label?: string })[], scrolls?: boolean, clip?: Box, declared?: number | null }} Hand
 * @typedef {Box & { name: string, coveredBy?: string[], clip?: Box, own?: string | null }} Overlay
 * `expected` lists the hands the page says it draws (data-hands); `sittingOut` is the seat set aside for a shoot, if any.
 * `controls` are the interactive controls with how far a tap reaches them (w x h, probed in the page); `card` marks
 * a card of your hand.
 * @typedef {{ name: string, w: number, h: number, card?: boolean, by?: string[] }} Target
 * @typedef {{ vw: number, vh: number, hands: Hand[], overlays: Overlay[], plates?: Overlay[], controls?: Target[], expected?: string[] | null, sittingOut?: string | null }} Snapshot
 * @typedef {{ kind: "control" | "controls" | "hands" | "clipped" | "covered" | "edge" | "small", a: string, b: string, cards: number, area: number, by?: string[] }} Hit
 */

/** Overlaps thinner than this (px, either way) are shadows and rounding, not one thing covering another. */
export const TOLERANCE = 2;

/**
 * Intended overlaps. Everything not listed here fails.
 * - Cards of one hand overlap each other (a fan, a squared stack): never compared.
 * - The trick area and the meld laid on the cloth are not hands and not controls, so they are not measured.
 * - The table talk popover is a dialog the player opens and closes with a tap; on a phone it has to lie over the
 *   cloth, so it may cover the other seats' cards. It must still leave your own hand clear.
 * @type {{ overlay: RegExp, hand: RegExp, why: string }[]}
 */
export const ALLOW = [
  { overlay: /^chat-popover$/, hand: /^(west|north|east|table)$/, why: "the open talk popover may lie over the other seats and the cloth while it is open" },
];

/** The overlapping part of two boxes, or null when they only touch or overlap by less than `tol`. */
export function intersect(/** @type {Box} */ a, /** @type {Box} */ b, tol = TOLERANCE) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > tol && h > tol ? { x, y, w, h } : null;
}

/**
 * Controls that may lie on top of another control (the page draws them over it). Everything else drawn over a control fails.
 * @type {{ over: RegExp, why: string }[]}
 */
export const ALLOW_COVER = [
  { over: /^chat-popover$/, why: "the open talk popover lies over whatever it opens on" },
];

/**
 * Controls whose boxes may overlap. Every other pair of controls that overlaps fails.
 * @type {{ a: RegExp, b: RegExp, why: string }[]}
 */
export const ALLOW_CONTROLS = [
  { a: /^chat-popover$/, b: /./, why: "the open talk popover lies over whatever it opens on" },
  { a: /^chat-badge$/, b: /^chat$/, why: "the unread count sits on the corner of the talk button" },
];

/** The smallest tap target, each way (px): the platform guidance for touch, so a thumb lands on what it aims at. */
export const MIN_TARGET = 44;

/**
 * Controls that may be smaller to tap. Everything else must take a tap over at least MIN_TARGET each way.
 * @type {{ match: (t: Target) => boolean, why: string }[]}
 */
export const ALLOW_SMALL = [
  { match: (t) => !!t.card && t.h >= MIN_TARGET - 1, why: "cards in your fan overlap: each takes a tap over the strip it shows, its full height; the fan's spacing is set by how many cards fit" },
];

/** Whether `b` shows whole inside `clip` (sideways too unless `across` is false: a hand that scrolls). */
export function inside(/** @type {Box} */ b, /** @type {Box} */ clip, across = true, tol = TOLERANCE) {
  const down = b.y >= clip.y - tol && b.y + b.h <= clip.y + clip.h + tol;
  return down && (!across || (b.x >= clip.x - tol && b.x + b.w <= clip.x + clip.w + tol));
}

/** @param {string} overlay @param {string} hand */
export function allowed(overlay, hand, allow = ALLOW) {
  return allow.find((r) => r.overlay.test(overlay) && r.hand.test(hand)) ?? null;
}

/**
 * Every control lying on a hand card, every control drawn over by another one, every card of one hand lying on a
 * card of another, every hand with cards cut off (by the screen or a box that hides overflow; sideways not for a hand
 * that scrolls, as yours does when it is too wide), every control or seat plate (with its turn ring) cut off, and every
 * control that takes a tap over less than MIN_TARGET each way.
 * ALLOW and ALLOW_COVER list the exceptions.
 * One hit per (control, hand) or (hand, hand) pair, counting the cards involved.
 * @param {Snapshot} snap
 * @returns {{ failures: Hit[], allowed: (Hit & { why: string })[] }}
 */
export function findOverlaps(snap, allow = ALLOW, allowCover = ALLOW_COVER, allowControls = ALLOW_CONTROLS) {
  /** @type {Hit[]} */ const failures = [];
  /** @type {(Hit & { why: string })[]} */ const ok = [];
  for (const o of snap.overlays) {
    for (const hand of snap.hands) {
      let cards = 0, area = 0;
      for (const c of hand.cards) {
        if (o.own && c.label === o.own) continue;
        const i = intersect(o, c);
        if (i) { cards++; area = Math.max(area, Math.round(i.w * i.h)); }
      }
      if (!cards) continue;
      const hit = /** @type {Hit} */ ({ kind: "control", a: o.name, b: hand.hand, cards, area });
      const rule = allowed(o.name, hand.hand, allow);
      if (rule) ok.push({ ...hit, why: rule.why }); else failures.push(hit);
    }
  }
  for (let i = 0; i < snap.overlays.length; i++) {
    for (let j = i + 1; j < snap.overlays.length; j++) {
      const A = snap.overlays[i], B = snap.overlays[j];
      const x = intersect(A, B);
      if (!x) continue;
      const hit = /** @type {Hit} */ ({ kind: "controls", a: A.name, b: B.name, cards: 0, area: Math.round(x.w * x.h) });
      const rule = allowControls.find((r) => (r.a.test(A.name) && r.b.test(B.name)) || (r.a.test(B.name) && r.b.test(A.name)));
      if (rule) ok.push({ ...hit, why: rule.why }); else failures.push(hit);
    }
  }
  for (const o of snap.overlays) {
    for (const by of o.coveredBy ?? []) {
      const hit = /** @type {Hit} */ ({ kind: "covered", a: by, b: o.name, cards: 0, area: 0 });
      const rule = allowCover.find((r) => r.over.test(by));
      if (rule) ok.push({ ...hit, why: rule.why }); else failures.push(hit);
    }
  }
  for (let i = 0; i < snap.hands.length; i++) {
    for (let j = i + 1; j < snap.hands.length; j++) {
      const A = snap.hands[i], B = snap.hands[j];
      if (A.hand === B.hand) continue;
      let cards = 0, area = 0;
      for (const a of A.cards) for (const b of B.cards) {
        const x = intersect(a, b);
        if (x) { cards++; area = Math.max(area, Math.round(x.w * x.h)); }
      }
      if (cards) failures.push({ kind: "hands", a: A.hand, b: B.hand, cards, area });
    }
  }
  const screen = { x: 0, y: 0, w: snap.vw, h: snap.vh };
  for (const hand of snap.hands) {
    const out = hand.cards.filter((c) => !inside(c, hand.clip ?? screen, !hand.scrolls));
    if (out.length) failures.push({ kind: "clipped", a: "edge", b: hand.hand, cards: out.length, area: 0 });
  }
  for (const t of snap.controls ?? []) {
    // The page probes in whole pixels from a middle that may fall between two, so a 44px area can read as 43.
    if (t.w >= MIN_TARGET - 1 && t.h >= MIN_TARGET - 1) continue;
    const hit = /** @type {Hit} */ ({ kind: "small", a: `${t.w}x${t.h}`, b: t.name, cards: 0, area: 0, by: t.by });
    const rule = ALLOW_SMALL.find((r) => r.match(t));
    if (rule) ok.push({ ...hit, why: rule.why }); else failures.push(hit);
  }
  for (const o of [...snap.overlays, ...(snap.plates ?? [])]) {
    // Tight here: a turn ring is only 2px, so the usual tolerance would let it vanish unnoticed.
    if (!inside(o, o.clip ?? screen, true, 0.5)) failures.push({ kind: "edge", a: "edge", b: o.name, cards: 0, area: 0 });
  }
  return { failures, allowed: ok };
}

/**
 * Whether the screen holds what it should, so a check cannot pass by measuring nothing. Fails when the page does not
 * say which hands it draws, when a hand it names is missing or holds a different number of cards than it says, when a
 * hand is measured with no cards, when your own hand's row is missing, and, in a hand shown face up (`faceUp`), when any of
 * the four hands is missing (but for a seat that sat out a shoot: a shooter's claim shows no cards for it).
 * @param {Snapshot} snap
 * @param {{ faceUp?: boolean }} [opts]
 * @returns {string[]} what is wrong, one line each
 */
export function checkPresence(snap, { faceUp = false } = {}) {
  const problems = [];
  // A hand the page says is empty (all your meld on the table, say) and that is empty is simply not drawn.
  const byName = new Map(snap.hands.filter((h) => h.hand !== "table" && !(h.declared === 0 && !h.cards.length)).map((h) => [h.hand, h]));
  if (!snap.expected) problems.push("the board does not say which hands it draws (data-hands)");
  // Your hand's row is always there, even empty (every card laid down as meld); its cards are needed when it says so.
  if (!snap.hands.some((h) => h.hand === "mine")) problems.push("mine hand not found");
  const need = new Set([...(snap.expected ?? []), ...(faceUp ? ["west", "north", "east"].filter((s) => s !== snap.sittingOut || byName.has(s)) : [])]);
  for (const name of need) {
    const h = byName.get(name);
    if (!h) problems.push(`${name} hand not found`);
    else if (!h.cards.length) problems.push(`${name} hand found with no cards measured`);
  }
  for (const h of byName.values()) {
    if (h.declared == null) problems.push(`${h.hand} hand does not say how many cards it holds (data-hand-cards)`);
    else if (h.cards.length !== h.declared) problems.push(`${h.hand} hand: ${h.declared} cards declared, ${h.cards.length} measured`);
    if (snap.expected && !snap.expected.includes(h.hand)) problems.push(`${h.hand} hand drawn but not declared in data-hands`);
  }
  return problems;
}
