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
 * Table talk. Messages travel over Realtime only and are not stored.
 * `atBoard`: sideways on a phone the button moves to the board's empty top left corner, clear of your actions.
 */
export function Chat({ code, me, atBoard = false }: { code: string; me: Profile; atBoard?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const db = createClient();
    const channel = db.channel(`chat:${code}`);
    channel
      .on("broadcast", { event: "message" }, ({ payload }) => {
        const m = payload as Message;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev.slice(-99), m]));
        if (m.from !== me.id) setUnread((n) => n + 1);
      })
      .subscribe();
    channelRef.current = channel;
    return () => { void db.removeChannel(channel); channelRef.current = null; };
  }, [code, me.id]);

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, messages.length]);

  const send = useCallback(async (e: FormEvent, reaction?: string) => {
    e.preventDefault();
    const t = (reaction ?? text).trim();
    if (!t || !channelRef.current) return;
    const m: Message = { id: crypto.randomUUID(), from: me.id, name: me.display_name, text: t.slice(0, 300), at: Date.now() };
    if (!reaction) setText("");
    setMessages((prev) => [...prev.slice(-99), m]);
    await channelRef.current.send({ type: "broadcast", event: "message", payload: m });
  }, [text, me.id, me.display_name]);

  return (
    <div className={`fixed z-30 flex flex-col items-end gap-2 ${atBoard ? "short:bottom-auto short:left-3 short:right-auto short:top-1.5 short:flex-col-reverse short:items-start" : ""} ${open ? "max-sm:inset-x-0 max-sm:bottom-0 sm:bottom-4 sm:right-4" : "bottom-[max(1rem,env(safe-area-inset-bottom))] right-4"}`}>
      {open && (
        <div className="panel flex w-full flex-col overflow-hidden max-sm:rounded-b-none max-sm:h-[min(70dvh,440px)] sm:h-[360px] sm:w-[320px] short:h-[calc(100dvh-5rem)]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="flex items-center justify-between border-b border-chalk-dim px-4 py-2">
            <span className="font-semibold">Table talk</span>
            <button className="tap -mr-2 px-2 text-sm text-ink-soft" onClick={() => setOpen(false)}>Close</button>
          </div>
          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-2 text-sm">
            {messages.length === 0 && <p className="text-ink-soft">Say hello. Messages stay at the table and are not saved.</p>}
            {messages.map((m) => (
              <p key={m.id} className="mb-1.5 leading-snug">
                <span className="font-semibold" style={{ color: m.from === me.id ? "var(--deck-blue)" : "var(--ink)" }}>{m.from === me.id ? "You" : m.name}</span>{" "}
                <span className="text-ink">{m.text}</span>
              </p>
            ))}
          </div>
          <div role="group" aria-label="Send a reaction" className="flex gap-1 border-t border-chalk-dim px-2 py-1">
            {reactions.map(({ emoji, label }) => (
              <button key={emoji} type="button" className="btn btn-chalk" style={{ width: "2.75rem", padding: 0 }}
                aria-label={`Send ${label.toLowerCase()}`} title={label} onClick={(e) => void send(e, emoji)}>
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
          </div>
          <form onSubmit={send} className="flex gap-2 border-t border-chalk-dim p-2">
            <label htmlFor="chat" className="sr-only">Message</label>
            <input id="chat" className="field" style={{ height: "2.75rem" }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the table" maxLength={300} />
            <button className="btn btn-ink" style={{ height: "2.75rem", padding: "0 .9rem" }} disabled={!text.trim()}>Send</button>
          </form>
        </div>
      )}
      <button className={`btn btn-chalk ${atBoard ? "short:px-4 short:text-sm" : ""} ${open ? "max-sm:hidden" : ""}`} onClick={() => { setOpen((o) => !o); setUnread(0); }} aria-label={open ? "Hide table talk" : "Show table talk"}>
        Table talk{unread > 0 && !open ? ` (${unread})` : ""}
      </button>
    </div>
  );
}
