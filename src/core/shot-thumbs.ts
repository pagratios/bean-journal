// A list's shots in miniature: their curves read light on the plugin side, drawn small in the page.
import { localId, object, type ObjectData } from "./data";
import { shotCurves } from "./shots";

/** A shot's pressure, flow and weight curves at a few points each, and how long it poured (seconds, null if unknown). */
export type ShotThumb = {
  t: number[]; pressure: (number | null)[]; flow: (number | null)[]; weight: (number | null)[]; duration: number | null;
};

export function shotThumb(shot: ObjectData, points = 48): ShotThumb {
  const { series, duration } = shotCurves(shot, points);
  return { t: series.t as number[], pressure: series.pressure, flow: series.flow, weight: series.weight, duration };
}

export const SHOT_THUMBS_MAX = 30;

/**
 * The thumbnails of the shots asked for (duplicates once, at most `max`), keyed by id. `read` gets a checked id and
 * returns the stored shot (Decaid's `/shots/{id}`); a shot it can't read is left out. A bad id refuses the whole call.
 */
export async function readShotThumbs(ids: unknown, read: (id: string) => Promise<unknown>,
  options: { max?: number; parallel?: number; points?: number } = {}): Promise<{ thumbs: Record<string, ShotThumb> }> {
  const max = options.max ?? SHOT_THUMBS_MAX, parallel = Math.max(1, options.parallel ?? 4);
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(localId))].slice(0, max);
  const thumbs: Record<string, ShotThumb> = {};
  // A few at a time: each read is a whole shot (some 30 kB on a tablet).
  for (let i = 0; i < wanted.length; i += parallel) {
    await Promise.all(wanted.slice(i, i + parallel).map(async (id) => {
      try { thumbs[id] = shotThumb(object(await read(id)), options.points); } catch { /* left out */ }
    }));
  }
  return { thumbs };
}

/**
 * A thumbnail on a big chart's scales: pressure and flow on 0–10 (higher when the peak is), weight at a tenth.
 * `null` draws the empty frame that pulses while the curves are read; curves of fewer than two points, a dash.
 * Self-contained so a plugin can serialize it into its browser client with toString().
 */
export function createShotThumb(c: ShotThumb | null) {
  const ns = "http://www.w3.org/2000/svg";
  const W = 120, H = 48, P = 2;
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const line = (d: string, style: string) => {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("style", style);
    svg.append(path);
  };
  const t = c && Array.isArray(c.t) ? c.t : [];
  svg.setAttribute("class", !c ? "shot-thumb-chart loading" : t.length > 1 ? "shot-thumb-chart" : "shot-thumb-chart empty");
  if (!c) return svg;
  if (t.length < 2) {
    line(`M${W / 2 - 8},${H / 2}L${W / 2 + 8},${H / 2}`, "stroke:var(--muted)");
    return svg;
  }
  const lines: ["weight" | "flow" | "pressure", string, number][] = [
    ["weight", "var(--c-weight)", 0.1], ["flow", "var(--c-flow)", 1], ["pressure", "var(--c-pressure)", 1],
  ];
  const values = (key: "weight" | "flow" | "pressure") => Array.isArray(c[key]) ? c[key] : [];
  let peak = 10, end = 5;
  for (const [key, , scale] of lines) for (const v of values(key)) if (typeof v === "number" && Number.isFinite(v)) peak = Math.max(peak, v * scale);
  for (const x of t) if (typeof x === "number" && Number.isFinite(x)) end = Math.max(end, x);
  for (const [key, colour, scale] of lines) {
    let d = "";
    values(key).forEach((v, i) => {
      if (typeof v !== "number" || !Number.isFinite(v) || typeof t[i] !== "number") return;
      const x = P + t[i] / end * (W - 2 * P), y = H - P - Math.max(0, v * scale) / peak * (H - 2 * P);
      d += `${d ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    });
    if (d) line(d, `stroke:${colour}`);
  }
  return svg;
}

// The frame is the drawing's own, so a host's button colours don't reach it; `button.shot-thumb` clears them.
export const SHOT_THUMB_CSS = `
.shot-thumb{flex:none;width:6.4rem;height:2.667rem;min-width:0;min-height:0;padding:0;border:0;border-radius:0.4rem;line-height:0}
button.shot-thumb{background:transparent}
button.shot-thumb:disabled{opacity:1;cursor:default}
.shot-thumb-chart{display:block;width:100%;height:100%;box-sizing:border-box;border:1px solid var(--ui-divider);border-radius:0.4rem;background:var(--surface-2)}
.shot-thumb-chart path{fill:none;stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.shot-thumb-chart.loading{animation:shot-thumb-pulse 1s ease-in-out infinite}
button.shot-thumb:not(:disabled):active .shot-thumb-chart,button.shot-thumb:focus-visible .shot-thumb-chart{border-color:var(--accent)}
@keyframes shot-thumb-pulse{50%{opacity:.35}}
`;
