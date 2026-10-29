// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RulesForm } from "../RulesForm";

afterEach(cleanup);

/** Each label with the value shown beside it, in order. */
const read = () => [...document.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.firstElementChild?.textContent]);
const labels = (root: ParentNode) => [...root.querySelectorAll("dt, label")].map((n) => n.firstChild?.textContent);
const helps = (root: ParentNode) => [...root.querySelectorAll("p")].map((n) => n.textContent);

describe("rules, read-only", () => {
  it("shows every rule in the editor's order, with the text its select would show", () => {
    render(<RulesForm value={{ scoring: "classic", counting: "classic", passCount: 0, shoot: "on" }} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(read()).toEqual(expect.arrayContaining([
      ["Scoring", "Classic, counted in tens"],
      ["Play to", "1,500"],
      ["Pass cards", "No passing"],
      ["Counting", "Aces 11, tens 10, kings 4, queens 3, jacks 2"],
      ["Last trick", "10 points"],
      ["Shooting the moon", "Allowed"],
    ]));
  });

  it("lays the rules out exactly as the editor does", () => {
    const view = render(<RulesForm value={{}} />).container;
    const edit = render(<RulesForm value={{}} onChange={() => {}} />).container;
    expect(labels(view)).toEqual(labels(edit));
    expect(labels(view)).toHaveLength(13);
    expect(helps(view)).toEqual(helps(edit));
  });

  it("words each value from the table's own rules, never from the defaults", () => {
    render(<RulesForm value={{ scoring: "modern", counterValue: 10, minBid: 20, target: 200, passCount: 2, lastTrickBonus: 5 }} />);
    expect(read()).toEqual(expect.arrayContaining([
      ["Scoring", "Modern, counted in ones"],
      ["Play to", "200"],
      ["Minimum bid", "20"],
      ["Pass cards", "2 each way"],
      ["Counting", "Aces, tens, kings: 10 each"],
      ["Last trick", "5 points"],
    ]));
  });

  it("explains shooting and the nines throw-in only when they are on", () => {
    const on = render(<RulesForm value={{ shoot: "on", ninesMisdeal: true, target: 200 }} />).container;
    expect(helps(on).join(" ")).toMatch(/partner sits out.*every trick for 200.*lose the game/);
    expect(helps(on).join(" ")).toMatch(/Five or more nines and no other meld, before your first bid or pass/);
    cleanup();
    const off = render(<RulesForm value={{ shoot: "off", ninesMisdeal: false }} />).container;
    expect(helps(off)).toEqual([]);
  });
});
