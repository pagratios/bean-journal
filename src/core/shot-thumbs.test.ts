import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { createShotThumb, readShotThumbs, SHOT_THUMB_CSS, SHOT_THUMBS_MAX, shotThumb, type ShotThumb } from "./index";

const start = Date.parse("2026-11-02T10:00:00Z");
const stored = (seconds: number[], pressure = 9) => ({
  workflow: { profile: { title: "P" } },
  measurements: seconds.map((s) => ({
    machine: { timestamp: new Date(start + s * 1000).toISOString(), state: { state: "espresso", substate: "pouring" }, pressure, flow: 2 },
    scale: { weight: s },
  })),
});

class Node {
  children: Node[] = [];
  attributes: Record<string, string> = {};
  classList = { remove: (name: string) => { this.attributes.class = (this.attributes.class ?? "").split(" ").filter((c) => c !== name).join(" "); } };
  constructor(readonly ns: string, readonly tag: string) {}
  append(...nodes: Node[]) { this.children.push(...nodes); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
}
const documentStub = { createElementNS: (ns: string, tag: string) => new Node(ns, tag) };
const draw = (c: ShotThumb | null) => runInNewContext(`(${createShotThumb.toString()})(c)`, { document: documentStub, c }) as Node;

describe("shot thumbnails", () => {
  it("keeps a shot's pressure, flow and weight at a few points, and how long it poured", () => {
    const thumb = shotThumb(stored(Array.from({ length: 300 }, (_, i) => i / 10)));
    expect(Object.keys(thumb).sort()).toEqual(["duration", "flow", "pressure", "t", "weight"]);
    expect(thumb.t.length).toBeLessThanOrEqual(48);
    expect(thumb.t[0]).toBe(0);
    expect(thumb.duration).toBe(29.9);
    expect(shotThumb({}).duration).toBeNull();
  });

  it("reads each shot once, a few at a time, at most 30, leaving out what it can't read", async () => {
    let running = 0, most = 0;
    const asked: string[] = [];
    const read = async (id: string) => {
      asked.push(id);
      running++; most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      if (id === "gone") throw new Error("notFound");
      return id === "odd" ? [] : stored([0, 10, 20]);
    };
    const ids = ["a", "a", "gone", "odd", ...Array.from({ length: 40 }, (_, i) => `s${i}`)];
    const { thumbs } = await readShotThumbs(ids, read);
    expect(asked).toHaveLength(SHOT_THUMBS_MAX);
    expect(new Set(asked).size).toBe(SHOT_THUMBS_MAX);
    expect(most).toBe(4);
    expect(Object.keys(thumbs)).not.toContain("gone");
    expect(Object.keys(thumbs)).not.toContain("odd");
    expect(thumbs.a).toMatchObject({ t: [0, 10, 20], duration: 20 });
    expect((await readShotThumbs("a", read)).thumbs).toEqual({});
    await expect(readShotThumbs(["a", "../x"], read)).rejects.toThrow("invalidId");
    expect(Object.keys((await readShotThumbs(["a", "b", "c"], read, { max: 2, parallel: 1 })).thumbs)).toEqual(["a", "b"]);
  });

  it("draws on the big chart's scales without module closures", () => {
    const svg = draw({ t: [0, 10, 20], pressure: [0, 9, null], flow: [1, 2, 2], weight: [0, 20, 40], duration: 20 });
    expect(svg.tag).toBe("svg");
    expect(svg.attributes).toMatchObject({ viewBox: "0 0 120 48", class: "shot-thumb-chart", "aria-hidden": "true" });
    expect(svg.children.map((p) => p.attributes.style)).toEqual(["stroke:var(--c-weight)", "stroke:var(--c-flow)", "stroke:var(--c-pressure)"]);
    // 40 g at a tenth is 4 of 10; the pressure's gap leaves its last point out.
    expect(svg.children[0].attributes.d).toBe("M2.0,46.0L60.0,37.2L118.0,28.4");
    expect(svg.children[2].attributes.d).toBe("M2.0,46.0L60.0,6.4");
    // A peak over 10 raises the scale.
    expect(draw({ t: [0, 10], pressure: [12, 12], flow: [], weight: [], duration: null }).children[0].attributes.d).toBe("M2.0,2.0L118.0,2.0");
  });

  it("draws a pulsing frame while reading and a dash without curves", () => {
    expect(draw(null).attributes.class).toBe("shot-thumb-chart loading");
    expect(draw(null).children).toEqual([]);
    const empty = draw({ t: [0], pressure: [1], flow: [1], weight: [1], duration: null });
    expect(empty.attributes.class).toBe("shot-thumb-chart empty");
    expect(empty.children).toHaveLength(1);
    expect(SHOT_THUMB_CSS).toContain(".shot-thumb-chart.loading{animation:shot-thumb-pulse");
  });
});
