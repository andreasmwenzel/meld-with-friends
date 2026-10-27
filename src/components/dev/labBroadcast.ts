// Lab broadcast mode (?broadcast=1): the board gets game events the way a live table sends them, so the
// apply-public-moves path runs against the real board. Public moves are signed with a key made in the
// browser (standing in for the server's), and every view the board applies is checked against the engine.
import { viewFor, type PlayerView, type SeatIndex } from "@/engine";
import { publicMove } from "@/engine/publicMove";
import { moveMessage } from "@/lib/moveAuth";
import { createGameFeed } from "@/components/table/viewSync";
import { labStore } from "./labStore";

/** Stands in for the table's game id, which signed moves are bound to. */
export const LAB_GAME = "lab-game";

const toBase64Url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const canonical = (value: unknown): string => JSON.stringify(value, (_k, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

export interface BroadcastReport {
  /** game events sent to the board, and how many carried a public move */
  events: number; moves: number;
  /** /view requests the board made */
  fetches: number;
  /** views the board applied, and those that differ from the engine's view at that revision */
  applied: number; mismatches: string[];
  rev: number; phase: string;
}

export function createLabBroadcast() {
  const feed = createGameFeed();
  const report: BroadcastReport = { events: 0, moves: 0, fetches: 0, applied: 0, mismatches: [], rev: -1, phase: "" };
  let keys: CryptoKeyPair | null = null;
  let publicKey = "";
  let sending = Promise.resolve();
  let last = { epoch: -1, rev: -1 };

  const show = () => {
    const el = document.getElementById("lab-broadcast");
    if (el) el.textContent = JSON.stringify(report);
  };

  /** Send the board a game event for each new revision, with the signed public move when there is one. */
  function onStore() {
    const snap = labStore.get(), state = labStore.state;
    const prev = last;
    last = { epoch: snap.epoch, rev: state.rev };
    if (snap.epoch !== prev.epoch || state.rev === prev.rev) return; // a rewrite remounts the board
    const before = state.rev === prev.rev + 1 ? labStore.allStates[snap.cursor - 1] : null;
    const move = before ? publicMove(before, state, snap.actions[snap.cursor - 1]) : null;
    const rev = state.rev;
    sending = sending.then(async () => {
      let event: { type: "game"; rev: number; move?: string; sig?: string } = { type: "game", rev };
      if (move && keys) {
        const message = moveMessage(LAB_GAME, move);
        const sig = await crypto.subtle.sign({ name: "Ed25519" }, keys.privateKey, new TextEncoder().encode(message));
        event = { ...event, move: message, sig: toBase64Url(sig) };
        report.moves++;
      }
      report.events++;
      feed.emit(event);
      show();
    });
  }

  return {
    feed,
    async start() {
      keys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]) as CryptoKeyPair;
      publicKey = toBase64Url(await crypto.subtle.exportKey("raw", keys.publicKey));
      last = { epoch: labStore.get().epoch, rev: labStore.state.rev };
      return labStore.subscribe(onStore);
    },
    /** The view the lab's fake server sends, carrying the key that checks moves. */
    view(seat: SeatIndex, extra: object = {}) {
      report.fetches++;
      show();
      return { ...viewFor(labStore.state, seat), ...extra, moveKey: publicKey };
    },
    withKey: <V extends object>(view: V) => ({ ...view, moveKey: publicKey }),
    inspect(view: PlayerView) {
      const state = labStore.allStates.find(s => s.rev === view.rev);
      report.applied++;
      report.rev = view.rev; report.phase = view.phase;
      const strip = (v: object) => { const { moveKey: _k, ready: _r, ...rest } = v as Record<string, unknown>; void _k; void _r; return rest; };
      if (!state) report.mismatches.push(`rev ${view.rev}: no such state`);
      else if (canonical(strip(view)) !== canonical(strip(viewFor(state, view.seat)))) report.mismatches.push(`rev ${view.rev}`);
      show();
    },
  };
}
