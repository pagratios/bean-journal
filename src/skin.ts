// What stock Streamline shows for Bean Journal (its plugin surfaces, the `skin` answer), from the next shot's workflow.
import type { Copy } from "./i18n";
import { number, optionalObject, shotRpm, tagOf, text, waterName, type ObjectData } from "./protocol";

/**
 * Keep ratio's memory: the dose and drink last seen, under which profile, and the ratio the user keeps (not recomputed
 * from rounded weights). `replaced`: the drink weight the plugin just replaced, for a moment.
 */
export type Kept = { dose: number; yield: number; title: string; ratio: number; replaced?: { yield: number; at: number } };

export const round1 = (n: number) => Math.round(n * 10) / 10;
const hundredths = (n: number) => Math.round(n * 100) / 100;
const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** The coffee the next shot is for: the workflow's, else the one kept while Streamline's clean-up is being undone. */
export function nextCoffee(context: ObjectData) {
  const gear = optionalObject(tagOf(context).gear);
  const name = text(context.coffeeName) || (!context.beanBatchId ? text(gear.coffeeName) : "");
  const roaster = text(context.coffeeName) ? text(context.coffeeRoaster) : name ? text(gear.coffeeRoaster) : "";
  return name ? { name, roaster } : null;
}

export type SkinInput = {
  s: Copy["skin"];
  workflow: ObjectData;
  kept: Kept | null;
  /** The grind of the coffee's newest shot ("" when none or unknown). */
  lastGrind: string;
  now: number;
};

export function skinSurfaces({ s, workflow, kept, lastGrind, now }: SkinInput) {
  const context = optionalObject(workflow.context);
  const coffee = nextCoffee(context);
  const surfaces: ObjectData[] = [];
  // Full screen over the dashboard (Streamline's `size: "full"`): no reload of the skin on the way back.
  const open = (view: string) => ({ type: "open", view, presentation: "overlay", size: "full" });
  const roaster = coffee ? coffee.roaster : s.choose;
  surfaces.push({
    id: "bean-journal", kind: "header-button", label: clip(coffee?.name || s.button, 24),
    ...(roaster ? { text: clip(roaster, 40) } : {}),
    action: open(coffee ? "shot" : "pick"),
  });
  surfaces.push({ id: "bean-journal-saver", kind: "screensaver-button", label: s.button, action: open("shot") });
  // Long-press on Streamline's shot history: that shot on the Shot page (Streamline adds ?shotId=), to rate or change it.
  surfaces.push({ id: "history-shot", kind: "menu-item", menu: "shot-history", label: s.menuShot, action: open("shot") });
  // The shot's live numbers above the chart while an espresso runs: the step, the puck temperature, pressure and flow
  // (their goal, and a dot, on the steps that hold them) and the weight against the drink with a bar. Within a quarter
  // of the goal is on target, within half drifting.
  const dot = { greenWithin: 0.25, amberWithin: 0.5 };
  surfaces.push({
    id: "shot-strip", kind: "shot-strip", show: "shot", cells: [
      { cell: "step", col: 1, span: 1 },
      { cell: "puckTemp", col: 2, span: 2 },
      { cell: "pressure", col: 4, span: 2, dot },
      { cell: "flow", col: 6, span: 1, dot },
      { cell: "weightFlow", col: 7, span: 1, label: "g/s" },
      { cell: "weight", col: 8, span: 2, bar: true },
    ],
  });
  // `large`: Streamline's own Time | Flow size; it draws a smaller one where the text wouldn't fit.
  const size = "large";
  const grind = text(context.grinderSetting).trim(), last = lastGrind.trim();
  const numeric = /^\d{1,4}(\.\d+)?$/.test(last);
  if (coffee && last && last !== grind && !(numeric && Number(last) === Number(grind))) {
    surfaces.push({
      id: "last-grind", kind: "tile-hint", tile: "grind", size, text: clip(s.lastGrind.replace("{grind}", last), 24), title: s.lastGrindTitle,
      ...(numeric ? { action: { type: "set", field: "grinderSetting", value: Number(last) } } : {}),
    });
  }
  const rpm = shotRpm(context);
  const gear = [text(context.grinderModel), rpm ? s.rpm.replace("{rpm}", String(rpm)) : "", waterName(tagOf(context).water)].filter(Boolean).join(" · ");
  // `fit`: invisible until the card says its size (no flash of Streamline's default window); `closeOnShot`: it is for
  // the next shot only.
  surfaces.push({ id: "gear", kind: "tile-line", tile: "grind", size, text: clip(gear || s.gearNone, 40),
    action: { type: "open", view: "next", presentation: "overlay", fit: true, closeOnShot: true } });
  surfaces.push({ id: "dose-step", kind: "tile-line", tile: "dose", size, text: "±1 g", action: { type: "stepsize", field: "targetDoseWeight", sizes: [1, 0.5, 0.1] } });
  // Drink's line is Keep ratio, so its step is the pill under the value (small: it shares that room with "(1:x)").
  surfaces.push({ id: "drink-step", kind: "tile-hint", tile: "drink", size: "small", text: "±1 g", action: { type: "stepsize", field: "targetYield", sizes: [1, 0.5, 0.1] } });
  // The skin reads the scale on the tap, and refuses a weight that can't be a dose (a cup, a busy machine, just after
  // a shot), so the pill can always be there.
  surfaces.push({ id: "dose-scale", kind: "tile-hint", tile: "dose", size, text: s.scale, title: s.scaleTitle, action: { type: "set", field: "targetDoseWeight", from: "scale" } });
  const dose = number(context.targetDoseWeight), yieldG = number(context.targetYield);
  const locked = optionalObject(context.extras).lockRatio === true;
  let ratio = dose && dose > 0 && yieldG && yieldG > 0 ? round1(yieldG / dose) : null;
  // Locked, a skin may read this right after its new dose, before the plugin moved the drink weight: the ratio being
  // kept, not the one of the new dose and the old weight.
  const sameProfile = !!kept && kept.title === text(optionalObject(workflow.profile).title);
  if (locked && ratio && kept && sameProfile) {
    const newDose = Math.abs(dose! - kept.dose) >= 0.05 && Math.abs(yieldG! - kept.yield) < 0.05;
    const writing = Math.abs(dose! - kept.dose) < 0.05 && !!kept.replaced && now - kept.replaced.at < 10000 &&
      Math.abs(yieldG! - kept.replaced.yield) < 0.05 && Math.abs(yieldG! - kept.yield) >= 0.05;
    if (newDose || writing) ratio = round1(kept.ratio);
  }
  // A tap on Streamline's own "(1:x)" under Drink types a new ratio on its numpad.
  if (ratio) {
    surfaces.push({
      id: "ratio", kind: "ratio-action", title: s.ratioTitle,
      action: { type: "call", endpoint: "ratio", field: "ratio", input: { title: s.ratioMode, min: 1, max: 20, decimals: 1, value: Math.min(20, Math.max(1, ratio)) } },
    });
  }
  // keepRatio: the skin moves the drink with the dose in the same write, so the ratio never shows the new dose over
  // the old drink. "yield": a drink weight the user sets is theirs, and so is the ratio it makes.
  const keepAt = locked && dose && dose > 0 && yieldG && yieldG > 0 ? hundredths(sameProfile ? kept!.ratio : yieldG / dose) : null;
  surfaces.push({
    id: "keep-ratio", kind: "tile-line", tile: "drink", size, active: locked,
    text: locked ? s.keepOnBare : s.keepOff,
    title: locked ? s.keepOnTitle : s.keepOffTitle,
    action: { type: "call", endpoint: "ratio", field: "lock", value: locked ? 0 : 1 },
    // A ratio the numpad couldn't type (a drink set to a few grams, say) isn't kept: the skin would move the drink to it.
    ...(keepAt && keepAt >= 1 && keepAt <= 20 ? { keepRatio: keepAt, keepRatioMoves: "yield" } : {}),
  });
  return { version: 1, surfaces, live: { endpoint: "changed" } };
}
