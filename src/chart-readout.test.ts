import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { texts } from "./i18n";
import type { createChartReadout } from "./core";

const source = readFileSync(resolve("src", "ui.ts"), "utf8");
const chartSource = source.slice(source.indexOf("  function chart("), source.indexOf("  // Touch-friendly number field:"));
const code = transformSync(chartSource, { loader: "ts" }).code;

class Node {
  children: Node[] = [];
  attributes: Record<string, string> = {};
  listeners = new Map<string, (event: { clientX: number; pointerType: string }) => void>();
  classList = { toggle: vi.fn() };
  hidden = false;
  constructor(readonly tag: string) {}
  append(...nodes: Node[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Node[]) { this.children = nodes; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  getBoundingClientRect() { return { left: 0, width: 600 }; }
  addEventListener(name: string, listener: (event: { clientX: number; pointerType: string }) => void) {
    this.listeners.set(name, listener);
  }
}
const series = {
  t: [0, 5, 10, 15],
  pressure: [9, 8, null, 6], flow: [1, 2, 3, 0], weightFlow: [0, 1, 2, 3],
  weight: [0, 10, 20, 30], temp: [93, 92, 91, 90],
  targetPressure: [0, null, 7], targetFlow: [null, 2.25, 0], targetTemp: [94.5, 95, 96],
};
type RecordedSeries = Omit<typeof series, "targetPressure" | "targetFlow" | "targetTemp"> &
  Partial<Pick<typeof series, "targetPressure" | "targetFlow" | "targetTemp">>;
function setup(compare = false, recorded: RecordedSeries = series) {
  let paintFrame: (() => void) | undefined;
  const makeChartReadout = vi.fn<typeof createChartReadout>(() => (new Node("table") as unknown as HTMLTableElement));
  const chart = runInNewContext(`${code}; chart`, {
    document: { createElementNS: (_ns: string, tag: string) => new Node(tag) },
    el: (tag: string) => new Node(tag), t: texts, makeChartReadout,
    fmt: (value: number, digits = 1) => value.toLocaleString("en-GB", { maximumFractionDigits: digits }),
    requestAnimationFrame: (fn: () => void) => { paintFrame = fn; },
  }) as (data: RecordedSeries, steps: { t: number; name: string; frame: number }[], options: { compare?: RecordedSeries }) => Node;
  const other = { ...series, t: [0, 5], targetPressure: [99, 99], targetFlow: [88, 88], targetTemp: [77, 77] };
  const box = chart(recorded, [{ t: 0, name: "Misleading target 42 bar", frame: 0 }], compare ? { compare: other } : {});
  const svg = box.children[0];
  // The actual pointer handler selects a sample; no test-side target lookup duplicates that logic.
  const select = (time: number) => {
    svg.listeners.get("pointermove")!({ clientX: 26 + time / 15 * (600 - 26 - 84), pointerType: "mouse" });
    paintFrame!();
    const paint = makeChartReadout.mock.calls.at(-1)!;
    return { rows: paint[0], comparison: paint[1], target: paint[2] };
  };
  return { select };
}

describe("chart target sample selection", () => {
  it.each([false, true])("reads current-shot raw targets and keeps zeros with comparison=%s", (compare) => {
    const view = setup(compare), selected = view.select(0);
    expect(selected.rows.map(({ target }) => target)).toEqual(["0", null, null, null, "94.5"]);
    expect(selected.rows.map(({ value }) => value)).toEqual(["9", "1", "0", "0", "93"]);
    expect(selected.comparison).toEqual(compare ? { current: texts.thisShot, other: texts.otherShot } : undefined);
    expect(selected.target).toEqual({ current: texts.chartActual, target: texts.chartTarget });
    expect(view.select(5).rows.map(({ target }) => target)).toEqual([null, "2.25", null, null, "95"]);
    const later = view.select(10);
    expect(later.rows[0]).toMatchObject({ value: null, target: "7", unit: "bar" });
    expect(later.rows[1]).toMatchObject({ target: "0", unit: "ml/s" });
    expect(later.rows[4]).toMatchObject({ target: "96", unit: "\u00b0C" });
    if (compare) expect(later.rows.every(({ other }) => other === null)).toBe(true);
    expect(view.select(15).rows.map(({ target }) => target)).toEqual([null, null, null, null, null]);
  });

  it("does not fill absent targets from earlier samples or named profile steps", () => {
    const { targetPressure: _p, targetFlow: _f, targetTemp: _t, ...withoutTargets } = series;
    const view = setup(false, withoutTargets);
    for (const time of [0, 5, 10, 15]) expect(view.select(time).rows.every(({ target }) => target === null)).toBe(true);
  });
});
