import { describe, expect, it } from 'vitest';
// The pure half of scripts/overlap.mjs; the script measures the boxes in Chrome, this checks the rules on fixtures.
import { ALLOW, checkPresence, findOverlaps, intersect } from '../../../scripts/overlap-geometry.mjs';

const card = (x: number, y: number, w = 36, h = 50) => ({ x, y, w, h });
const snap = (over: Partial<Parameters<typeof findOverlaps>[0]>) => ({ vw: 390, vh: 844, hands: [], overlays: [], ...over });

describe('intersect', () => {
  it('finds the shared part of two boxes', () => {
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 5, y: 5, w: 5, h: 5 });
  });
  it('ignores boxes that only touch or graze within the tolerance', () => {
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBeNull();
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 8.5, y: 0, w: 10, h: 10 })).toBeNull();
  });
});

describe('findOverlaps', () => {
  it('reports a control lying on a hand, once per hand, counting the cards', () => {
    const { failures } = findOverlaps(snap({
      hands: [{ hand: 'east', cards: [card(330, 400), card(330, 417), card(330, 434)] }],
      overlays: [{ name: 'chat', x: 334, y: 420, w: 44, h: 44 }],
    }));
    expect(failures).toEqual([{ kind: 'control', a: 'chat', b: 'east', cards: 3, area: expect.any(Number) }]);
  });
  it('never compares the cards of one hand with each other', () => {
    expect(findOverlaps(snap({ hands: [{ hand: 'mine', cards: [card(0, 700), card(20, 700)] }] })).failures).toEqual([]);
  });
  it('reports two hands lying on each other, and the cloth counts as one', () => {
    const { failures } = findOverlaps(snap({ hands: [{ hand: 'north', cards: [card(100, 40)] }, { hand: 'table', cards: [card(110, 80)] }] }));
    expect(failures.map((f) => [f.kind, f.a, f.b])).toEqual([['hands', 'north', 'table']]);
  });
  it('lets the open talk popover lie over the other seats and the cloth, but not your hand', () => {
    const pop = { name: 'chat-popover', x: 50, y: 100, w: 328, h: 440 };
    const { failures, allowed } = findOverlaps(snap({
      hands: [{ hand: 'east', cards: [card(330, 300)] }, { hand: 'table', cards: [card(150, 300)] }, { hand: 'mine', cards: [card(60, 520)] }],
      overlays: [pop],
    }));
    expect(allowed.map((a) => a.b)).toEqual(['east', 'table']);
    expect(failures.map((f) => f.b)).toEqual(['mine']);
    expect(ALLOW.some((r) => r.overlay.test('chat') )).toBe(false);
  });
  it('reports a control drawn over by another, except under the open popover', () => {
    const { failures, allowed } = findOverlaps(snap({ overlays: [
      { name: 'peek', x: 0, y: 800, w: 100, h: 36, coveredBy: ['chat-popover'] },
      { name: 'chat', x: 330, y: 790, w: 44, h: 44, coveredBy: ['peek'] },
    ] }));
    expect(allowed.map((a) => [a.kind, a.b])).toEqual([['covered', 'peek']]);
    expect(failures.map((f) => [f.kind, f.a, f.b])).toEqual([['covered', 'peek', 'chat']]);
  });
  it('reports cards cut off by the screen edge, sideways only for a hand that does not scroll', () => {
    const { failures } = findOverlaps(snap({ hands: [
      { hand: 'mine', scrolls: true, cards: [card(-30, 700), card(380, 700)] },
      { hand: 'east', cards: [card(370, 400)] },
      { hand: 'north', cards: [card(100, 820)] },
    ] }));
    expect(failures.map((f) => [f.kind, f.b])).toEqual([['clipped', 'east'], ['clipped', 'north']]);
  });
  it('reports a seat plate or control cut off by a box that hides overflow', () => {
    const clip = { x: 12, y: 40, w: 366, h: 600 };
    const { failures } = findOverlaps(snap({
      overlays: [{ name: 'menu', x: 340, y: 10, w: 40, h: 20 }],
      plates: [{ name: 'seat east', x: 336, y: 300, w: 50, h: 60, clip }, { name: 'seat west', x: 14, y: 300, w: 50, h: 60, clip }],
    }));
    expect(failures.map((f) => [f.kind, f.b])).toEqual([['edge', 'seat east']]);
  });
  it('lets the Play button sit on the card it plays, and nothing else', () => {
    const play = { name: 'play', x: 300, y: 700, w: 84, h: 44, own: 'AS0' };
    const hand = { hand: 'mine', cards: [{ ...card(310, 690), label: 'AS0' }, { ...card(340, 690), label: 'KS0' }] };
    expect(findOverlaps(snap({ hands: [hand], overlays: [play] })).failures).toEqual([{ kind: 'control', a: 'play', b: 'mine', cards: 1, area: expect.any(Number) }]);
    expect(findOverlaps(snap({ hands: [{ ...hand, cards: [hand.cards[0]] }], overlays: [play] })).failures).toEqual([]);
  });
  it('reports two controls on each other, but for the badge on its button and the open popover', () => {
    const { failures, allowed } = findOverlaps(snap({ overlays: [
      { name: 'chat', x: 330, y: 50, w: 44, h: 44 }, { name: 'chat-badge', x: 362, y: 46, w: 20, h: 20 },
      { name: 'play', x: 300, y: 700, w: 84, h: 44 }, { name: 'action: Pass', x: 330, y: 710, w: 60, h: 40 },
    ] }));
    expect(allowed.map((a) => [a.a, a.b])).toEqual([['chat', 'chat-badge']]);
    expect(failures.map((f) => [f.kind, f.a, f.b])).toEqual([['controls', 'play', 'action: Pass']]);
  });
  it('needs every control to take a tap over 44x44, but for the strips of your fanned cards', () => {
    const { failures, allowed } = findOverlaps(snap({ controls: [
      { name: 'Last trick', w: 51, h: 16, by: ['div.flex'] },
      { name: 'Claim all', w: 73, h: 43 },
      { name: 'card AS0', w: 25, h: 100, card: true },
      { name: 'card KS0', w: 25, h: 30, card: true },
    ] }));
    expect(failures.map((f) => [f.kind, f.b, f.a])).toEqual([['small', 'Last trick', '51x16'], ['small', 'card KS0', '25x30']]);
    expect(allowed.map((a) => a.b)).toEqual(['card AS0']);
  });
});

describe('checkPresence', () => {
  const hand = (name: string, n: number, declared: number | null = n) => ({ hand: name, declared, cards: Array.from({ length: n }, (_, i) => ({ ...card(i * 20, 0), label: `c${i}` })) });
  it('passes when every declared hand is there with the cards it declares', () => {
    expect(checkPresence(snap({ expected: ['west', 'north', 'east', 'mine'], hands: [hand('west', 12), hand('north', 12), hand('east', 12), hand('mine', 12)] }))).toEqual([]);
  });
  it('fails when nothing was measured, as when the cards cannot be found', () => {
    expect(checkPresence(snap({ expected: ['west', 'mine'], hands: [hand('west', 0, 12), hand('mine', 0, 12)] }))).toEqual([
      'west hand found with no cards measured', 'mine hand found with no cards measured',
      'west hand: 12 cards declared, 0 measured', 'mine hand: 12 cards declared, 0 measured',
    ]);
  });
  it('fails when the board does not declare its hands, or a hand is missing or undeclared', () => {
    expect(checkPresence(snap({ expected: null, hands: [] }))).toEqual(['the board does not say which hands it draws (data-hands)', 'mine hand not found']);
    expect(checkPresence(snap({ expected: ['mine'], hands: [hand('mine', 3), hand('east', 2, null)] }))).toEqual([
      'east hand does not say how many cards it holds (data-hand-cards)', 'east hand drawn but not declared in data-hands',
    ]);
  });
  it('accepts your hand empty when it says so (all of it laid down as meld)', () => {
    expect(checkPresence(snap({ expected: ['west'], hands: [hand('west', 12), hand('mine', 0, 0)] }))).toEqual([]);
  });
  it('needs all four hands face up, but for a seat that sat out a shoot', () => {
    const three = [hand('west', 12), hand('east', 12), hand('mine', 12)];
    expect(checkPresence(snap({ expected: ['west', 'east', 'mine'], hands: three }), { faceUp: true })).toEqual(['north hand not found']);
    expect(checkPresence(snap({ expected: ['west', 'east', 'mine'], hands: three, sittingOut: 'north' }), { faceUp: true })).toEqual([]);
  });
});
