import { describe, expect, it } from "vitest";
import { texts } from "./i18n";
import { nextCoffee, skinSurfaces, type Kept } from "./skin";
import type { ObjectData } from "./protocol";

const profile = { title: "Classic", steps: [] };
const answer = (context: ObjectData, more: { kept?: Kept | null; lastGrind?: string } = {}) =>
  skinSurfaces({ s: texts.skin, workflow: { profile, context }, kept: more.kept ?? null, lastGrind: more.lastGrind ?? "", now: Date.now() });
const surface = (a: { surfaces: ObjectData[] }, id: string) => a.surfaces.find((s) => s.id === id);

describe("Streamline's surfaces", () => {
  it("asks to choose a coffee until one is chosen, then names it, without an image", () => {
    let a = answer({ targetDoseWeight: 18 });
    expect(a.live).toEqual({ endpoint: "changed" });
    expect(a.version).toBe(1);
    expect(surface(a, "bean-journal")).toEqual({ id: "bean-journal", kind: "header-button", label: "Bean Journal", text: "Choose coffee",
      action: { type: "open", view: "pick", presentation: "overlay", size: "full" } });
    a = answer({ coffeeName: "A very long coffee name that won't fit", coffeeRoaster: "Roastery" });
    expect(surface(a, "bean-journal")).toMatchObject({ label: "A very long coffee name…", text: "Roastery", action: { view: "shot" } });
    expect(surface(a, "bean-journal")).not.toHaveProperty("image");
    expect(surface(a, "bean-journal-saver")).toMatchObject({ kind: "screensaver-button", action: { type: "open", view: "shot", presentation: "overlay", size: "full" } });
    expect(surface(a, "history-shot")).toMatchObject({ kind: "menu-item", menu: "shot-history", label: "Rate and edit", action: { type: "open", view: "shot", size: "full" } });
    expect(JSON.stringify(a)).not.toMatch(/beanbox/i);
  });

  it("names the kept coffee while Streamline's clean-up is being undone", () => {
    const gear = { extras: { beanJournal: { gear: { coffeeName: "Kiambu", coffeeRoaster: "R" } } } };
    expect(nextCoffee(gear)).toEqual({ name: "Kiambu", roaster: "R" });
    expect(nextCoffee({ ...gear, beanBatchId: "other" })).toBeNull();
    expect(nextCoffee({ ...gear, coffeeName: "Huila" })).toEqual({ name: "Huila", roaster: "" });
  });

  it("shows the last grind, the gear with water, the steps, the scale and the shot strip", () => {
    const a = answer({ coffeeName: "Kiambu", grinderSetting: "14", grinderModel: "Lagom 01", targetDoseWeight: 18, targetYield: 36,
      extras: { rpm: 900, beanJournal: { water: "Lotus Light" } } }, { lastGrind: "12" });
    expect(surface(a, "last-grind")).toMatchObject({ kind: "tile-hint", tile: "grind", size: "large", text: "Last 12", action: { type: "set", field: "grinderSetting", value: 12 } });
    expect(surface(a, "gear")).toEqual({ id: "gear", kind: "tile-line", tile: "grind", size: "large", text: "Lagom 01 · 900 rpm · Lotus Light",
      action: { type: "open", view: "next", presentation: "overlay", fit: true, closeOnShot: true } });
    expect(surface(a, "dose-step")).toMatchObject({ kind: "tile-line", tile: "dose", size: "large", action: { type: "stepsize", field: "targetDoseWeight", sizes: [1, 0.5, 0.1] } });
    expect(surface(a, "drink-step")).toMatchObject({ kind: "tile-hint", tile: "drink", size: "small", action: { type: "stepsize", field: "targetYield" } });
    expect(surface(a, "dose-scale")).toMatchObject({ kind: "tile-hint", tile: "dose", size: "large", text: "⚖ Scale", action: { type: "set", field: "targetDoseWeight", from: "scale" } });
    expect(surface(a, "ratio")).toMatchObject({ kind: "ratio-action", action: { type: "call", endpoint: "ratio", field: "ratio", input: { min: 1, max: 20, decimals: 1, value: 2 } } });
    const strip = surface(a, "shot-strip") as { cells: ObjectData[] };
    expect(strip.cells).toEqual([
      { cell: "step", col: 1, span: 1 }, { cell: "puckTemp", col: 2, span: 2 },
      { cell: "pressure", col: 4, span: 2, dot: { greenWithin: 0.25, amberWithin: 0.5 } }, { cell: "flow", col: 6, span: 1, dot: { greenWithin: 0.25, amberWithin: 0.5 } },
      { cell: "weightFlow", col: 7, span: 1, label: "g/s" }, { cell: "weight", col: 8, span: 2, bar: true },
    ]);
    expect(a.surfaces.filter((x) => String(x.kind).startsWith("tile-") && x.id !== "drink-step").every((x) => x.size === "large")).toBe(true);
    // The same grind, or no coffee: no hint; a grind that isn't a number is shown without a tap.
    expect(surface(answer({ coffeeName: "K", grinderSetting: "12.0" }, { lastGrind: "12" }), "last-grind")).toBeUndefined();
    expect(surface(answer({ grinderSetting: "14" }, { lastGrind: "12" }), "last-grind")).toBeUndefined();
    expect(surface(answer({ coffeeName: "K" }, { lastGrind: "2+3" }), "last-grind")).not.toHaveProperty("action");
    expect(surface(answer({}), "gear")).toMatchObject({ text: "Grinder · RPM · water" });
  });

  it("keeps the ratio being kept while the skin's new dose waits for the plugin's drink weight", () => {
    const off = answer({ targetDoseWeight: 18, targetYield: 36 });
    expect(surface(off, "keep-ratio")).toMatchObject({ kind: "tile-line", tile: "drink", active: false, text: "🔓 Ratio", action: { type: "call", endpoint: "ratio", field: "lock", value: 1 } });
    expect(surface(off, "keep-ratio")).not.toHaveProperty("keepRatio");
    const kept: Kept = { dose: 20, yield: 50, title: "Classic", ratio: 2.5 };
    const on = answer({ targetDoseWeight: 21, targetYield: 50, extras: { lockRatio: true } }, { kept });
    expect(surface(on, "keep-ratio")).toMatchObject({ active: true, text: "🔒 Ratio", action: { value: 0 }, keepRatio: 2.5, keepRatioMoves: "yield" });
    expect(surface(on, "ratio")).toMatchObject({ action: { input: { value: 2.5 } } });
    // A drink of a few grams makes a ratio the numpad couldn't type: not kept.
    expect(surface(answer({ targetDoseWeight: 18, targetYield: 4, extras: { lockRatio: true } }), "keep-ratio")).not.toHaveProperty("keepRatio");
    expect(surface(answer({ targetDoseWeight: 18 }), "ratio")).toBeUndefined();
  });
});
