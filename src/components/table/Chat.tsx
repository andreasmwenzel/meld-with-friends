"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { api, type Profile } from "@/lib/api";
import { canVerifyChat, openChat, type SignedChat } from "@/lib/chatAuth";
import { ChatBody, type ShownMessage, type TableChat } from "./ChatDock";

export type { TableChat } from "./ChatDock";

/**
 * Table talk's connection and messages. Messages travel over Realtime only and are not stored, so the
 * room holds this for the whole visit: the talk from the seating screen is still there at the board.
 * `setVisible` says whether the talk is on screen; messages from others count as unread while it is not.
 */
export function useTableChat(code: string, me: Profile, enabled: boolean, publicKey?: string, serverNow?: number): TableChat {
  // How far this device's clock is from the server's, from the snapshot: freshness is judged on the server's clock.
  const offset = useRef(0);
  useEffect(() => { if (serverNow) offset.current = serverNow - Date.now(); }, [serverNow]);
  const [messages, setMessages] = useState<ShownMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const visibleRef = useRef(false);
  const setVisible = useCallback((visible: boolean) => {
    visibleRef.current = visible;
    if (visible) setUnread(0);
  }, []);
  const [unsupported, setUnsupported] = useState(false);
  const receiver = useRef<((payload: Partial<SignedChat>) => Promise<void>) | null>(null);

  useEffect(() => {
    if (!enabled || !publicKey) return;
    let active = true;
    const seen = new Set<string>();
    const receive = async (payload: Partial<SignedChat>) => {
      if (!payload || typeof payload !== "object") return;
      const m = await openChat(publicKey, code, payload.message, payload.sig, Date.now() + offset.current);
      if (!active || !m || seen.has(m.id)) return;
      seen.add(m.id);
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        // Your own message coming back replaces its pending copy, whichever of broadcast and response is first.
        const stand = m.from === me.id ? prev.findIndex((x) => x.pending && x.text === m.text) : -1;
        const rest = stand < 0 ? prev : prev.filter((_, i) => i !== stand);
        return [...rest.slice(-99), m];
      });
      if (m.from !== me.id && !visibleRef.current) setUnread((n) => n + 1);
    };
    receiver.current = receive;
    void canVerifyChat(publicKey).then(ok => { if (active) setUnsupported(!ok); });
    const db = createClient();
    // REST broadcasts originate on the server, so the sender receives them too. The signed POST
    // response also supplies a prompt echo if the subscription is still connecting.
    const channel = db.channel(`chat:${code}`, { config: { broadcast: { self: true } } });
    channel.on("broadcast", { event: "chat" }, ({ payload }) => { void receive(payload); }).subscribe();
    return () => { active = false; receiver.current = null; void db.removeChannel(channel); };
  }, [code, me.id, enabled, publicKey]);

  // Shows the message at once, marked as sending, so Enter and a reaction answer straight away.
  const send = useCallback(async (text: string) => {
    const t = text.trim();
    const receive = receiver.current;
    if (!t || !enabled || !receive) return;
    const id = `pending-${crypto.randomUUID()}`;
    const drop = () => setMessages((prev) => prev.filter((x) => x.id !== id));
    setMessages((prev) => [...prev.slice(-99), { id, from: me.id, name: me.display_name, text: t, at: Date.now(), pending: true }]);
    try {
      const signed = await api<SignedChat>(`/api/tables/${code}/chat`, { body: { text: t } });
      await receive(signed);
    } finally {
      drop();
    }
  }, [code, enabled, me.id, me.display_name]);

  return { messages, unread, setVisible, send, me: me.id, unsupported };
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
