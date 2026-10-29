// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RulesForm } from "../RulesForm";

afterEach(cleanup);

/** Each label with the value shown beside it, in order. */
const read = () => [...document.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]);
const labels = (root: ParentNode) => [...root.querySelectorAll("dt, label")].map((n) => n.firstChild?.textContent);

describe("rules, read-only", () => {
  it("shows every rule in the editor's order, with the text its select would show", () => {
    render(<RulesForm value={{ scoring: "classic", counting: "classic", passCount: 0, shoot: "on" }} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(read()).toEqual(expect.arrayContaining([
      ["Scoring", "Classic ×10 (bid 250, play to 1,500)"],
      ["Play to", "1,500"],
      ["Pass cards", "No passing"],
      ["Counting", "Old-style 11 / 10 / 4 / 3 / 2"],
      ["Last trick", "10 points"],
      ["Shooting the moon", "Allowed"],
    ]));
  });

  it("lays the rules out exactly as the editor does", () => {
    const view = render(<RulesForm value={{}} />).container;
    const edit = render(<RulesForm value={{}} onChange={() => {}} />).container;
    expect(labels(view)).toEqual(labels(edit));
    expect(labels(view)).toHaveLength(13);
  });
});
