"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/api";
import { ChatBody, type ChatMessage, type TableChat } from "./ChatDock";

export type { TableChat } from "./ChatDock";

/**
 * Table talk's connection and messages. Messages travel over Realtime only and are not stored, so the
 * room holds this for the whole visit: the talk from the seating screen is still there at the board.
 * `setVisible` says whether the talk is on screen; messages from others count as unread while it is not.
 */
export function useTableChat(code: string, me: Profile, enabled: boolean): TableChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
        const m = payload as ChatMessage;
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
    const m: ChatMessage = { id: crypto.randomUUID(), from: me.id, name: me.display_name, text: t.slice(0, 300), at: Date.now() };
    setMessages((prev) => [...prev.slice(-99), m]);
    await channelRef.current.send({ type: "broadcast", event: "message", payload: m });
  }, [me.id, me.display_name]);

  return { messages, unread, setVisible, send, me: me.id };
}

/**
 * Table talk on the seating screen: a button in the corner that opens a panel.
 * At the board the talk lives in ChatDock instead: a round button with a popover.
 */
export function Chat({ chat }: { chat: TableChat }) {
  const { unread, setVisible } = chat;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => { setVisible(open); }, [open, setVisible]);
  useEffect(() => () => setVisible(false), [setVisible]);

  return (
    <div className={`fixed z-30 flex flex-col items-end gap-2 ${open ? "max-sm:inset-x-0 max-sm:bottom-0 sm:bottom-4 sm:right-4" : "bottom-[max(1rem,env(safe-area-inset-bottom))] right-4"}`}>
      {open && (
        <div className="panel flex w-full flex-col overflow-hidden max-sm:rounded-b-none max-sm:h-[min(70dvh,440px)] sm:h-[360px] sm:w-[320px]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="flex items-center justify-between border-b border-chalk-dim px-4 py-2">
            <span className="font-semibold">Table talk</span>
            <button className="tap -mr-2 px-2 text-sm text-ink-soft" onClick={() => setOpen(false)}>Close</button>
          </div>
          <ChatBody chat={chat} open={open} text={text} setText={setText} />
        </div>
      )}
      <button className={`btn btn-chalk ${open ? "max-sm:hidden" : ""}`} onClick={() => setOpen((o) => !o)} aria-label={open ? "Hide table talk" : "Show table talk"}>
        Table talk{unread > 0 && !open ? ` (${unread})` : ""}
      </button>
    </div>
  );
}
