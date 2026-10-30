// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BidPicker, fitGrid } from "../BidPicker";
import { NextHandCountdown } from "../NextHandCountdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("the bid grid", () => {
  it("walks with plain arrows, and leaves Alt, Ctrl and Meta arrows and handled keys to the browser", () => {
    render(<BidPicker min={250} step={10} busy={false} onBid={() => {}} pass={null} />);
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
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "310" }));
    // One tab stop for the grid, and it follows the arrows, so Tab leaves the grid for the buttons below it.
    const stops = screen.getAllByRole("button").filter((b) => /^\d+$/.test(b.textContent ?? "") && b.tabIndex === 0);
    expect(stops.map((b) => b.textContent)).toEqual(["310"]);
  });

  it("picks an amount on the first tap and bids it on the second tap or the Bid button", () => {
    const onBid = vi.fn();
    render(<BidPicker min={25} step={1} busy={false} onBid={onBid} pass={null} />);
    expect((screen.getByRole("button", { name: "Pick a bid" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "27" }));
    expect(onBid).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "27" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Bid 27" }));
    expect(onBid).toHaveBeenLastCalledWith(27);
    fireEvent.click(screen.getByRole("button", { name: "30" }));
    fireEvent.click(screen.getByRole("button", { name: "30" }));
    expect(onBid).toHaveBeenLastCalledWith(30);
    expect(onBid).toHaveBeenCalledTimes(2);
  });
});

describe("fitting the bid grid on the cloth", () => {
  // Cloth sizes and table scales measured in Chrome at each screen size.
  const onScreen = (w: number, h: number, scale: number) => {
    const fit = fitGrid(w, h, scale, 54);
    const across = fit.cols * fit.cellW + (fit.beside ? Math.min(fit.cellW, fit.cellH) : 0);
    const down = fit.rows * fit.cellH + (fit.beside ? 0 : Math.min(fit.cellW, fit.cellH));
    return { ...fit, tap: Math.min(fit.cellW, fit.cellH) * scale, inside: across <= w && down <= h };
  };
  it("gives every amount a 44px tap on screen and keeps the grid on the cloth", () => {
    expect(onScreen(214, 246, 1)).toMatchObject({ cols: 4, rows: 3, beside: false, inside: true });
    expect(onScreen(300, 246, 1)).toMatchObject({ cols: 4, rows: 3, inside: true });
    expect(onScreen(184, 246, 0.787)).toMatchObject({ cols: 3, rows: 2, inside: true });
    expect(onScreen(240, 132, 1)).toMatchObject({ cols: 4, rows: 2, beside: true, inside: true });
    for (const [w, h, s] of [[214, 246, 1], [300, 246, 1], [184, 246, 0.787], [172 / 0.81, 246, 0.81], [240, 132, 1]]) {
      expect(onScreen(w, h, s).tap).toBeGreaterThanOrEqual(44);
    }
  });
  it("on a cloth too small for full taps, still keeps the grid on it", () => {
    expect(onScreen(184, 246, 0.5).inside).toBe(true);
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
