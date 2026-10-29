import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { createChartReadout, type ChartReadoutRow } from "./index";

class Node {
  children: Node[] = [];
  className = "";
  textContent = "";
  scope = "";
  style = { background: "" };
  attributes: Record<string, string> = {};
  constructor(readonly tag: string) {}
  append(...nodes: Node[]) { this.children.push(...nodes); }
  prepend(node: Node) { this.children.unshift(node); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
}
const documentStub = { createElement: (tag: string) => new Node(tag) };
const rows: ChartReadoutRow[] = [
  { label: "Pressure", colour: "red", unit: "bar", value: "9", other: "10.25" },
  { label: "Flow", colour: "blue", unit: "ml/s", value: "0.12", other: null },
  { label: "Weight flow", colour: "green", unit: "g/s", value: null, other: "2.5" },
  { label: "Weight", colour: "brown", unit: "g", value: "123.4", other: "0" },
  { label: "Temperature", colour: "orange", unit: "\u00b0C", value: "93.1", other: "101" },
  { label: "Missing", colour: "", unit: "g", value: null },
];
const comparison = { current: "This shot", other: "Other shot" };
function readout(compare = false) {
  vi.stubGlobal("document", documentStub);
  return createChartReadout(rows, compare ? comparison : undefined) as unknown as Node;
}
afterEach(() => vi.unstubAllGlobals());

describe("chart touch readout", () => {
  it("separates numbers from different-length units in a single table", () => {
    const table = readout(), body = table.children[0];
    expect(table.tag).toBe("table");
    expect(table.className).toBe("chart-readout");
    expect(body.tag).toBe("tbody");
    expect(body.children.map((row) => row.children.map((cell) => cell.textContent))).toEqual([
      ["Pressure", "9", "bar"], ["Flow", "0.12", "ml/s"],
      ["Weight", "123.4", "g"], ["Temperature", "93.1", "\u00b0C"],
    ]);
    for (const row of body.children) {
      const [label, value, unit] = row.children;
      expect(label.scope).toBe("row");
      expect(value.className).toBe("chart-readout-value chart-readout-current");
      expect(unit.className).toBe("chart-readout-unit");
    }
    const dot = body.children[0].children[0].children[0];
    expect(dot.style.background).toBe("red");
    expect(dot.attributes["aria-hidden"]).toBe("true");
  });

  it("shares header and value columns, preserving gaps, zero and values missing from either shot", () => {
    const table = readout(true), [head, body] = table.children;
    expect(head.tag).toBe("thead");
    expect(head.children[0].children.map((cell) => cell.textContent)).toEqual(["", "This shot", "Other shot", ""]);
    expect(head.children[0].children.slice(1, 3).map((cell) => cell.scope)).toEqual(["col", "col"]);
    expect(body.children.map((row) => row.children.map((cell) => cell.textContent))).toEqual([
      ["Pressure", "9", "10.25", "bar"], ["Flow", "0.12", "\u2014", "ml/s"],
      ["Weight flow", "\u2014", "2.5", "g/s"], ["Weight", "123.4", "0", "g"],
      ["Temperature", "93.1", "101", "\u00b0C"],
    ]);
    expect(body.children.every((row) => row.children.length === 4)).toBe(true);
    expect(body.children.every((row) => row.children[2].className === "chart-readout-value")).toBe(true);
  });

  it("keeps the comparison column after the other shot ends", () => {
    vi.stubGlobal("document", documentStub);
    const table = createChartReadout(rows.map((row) => ({ ...row, other: null })), comparison) as unknown as Node;
    expect(table.children[1].children).toHaveLength(4);
    expect(table.children[1].children.every((row) => row.children[2].textContent === "\u2014")).toBe(true);
  });

  it("can serialize without module closures and renders supplied text without HTML", () => {
    const table = runInNewContext(`(${createChartReadout.toString()})(rows, comparison)`, {
      document: documentStub, rows: [{ ...rows[0], label: "<b>Pressure</b>", value: "<img>" }], comparison,
    }) as Node;
    const row = table.children[1].children[0];
    expect(row.children[0].textContent).toBe("<b>Pressure</b>");
    expect(row.children[1].textContent).toBe("<img>");
    expect(row.children[1].children).toEqual([]);
  });
});
