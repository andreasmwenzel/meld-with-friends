// The pure half of scripts/overlap.mjs: given the boxes measured on one screen, which controls sit on a hand.
// Kept free of Chrome and the DOM so src/lib/__tests__/overlapGeometry.test.ts can run it on fixture boxes.

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Box
 * `clip` is what can show of an element: the screen cut down by ancestors that hide overflow. Defaults to the screen.
 * @typedef {{ hand: string, cards: (Box & { label?: string })[], scrolls?: boolean, clip?: Box }} Hand
 * @typedef {Box & { name: string, coveredBy?: string[], clip?: Box }} Overlay
 * @typedef {{ vw: number, vh: number, hands: Hand[], overlays: Overlay[], plates?: Overlay[] }} Snapshot
 * @typedef {{ kind: "control" | "hands" | "clipped" | "covered" | "edge", a: string, b: string, cards: number, area: number }} Hit
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
 * that scrolls, as yours does when it is too wide), and every control or seat plate (with its turn ring) cut off.
 * ALLOW and ALLOW_COVER list the exceptions.
 * One hit per (control, hand) or (hand, hand) pair, counting the cards involved.
 * @param {Snapshot} snap
 * @returns {{ failures: Hit[], allowed: (Hit & { why: string })[] }}
 */
export function findOverlaps(snap, allow = ALLOW, allowCover = ALLOW_COVER) {
  /** @type {Hit[]} */ const failures = [];
  /** @type {(Hit & { why: string })[]} */ const ok = [];
  for (const o of snap.overlays) {
    for (const hand of snap.hands) {
      let cards = 0, area = 0;
      for (const c of hand.cards) {
        const i = intersect(o, c);
        if (i) { cards++; area = Math.max(area, Math.round(i.w * i.h)); }
      }
      if (!cards) continue;
      const hit = /** @type {Hit} */ ({ kind: "control", a: o.name, b: hand.hand, cards, area });
      const rule = allowed(o.name, hand.hand, allow);
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
  for (const o of [...snap.overlays, ...(snap.plates ?? [])]) {
    // Tight here: a turn ring is only 2px, so the usual tolerance would let it vanish unnoticed.
    if (!inside(o, o.clip ?? screen, true, 0.5)) failures.push({ kind: "edge", a: "edge", b: o.name, cards: 0, area: 0 });
  }
  return { failures, allowed: ok };
}
