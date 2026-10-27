"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from "react";

export type { ChatMessage } from "@/lib/chatAuth";
import { CHAT_MAX_LENGTH, type ChatMessage } from "@/lib/chatAuth";

/** Table talk as the screens see it. `useTableChat` (Chat.tsx) makes the live one; the lab makes a local one. */
export interface TableChat {
  messages: ChatMessage[];
  unsupported?: boolean;
  /** messages from others that arrived while the talk was not on screen */
  unread: number;
  /** says whether the talk is on screen; showing it marks everything seen */
  setVisible: (visible: boolean) => void;
  send: (text: string) => Promise<void> | void;
  /** your user id, to tell your messages from the others' */
  me: string;
}

const reactions = [
  { emoji: "👍", label: "Thumbs up" },
  { emoji: "😂", label: "Laugh" },
  { emoji: "❤️", label: "Heart" },
  { emoji: "👏", label: "Applause" },
];

export function unreadLabel(unread: number): string {
  return unread > 0 ? `Table talk, ${unread} unread ${unread === 1 ? "message" : "messages"}` : "Table talk";
}

/** The talk itself: messages, quick reactions and the message field. The caller owns the draft. */
export function ChatBody({ chat, open, text, setText, inputRef, compact = false }: {
  chat: TableChat; open: boolean; text: string; setText: Dispatch<SetStateAction<string>>; inputRef?: RefObject<HTMLInputElement | null>;
  /** short on room (a phone keyboard is up): drop the reactions so the messages keep some space */
  compact?: boolean;
}) {
  const { messages } = chat;
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  useEffect(() => {
    const list = listRef.current;
    if (open && list) list.scrollTop = list.scrollHeight;
  }, [open, messages.length]);

  const send = (e: FormEvent, reaction?: string) => {
    e.preventDefault();
    if (!reaction) setText("");
    const sent = text;
    void Promise.resolve(chat.send(reaction ?? sent)).catch(() => {
      // Put the message back only if nothing new was typed while it was on its way.
      // Read the draft from its owner: this body may have unmounted (chat closed) while the send was out.
      if (!reaction) setText((current) => (current === "" || current === sent ? sent : current));
    });
  };

  return (
    <>
      <div ref={listRef} role="log" aria-live="polite" aria-label="Table talk messages" className="min-h-0 flex-1 overflow-y-auto px-4 py-2 text-sm">
        {chat.unsupported && <p>Update your browser to see table talk.</p>}
        {!chat.unsupported && messages.length === 0 && <p className="text-ink-soft">Say hello. Messages stay at the table and are not saved.</p>}
        {messages.map((m) => (
          <p key={m.id} className="mb-1.5 leading-snug">
            <span className="font-semibold" style={{ color: m.from === chat.me ? "var(--deck-blue)" : "var(--ink)" }}>{m.from === chat.me ? "You" : m.name}</span>{" "}
            <span className="text-ink">{m.text}</span>
          </p>
        ))}
      </div>
      <div role="group" aria-label="Send a reaction" hidden={compact} className="flex shrink-0 gap-1 border-t border-chalk-dim px-2 py-1">
        {reactions.map(({ emoji, label }) => (
          <button key={emoji} type="button" className="btn btn-chalk" style={{ width: "2.75rem", padding: 0 }}
            aria-label={`Send ${label.toLowerCase()}`} title={label} onClick={(e) => send(e, emoji)}>
            <span aria-hidden="true">{emoji}</span>
          </button>
        ))}
      </div>
      <form onSubmit={send} className="flex shrink-0 gap-2 border-t border-chalk-dim p-2">
        <label htmlFor={inputId} className="sr-only">Message</label>
        <input ref={inputRef} id={inputId} className="field" style={{ height: "2.75rem" }} value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Message the table" maxLength={CHAT_MAX_LENGTH} enterKeyHint="send" autoComplete="off" />
        <button className="btn btn-ink" style={{ height: "2.75rem", padding: "0 .9rem" }} disabled={!text.trim()}>Send</button>
      </form>
    </>
  );
}

/** Speech bubble, drawn to sit with the table's line work. */
function TalkIcon() {
  return (
    <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 4.75h13a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25H11l-4.25 3.5v-3.5H5.5A2.25 2.25 0 0 1 3.25 14.5V7A2.25 2.25 0 0 1 5.5 4.75Z" />
      <path d="M8 10.75h.01M12 10.75h.01M16 10.75h.01" strokeWidth="2.4" />
    </svg>
  );
}

const MAX_W = 328;
const MAX_H = 440;
const MIN_H = 168;
const GAP = 10;
const EDGE = 8;
/** A deeper lift than a panel, with a hairline, so the popover reads apart from the chalk result sheet too. */
const POP_SHADOW = "0 0 0 1px rgba(36,29,29,.14), 0 14px 40px rgba(0,0,0,.45)";

interface Place { top: number; right: number; width: number; height: number; tail: number | null; below: boolean }

/**
 * Where the popover goes: above the button, right edges lined up, inside what the visual viewport shows.
 * With a phone keyboard up the visual viewport is short, so the popover shrinks and rises with it and the
 * message field stays in view. A button near the top (on the pause banner) opens it downwards instead.
 */
function placeNear(button: HTMLElement): Place {
  const r = button.getBoundingClientRect();
  const vv = window.visualViewport;
  const vTop = vv?.offsetTop ?? 0;
  const vBottom = vTop + (vv?.height ?? window.innerHeight);
  const pageW = document.documentElement.clientWidth;
  const width = Math.min(MAX_W, pageW - 2 * 12);
  const right = Math.min(Math.max(12, pageW - r.right), pageW - width - 12);
  const tailAt = pageW - right - (r.left + r.width / 2);
  const roomBelow = vBottom - EDGE - (r.bottom + GAP);
  if (r.top - GAP - (vTop + EDGE) < MIN_H && roomBelow >= MIN_H) {
    return { top: r.bottom + GAP, right, width, height: Math.min(MAX_H, roomBelow), tail: tailAt, below: true };
  }
  const under = r.top - GAP;
  let bottom = Math.min(under, vBottom - EDGE);
  // Too little room above the button (a short screen, or the keyboard covering it): use all that is visible.
  if (bottom - (vTop + EDGE) < MIN_H) bottom = vBottom - EDGE;
  const height = Math.min(MAX_H, bottom - (vTop + EDGE));
  // The tail points at the button only while the popover sits right on top of it.
  const tail = Math.abs(bottom - under) < 1 ? tailAt : null;
  return { top: bottom - height, right, width, height, tail, below: false };
}

/**
 * Table talk at the board: a round button that opens the talk in a popover anchored to it.
 * The board owns `open` and the draft, so both survive the button moving (onto the result sheet at hand end).
 */
export function ChatDock({ chat, open, setOpen, text, setText }: {
  chat: TableChat; open: boolean; setOpen: (open: boolean) => void; text: string; setText: Dispatch<SetStateAction<string>>;
}) {
  const { unread, setVisible } = chat;
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popId = useId();
  const titleId = useId();
  const [place, setPlace] = useState<Place | null>(null);

  // On screen means seen: the unread count clears while the popover is open.
  useEffect(() => { setVisible(open); }, [open, setVisible]);
  useEffect(() => () => setVisible(false), [setVisible]);

  const measure = useCallback(() => {
    if (!button.current) return;
    const next = placeNear(button.current);
    setPlace((p) => (p && p.top === next.top && p.right === next.right && p.width === next.width && p.height === next.height && p.tail === next.tail && p.below === next.below ? p : next));
  }, []);
  // The button moves with the board (the action bar grows and shrinks); follow it on every render while open.
  useLayoutEffect(() => { if (open) measure(); });
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    window.addEventListener("resize", measure);
    vv?.addEventListener("resize", measure);
    vv?.addEventListener("scroll", measure);
    return () => {
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
      vv?.removeEventListener("scroll", measure);
    };
  }, [open, measure]);

  // Focus into the message field on opening; back to the button when closed with Escape or Close.
  // The popover stays hidden until it has been placed, so wait for that before focusing inside it.
  const refocus = useRef(false);
  const shown = open && place !== null;
  useEffect(() => {
    if (shown) input.current?.focus({ preventScroll: true });
    else if (!open && refocus.current) button.current?.focus();
    refocus.current = false;
  }, [shown, open]);
  const close = useCallback((restore: boolean) => { refocus.current = restore; setOpen(false); }, [setOpen]);

  // A tap anywhere else closes it and leaves focus with whatever was tapped.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || button.current?.contains(t)) return;
      close(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [open, close]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape" || !open) return;
    // Handled here, so the table menu and the result sheet leave their own Escape alone.
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      <button ref={button} type="button" data-keep-armed="" onClick={() => (open ? close(true) : setOpen(true))}
        aria-label={unreadLabel(unread)} aria-expanded={open} aria-controls={popId} aria-haspopup="dialog"
        className={`relative grid size-11 place-items-center rounded-full shadow-[0_2px_10px_rgba(0,0,0,.28)] transition-colors ${open
          ? "bg-chalk text-ink"
          : "bg-cloth-deep/85 text-chalk ring-1 ring-chalk-ghost hover:bg-cloth-deep hover:ring-chalk-faint"}`}>
        <TalkIcon />
        {unread > 0 && !open && (
          <span aria-hidden className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-brass px-1 text-[11px] font-bold leading-none text-ink tabular-nums ring-2 ring-cloth-deep">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      <div ref={pop} id={popId} role="dialog" aria-labelledby={titleId} hidden={!open || !place}
        className="chat-pop panel fixed z-40 flex flex-col overflow-visible"
        style={place ? { top: place.top, right: place.right, width: place.width, height: place.height, boxShadow: POP_SHADOW } : undefined}>
        <div className="flex shrink-0 items-center justify-between border-b border-chalk-dim py-1 pl-4 pr-2">
          <h2 id={titleId} className="display" style={{ fontSize: 21 }}>Table talk</h2>
          <button type="button" onClick={() => close(true)} className="tap-link text-sm text-ink-soft underline underline-offset-4 hover:text-ink">Close</button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-[inherit]">
          {open && <ChatBody chat={chat} open={open} text={text} setText={setText} inputRef={input} compact={!!place && place.height < 300} />}
        </div>
        {place?.tail != null && (
          <span aria-hidden className={`absolute size-3 rotate-45 bg-chalk ${place.below ? "-top-[6px]" : "-bottom-[6px]"}`} style={{ right: place.tail - 6 }} />
        )}
      </div>
    </div>
  );
}
