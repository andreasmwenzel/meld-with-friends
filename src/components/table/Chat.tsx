"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/api";

interface Message { id: string; from: string; name: string; text: string; at: number }

const reactions = [
  { emoji: "👍", label: "Thumbs up" },
  { emoji: "😂", label: "Laugh" },
  { emoji: "❤️", label: "Heart" },
  { emoji: "👏", label: "Applause" },
];

/**
 * Table talk's connection and messages. Messages travel over Realtime only and are not stored, so the
 * room holds this for the whole visit: the talk from the seating screen is still there at the board.
 * `setVisible` says whether the talk is on screen; messages from others count as unread while it is not.
 */
export function useTableChat(code: string, me: Profile, enabled: boolean) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [unread, setUnread] = useState(0);
  const visibleRef = useRef(false);
  const setVisible = useCallback((visible: boolean) => {
    visibleRef.current = visible;
    if (visible) setUnread(0);
  }, []);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const db = createClient();
    const channel = db.channel(`chat:${code}`);
    channel
      .on("broadcast", { event: "message" }, ({ payload }) => {
        const m = payload as Message;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev.slice(-99), m]));
        if (m.from !== me.id && !visibleRef.current) setUnread((n) => n + 1);
      })
      .subscribe();
    channelRef.current = channel;
    return () => { void db.removeChannel(channel); channelRef.current = null; };
  }, [code, me.id, enabled]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || !channelRef.current) return;
    const m: Message = { id: crypto.randomUUID(), from: me.id, name: me.display_name, text: t.slice(0, 300), at: Date.now() };
    setMessages((prev) => [...prev.slice(-99), m]);
    await channelRef.current.send({ type: "broadcast", event: "message", payload: m });
  }, [me.id, me.display_name]);

  return { messages, unread, setVisible, send, me: me.id };
}
export type TableChat = ReturnType<typeof useTableChat>;

/**
 * Table talk on screen. Floating, it is a button in the corner that opens a panel (the seating screen).
 * `embedded`, it fills the table menu's Talk tab: `visible` says whether that tab is on screen.
 */
export function Chat({ chat, embedded }: { chat: TableChat; embedded?: { visible: boolean } }) {
  const { messages, unread, setVisible } = chat;
  const [text, setText] = useState("");
  const [floatOpen, setOpen] = useState(false);
  const open = embedded ? embedded.visible : floatOpen;
  useEffect(() => { setVisible(open); }, [open, setVisible]);
  useEffect(() => () => setVisible(false), [setVisible]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, messages.length]);

  const send = (e: FormEvent, reaction?: string) => {
    e.preventDefault();
    if (!reaction) setText("");
    void chat.send(reaction ?? text);
  };

  const talk = (
    <>
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-2 text-sm">
        {messages.length === 0 && <p className="text-ink-soft">Say hello. Messages stay at the table and are not saved.</p>}
        {messages.map((m) => (
          <p key={m.id} className="mb-1.5 leading-snug">
            <span className="font-semibold" style={{ color: m.from === chat.me ? "var(--deck-blue)" : "var(--ink)" }}>{m.from === chat.me ? "You" : m.name}</span>{" "}
            <span className="text-ink">{m.text}</span>
          </p>
        ))}
      </div>
      <div role="group" aria-label="Send a reaction" className="flex gap-1 border-t border-chalk-dim px-2 py-1">
        {reactions.map(({ emoji, label }) => (
          <button key={emoji} type="button" className="btn btn-chalk" style={{ width: "2.75rem", padding: 0 }}
            aria-label={`Send ${label.toLowerCase()}`} title={label} onClick={(e) => send(e, emoji)}>
            <span aria-hidden="true">{emoji}</span>
          </button>
        ))}
      </div>
      <form onSubmit={send} className="flex gap-2 border-t border-chalk-dim p-2">
        <label htmlFor="chat" className="sr-only">Message</label>
        <input id="chat" className="field" style={{ height: "2.75rem" }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the table" maxLength={300} />
        <button className="btn btn-ink" style={{ height: "2.75rem", padding: "0 .9rem" }} disabled={!text.trim()}>Send</button>
      </form>
    </>
  );
  if (embedded) return <div className="flex h-full min-h-0 flex-col text-ink">{talk}</div>;

  return (
    <div className={`fixed z-30 flex flex-col items-end gap-2 ${floatOpen ? "max-sm:inset-x-0 max-sm:bottom-0 sm:bottom-4 sm:right-4" : "bottom-[max(1rem,env(safe-area-inset-bottom))] right-4"}`}>
      {floatOpen && (
        <div className="panel flex w-full flex-col overflow-hidden max-sm:rounded-b-none max-sm:h-[min(70dvh,440px)] sm:h-[360px] sm:w-[320px]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="flex items-center justify-between border-b border-chalk-dim px-4 py-2">
            <span className="font-semibold">Table talk</span>
            <button className="tap -mr-2 px-2 text-sm text-ink-soft" onClick={() => setOpen(false)}>Close</button>
          </div>
          {talk}
        </div>
      )}
      <button className={`btn btn-chalk ${floatOpen ? "max-sm:hidden" : ""}`} onClick={() => setOpen((o) => !o)} aria-label={floatOpen ? "Hide table talk" : "Show table talk"}>
        Table talk{unread > 0 && !floatOpen ? ` (${unread})` : ""}
      </button>
    </div>
  );
}
