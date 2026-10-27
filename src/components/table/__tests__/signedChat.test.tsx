// @vitest-environment jsdom
import { useEffect } from "react";
import { webcrypto, generateKeyPairSync, sign } from "node:crypto";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTableChat } from "../Chat";
import { ChatBody, type TableChat } from "../ChatDock";
import { chatMessage, type SignedChat } from "@/lib/chatAuth";

const mocks = vi.hoisted(() => ({ on: vi.fn(), subscribe: vi.fn(), channel: vi.fn(), remove: vi.fn(), api: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ channel: mocks.channel, removeChannel: mocks.remove }) }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const line = { id: "one", from: "other", name: "Server name", text: "Hello table", at: Date.now() };
const signed = (code = "BCDFGH", privateKey = keys.privateKey): SignedChat => {
  const message = chatMessage(code, line);
  return { message, sig: sign(null, Buffer.from(message), privateKey).toString("base64url") };
};
let receive: (event: { payload: unknown }) => void;
let chat: TableChat;
function Harness({ code = "BCDFGH", enabled = true }: { code?: string; enabled?: boolean }) {
  const talk = useTableChat(code, { id: "me", display_name: "Local name", handle: "me", avatar_seed: "me" }, enabled, publicKey);
  useEffect(() => { chat = talk; }, [talk]);
  return <ChatBody chat={talk} open text="" setText={() => {}} />;
}
const emit = async (payload: unknown) => { await act(async () => { receive({ payload }); await new Promise(r => setTimeout(r, 10)); }); };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", webcrypto);
  const channel = { on: mocks.on, subscribe: mocks.subscribe };
  mocks.channel.mockReturnValue(channel);
  mocks.on.mockImplementation((_type, _filter, callback) => { receive = callback; return channel; });
  mocks.subscribe.mockReturnValue(channel);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("drops unsigned, other-key, wrong-table and changed events before rendering", async () => {
  render(<Harness />);
  await emit(line);
  await emit({ message: signed().message });
  await emit(signed("JKLMNP"));
  await emit(signed("BCDFGH", generateKeyPairSync("ed25519").privateKey));
  await emit({ ...signed(), message: signed().message.replace("Server name", "Other name") });
  await emit(null);
  expect(screen.queryByText("Hello table")).toBeNull();
  expect(chat.unread).toBe(0);
  await emit(signed());
  expect(screen.getByText("Server name")).toBeTruthy();
  expect(screen.getByText("Hello table")).toBeTruthy();
  expect(chat.unread).toBe(1);
  await emit(signed());
  expect(chat.messages).toHaveLength(1);
  expect(chat.unread).toBe(1);
});
it("posts only text and verifies the returned echo without waiting for a broadcast", async () => {
  render(<Harness />);
  mocks.api.mockResolvedValue(signed());
  await act(async () => { await chat.send("  Hello table  "); });
  expect(mocks.api).toHaveBeenCalledWith("/api/tables/BCDFGH/chat", { body: { text: "Hello table" } });
  expect(screen.getByText("Server name")).toBeTruthy();
  await emit(signed());
  expect(chat.messages).toHaveLength(1);
  expect(mocks.channel).toHaveBeenCalledWith("chat:BCDFGH", { config: { broadcast: { self: true } } });
});
it("does not render an unverified POST response", async () => {
  render(<Harness />);
  mocks.api.mockResolvedValue(line);
  await act(async () => { await chat.send("Hello table"); });
  expect(chat.messages).toHaveLength(0);
});
it("shows one quiet line when Ed25519 is unavailable and drops talk", async () => {
  vi.stubGlobal("crypto", { subtle: { importKey: () => Promise.reject(new Error("unsupported")) } });
  // A different key avoids the successful import cached by previous tests.
  const other = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
  function Unsupported() {
    const talk = useTableChat("BCDFGH", { id: "me", display_name: "Me", handle: "me", avatar_seed: "me" }, true, other);
    return <ChatBody chat={talk} open text="" setText={() => {}} />;
  }
  render(<Unsupported />);
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  await emit(signed());
  expect(screen.getAllByText("Update your browser to see table talk.")).toHaveLength(1);
  expect(screen.queryByText("Hello table")).toBeNull();
});
it("does not subscribe or post for an unseated visitor", async () => {
  render(<Harness enabled={false} />);
  await chat.send("Hello");
  expect(mocks.channel).not.toHaveBeenCalled();
  expect(mocks.api).not.toHaveBeenCalled();
});

it("restores the draft if the server declines a send", async () => {
  const setText = vi.fn();
  render(<ChatBody chat={{ messages: [], unread: 0, me: "me", setVisible: () => {}, send: () => Promise.reject(new Error("Slow down")) }} open text="Try again" setText={setText} />);
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await vi.waitFor(() => expect(setText.mock.calls).toEqual([[""], ["Try again"]]));
});
