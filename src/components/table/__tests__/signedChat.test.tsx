// @vitest-environment jsdom
import { useEffect, useState } from "react";
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
const signed = (code = "BCDFGH", privateKey = keys.privateKey, m = line): SignedChat => {
  const message = chatMessage(code, m);
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

const mine = (id: string, text: string) => signed("BCDFGH", keys.privateKey, { id, from: "me", name: "Local name", text, at: Date.now() });
const deferred = () => {
  let resolve!: (v: SignedChat) => void, reject!: (e: Error) => void;
  const promise = new Promise<SignedChat>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const sending = () => chat.messages.filter(m => (m as { pending?: boolean }).pending).length;

it("shows a sent message at once as sending, then the signed copy", async () => {
  render(<Harness />);
  const reply = deferred();
  mocks.api.mockReturnValue(reply.promise);
  let done!: Promise<void>;
  act(() => { done = chat.send("On my way") as Promise<void>; });
  expect(screen.getByText("On my way")).toBeTruthy();
  expect(screen.getByText(/sending/)).toBeTruthy();
  await act(async () => { reply.resolve(mine("a", "On my way")); await done; });
  expect(screen.queryByText(/sending/)).toBeNull();
  expect(chat.messages.map(m => m.id)).toEqual(["a"]);
});
it("keeps each identical send pending until its own response, whatever order things arrive in", async () => {
  render(<Harness />);
  const first = deferred(), second = deferred();
  mocks.api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let a!: Promise<void>, b!: Promise<void>;
  act(() => { a = chat.send("👍") as Promise<void>; b = chat.send("👍") as Promise<void>; });
  expect(sending()).toBe(2);
  // The second send's broadcast arrives first, then its response.
  await emit(mine("b", "👍"));
  expect(chat.messages).toHaveLength(2);
  expect(sending()).toBe(1);
  await act(async () => { second.resolve(mine("b", "👍")); await b; });
  expect(chat.messages).toHaveLength(2);
  expect(sending()).toBe(1);
  await act(async () => { first.resolve(mine("a", "👍")); await a; });
  expect(chat.messages.map(m => m.id)).toEqual(["b", "a"]);
  expect(sending()).toBe(0);
});
it("keeps another identical send pending when one fails after its broadcast", async () => {
  render(<Harness />);
  const first = deferred(), second = deferred();
  mocks.api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let a!: Promise<void>, b!: Promise<void>;
  act(() => { a = chat.send("👍") as Promise<void>; b = chat.send("👍") as Promise<void>; });
  await emit(mine("a", "👍"));
  expect(sending()).toBe(1);
  await act(async () => { first.reject(new Error("Network")); await expect(a).rejects.toThrow("Network"); });
  expect(chat.messages.map(m => m.id)).toEqual(["a", expect.stringMatching(/^pending-/)]);
  await act(async () => { second.resolve(mine("b", "👍")); await b; });
  expect(chat.messages.map(m => m.id)).toEqual(["a", "b"]);
});
it("keeps another identical send pending when a failed send's broadcast comes late", async () => {
  render(<Harness />);
  const first = deferred(), second = deferred();
  mocks.api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let a!: Promise<void>, b!: Promise<void>;
  act(() => { a = chat.send("👍") as Promise<void>; b = chat.send("👍") as Promise<void>; });
  await act(async () => { first.reject(new Error("Network")); await expect(a).rejects.toThrow("Network"); });
  await emit(mine("a", "👍"));
  expect(chat.messages.map(m => m.id)).toEqual(["a", expect.stringMatching(/^pending-/)]);
  await act(async () => { second.resolve(mine("b", "👍")); await b; });
  expect(chat.messages.map(m => m.id)).toEqual(["a", "b"]);
});
it("does not let a failed send's late broadcast hide a later identical send", async () => {
  render(<Harness />);
  const first = deferred(), second = deferred();
  mocks.api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  let a!: Promise<void>, b!: Promise<void>;
  act(() => { a = chat.send("👍") as Promise<void>; });
  await act(async () => { first.reject(new Error("Network")); await expect(a).rejects.toThrow("Network"); });
  act(() => { b = chat.send("👍") as Promise<void>; });
  await emit(mine("a", "👍"));
  expect(chat.messages.map(m => m.id)).toEqual(["a", expect.stringMatching(/^pending-/)]);
  await act(async () => { second.resolve(mine("b", "👍")); await b; });
  expect(chat.messages.map(m => m.id)).toEqual(["a", "b"]);
});
it("leaves the talk as it was when a send fails, even at the message cap", async () => {
  render(<Harness />);
  for (let i = 0; i < 100; i++) await emit(signed("BCDFGH", keys.privateKey, { ...line, id: `m${i}` }));
  expect(chat.messages).toHaveLength(100);
  mocks.api.mockRejectedValue(new Error("Slow down"));
  await act(async () => { await expect(chat.send("Hello")).rejects.toThrow("Slow down"); });
  expect(chat.messages).toHaveLength(100);
  expect(chat.messages[0].id).toBe("m0");
});

function DraftHarness({ send, shown }: { send: TableChat["send"]; shown: boolean }) {
  const [text, setText] = useState("Try again");
  return <>
    <output data-testid="draft">{text}</output>
    {shown && <ChatBody chat={{ messages: [], unread: 0, me: "me", setVisible: () => {}, send }} open text={text} setText={setText} />}
  </>;
}

it("restores the draft if the server declines a send", async () => {
  render(<DraftHarness send={() => Promise.reject(new Error("Slow down"))} shown />);
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  await vi.waitFor(() => expect(screen.getByTestId("draft").textContent).toBe("Try again"));
});

it("keeps a newer draft when an earlier send fails after the chat was closed and reopened", async () => {
  let fail!: (e: Error) => void;
  const send = () => new Promise<void>((_, reject) => { fail = reject; });
  const view = render(<DraftHarness send={send} shown />);
  fireEvent.submit(screen.getByRole("textbox").closest("form")!);
  expect(screen.getByTestId("draft").textContent).toBe("");
  view.rerender(<DraftHarness send={send} shown={false} />);
  view.rerender(<DraftHarness send={send} shown />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Something new" } });
  await act(async () => { fail(new Error("Slow down")); });
  expect(screen.getByTestId("draft").textContent).toBe("Something new");
});
