// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BidPicker } from "../BidPicker";
import { NextHandCountdown } from "../NextHandCountdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the bid grid", () => {
  it("walks with plain arrows, and leaves Alt, Ctrl and Meta arrows and handled keys to the browser", () => {
    // jsdom has no modal dialogs; opening one only needs it shown here.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
    render(<BidPicker min={250} step={10} busy={false} onBid={() => {}} pass={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose bid" }));
    const at = screen.getByRole("button", { name: "260" });
    act(() => { at.focus(); });
    expect(document.activeElement).toBe(at);
    for (const init of [{ key: "ArrowLeft", altKey: true }, { key: "ArrowRight", altKey: true }, { key: "ArrowDown", ctrlKey: true }, { key: "ArrowUp", metaKey: true }]) {
      expect(fireEvent.keyDown(at, init)).toBe(true);
      expect(document.activeElement).toBe(at);
    }
    const handled = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
    handled.preventDefault();
    act(() => { at.dispatchEvent(handled); });
    expect(document.activeElement).toBe(at);
    fireEvent.keyDown(at, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "270" }));
  });
});

describe("the next-hand countdown", () => {
  it("keeps an empty status region mounted, says once when it starts, and clears when paused", () => {
    vi.useFakeTimers();
    const props = { handKey: "t-1", allowed: true, onNext: () => {} };
    const ui = render(<NextHandCountdown {...props} allReady={false} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Start 5-second countdown" }));
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Countdown waiting for everyone to be ready.");
    ui.rerender(<NextHandCountdown {...props} allReady />);
    expect(status.textContent).toBe("Countdown to the next hand started.");
    // The seconds tick on screen only; the region says nothing new.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(status.textContent).toBe("Countdown to the next hand started.");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("");
  });
});
