"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { api, type Profile } from "@/lib/api";
import { canVerifyChat, openChat, type ChatMessage, type SignedChat } from "@/lib/chatAuth";
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
  const receiver = useRef<((payload: Partial<SignedChat>) => Promise<ChatMessage | null>) | null>(null);
  // Your messages still on their way, kept apart from the talk so a failed send leaves the talk as it was.
  const [pending, setPending] = useState<ShownMessage[]>([]);
  const pendingRef = useRef(pending);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  // Your messages whose broadcast came before their response: each hides one pending copy of its text
  // until the response says which send it was. `answered` holds the ids whose response is in.
  const [early, setEarly] = useState<ChatMessage[]>([]);
  const answered = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !publicKey) return;
    let active = true;
    const seen = new Set<string>();
    const receive = async (payload: Partial<SignedChat>) => {
      if (!payload || typeof payload !== "object") return null;
      const m = await openChat(publicKey, code, payload.message, payload.sig, Date.now() + offset.current);
      if (!active || !m) return null;
      if (seen.has(m.id)) return m;
      seen.add(m.id);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev.slice(-99), m]));
      if (m.from === me.id && !answered.current.has(m.id) && pendingRef.current.some((p) => p.text === m.text)) {
        setEarly((prev) => [...prev, m]);
      }
      if (m.from !== me.id && !visibleRef.current) setUnread((n) => n + 1);
      return m;
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
    const entry = { id, from: me.id, name: me.display_name, text: t, at: Date.now(), pending: true };
    pendingRef.current = [...pendingRef.current, entry];
    setPending((prev) => [...prev, entry]);
    try {
      const signed = await api<SignedChat>(`/api/tables/${code}/chat`, { body: { text: t } });
      const m = await receive(signed);
      if (m) {
        answered.current.add(m.id);
        setEarly((prev) => prev.filter((x) => x.id !== m.id));
      }
    } finally {
      pendingRef.current = pendingRef.current.filter((x) => x.id !== id);
      setPending((prev) => prev.filter((x) => x.id !== id));
      // A broadcast whose response was lost must not hide a later send of the same text.
      if (!pendingRef.current.some((x) => x.text === t)) setEarly((prev) => prev.filter((x) => x.text !== t));
    }
  }, [code, enabled, me.id, me.display_name]);

  const shown = useMemo(() => {
    if (pending.length === 0) return messages;
    const hide = new Map<string, number>();
    for (const m of early) hide.set(m.text, (hide.get(m.text) ?? 0) + 1);
    const waiting = pending.filter((p) => {
      const n = hide.get(p.text) ?? 0;
      if (n > 0) hide.set(p.text, n - 1);
      return n === 0;
    });
    return [...messages, ...waiting];
  }, [messages, pending, early]);

  return { messages: shown, unread, setVisible, send, me: me.id, unsupported };
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
