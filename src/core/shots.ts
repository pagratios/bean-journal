// A Decaid shot read for a page: what kind of brew it was, its curves and profile steps, and a plain-text account.
import { number, object, optionalObject, text, type ObjectData } from "./data";

/**
 * What the shot was, from its profile's beverage type: a brew (espresso, filter, other), or a cleaning / calibration
 * run. de1app treats a missing type as espresso, and so does this.
 */
export type ShotKind = "espresso" | "filter" | "other" | "cleaning" | "calibration";
export function shotKind(profile: ObjectData): ShotKind {
  const type = text(profile.beverage_type).trim().toLowerCase();
  if (type === "cleaning") return "cleaning";
  if (type === "calibrate" || type === "calibration") return "calibration";
  if (type === "pourover" || type === "filter") return "filter";
  if (type === "" || type === "espresso" || type === "manual") return "espresso";
  return "other";
}
export const isBrew = (kind: ShotKind) => kind !== "cleaning" && kind !== "calibration";

/** The user's taste verdict and the cup's body; Decaid has no field for either, so each plugin keeps them in its extras. */
export const BALANCES = ["sour", "balanced", "bitter"] as const;
export const BODIES = ["thin", "medium", "heavy"] as const;

/** The grinder's speed, a whole 1–5000, as the workflow carried it (Streamline's `extras.rpm`; some skins `grinderRpm`). */
export function shotRpm(context: ObjectData): number | undefined {
  const fits = (v: number | undefined): v is number => v !== undefined && Number.isInteger(v) && v >= 1 && v <= 5000;
  const extras = optionalObject(context.extras);
  return [number(extras.rpm), number(extras.grinderRpm)].find(fits);
}

/** The shot's id on visualizer.coffee, as Decaid's Visualizer plugin keeps it. */
export function visualizerId(annotations: ObjectData): string | null {
  const extras = optionalObject(annotations.extras);
  const id = text(extras.visualizerId) || text(optionalObject(extras.visualizer).shot_id);
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null;
}

function espressoSamples(shot: ObjectData) {
  return (Array.isArray(shot.measurements) ? shot.measurements : []).filter((sample) => {
    const state = optionalObject(optionalObject(optionalObject(sample).machine).state);
    return state.state === "espresso" && (state.substate === "preinfusion" || state.substate === "pouring");
  }).map(object);
}

/** A machine target: de1app writes −1 for the one a step doesn't control. */
const target = (v: unknown) => { const n = number(v); return n !== undefined && n >= 0 ? n : null; };

export type ShotStep = { t: number; frame: number; name: string };

/**
 * Steps from the machine's targets, for shots without frame numbers. Walking the profile in order, the next step has
 * started when the machine switches between pressure and flow control to the next step's kind, or when the target
 * leaves the current step's value towards the next step's. Steps the targets can't tell apart (the same kind and value)
 * are passed over. With fewer than two steps found nothing is returned: no name is better than a wrong one.
 */
export function stepsFromTargets(samples: ObjectData[], times: number[], profileSteps: ObjectData[]) {
  const goal = (step: ObjectData | undefined) => {
    const pump = step?.pump === "pressure" ? "pressure" : step?.pump === "flow" ? "flow" : null;
    const value = pump ? number(Number(step![pump])) : undefined;
    return pump && value !== undefined && Number.isFinite(value) ? { pump, value } : null;
  };
  const found: ShotStep[] = [];
  const name = (frame: number) => text(profileSteps[frame]?.name).slice(0, 40);
  let k = 0, reached = false;
  samples.forEach((s, i) => {
    const m = optionalObject(s.machine);
    const p = target(m.targetPressure), f = target(m.targetFlow);
    const pump = p !== null && f === null ? "pressure" : f !== null && p === null ? "flow" : null;
    if (!pump || !Number.isFinite(times[i])) return;
    const value = pump === "pressure" ? p! : f!;
    if (!found.length) found.push({ t: Math.round(times[i] * 10) / 10, frame: 0, name: name(0) });
    const current = goal(profileSteps[k]);
    // The next step the targets can tell from this one.
    let n = k + 1;
    while (n < profileSteps.length && (() => { const g = goal(profileSteps[n]); return !g || (current && g.pump === current.pump && Math.abs(g.value - current.value) < 0.15); })()) n++;
    const next = goal(profileSteps[n]);
    if (!current || !next) return;
    if (pump === current.pump && Math.abs(value - current.value) < 0.25) reached = true;
    const switched = pump !== current.pump && pump === next.pump;
    const left = pump === current.pump && pump === next.pump && reached &&
      Math.abs(value - current.value) >= 0.25 && Math.sign(value - current.value) === Math.sign(next.value - current.value);
    if (switched || left) {
      k = n;
      reached = pump === next.pump && Math.abs(value - next.value) < 0.25;
      found.push({ t: Math.round(times[i] * 10) / 10, frame: n, name: name(n) });
    }
  });
  return found.length > 1 ? found : [];
}

export type SeriesKey = "t" | "pressure" | "flow" | "weight" | "weightFlow" | "temp" | "targetPressure" | "targetFlow" | "targetTemp";
export const SERIES_KEYS: readonly SeriesKey[] = ["t", "pressure", "flow", "weight", "weightFlow", "temp", "targetPressure", "targetFlow", "targetTemp"];

/**
 * The espresso part of a shot as light curves (at most `points` per series), where each profile step starts, how long
 * it poured and the scale's last weight.
 */
export function shotCurves(shot: ObjectData, points = 240) {
  const profile = optionalObject(optionalObject(shot.workflow).profile);
  const samples = espressoSamples(shot);
  const first = samples.length ? Date.parse(text(optionalObject(samples[0].machine).timestamp)) : NaN;
  const step = Math.max(1, Math.ceil(samples.length / points));
  const series = Object.fromEntries(SERIES_KEYS.map((k) => [k, [] as (number | null)[]])) as Record<SeriesKey, (number | null)[]>;
  const times = samples.map((s) => (Date.parse(text(optionalObject(s.machine).timestamp)) - first) / 1000);
  const weights = samples.map((s) => number(optionalObject(s.scale).weight) ?? null);
  // The scale's own weight flow, else the weight's change over the last second.
  const weightFlowAt = (i: number) => {
    const own = number(optionalObject(samples[i].scale).weightFlow);
    if (own !== undefined) return Math.max(0, own);
    const w = weights[i];
    if (w === null || !Number.isFinite(times[i])) return null;
    let j = i;
    while (j > 0 && times[i] - times[j] < 1) j--;
    const back = weights[j], dt = times[i] - times[j];
    return back === null || dt <= 0 ? null : Math.max(0, Math.round((w - back) / dt * 100) / 100);
  };
  for (let i = 0; i < samples.length; i += step) {
    const m = optionalObject(samples[i].machine), scale = optionalObject(samples[i].scale);
    const t = times[i];
    if (!Number.isFinite(t)) continue;
    series.t.push(Math.round(t * 10) / 10);
    series.pressure.push(number(m.pressure) ?? null);
    series.flow.push(number(m.flow) ?? null);
    series.weight.push(number(scale.weight) ?? null);
    series.weightFlow.push(weightFlowAt(i));
    series.temp.push(number(m.groupTemperature) ?? null);
    series.targetPressure.push(target(m.targetPressure));
    series.targetFlow.push(target(m.targetFlow));
    series.targetTemp.push(target(m.targetGroupTemperature));
  }
  const lastSample = samples[samples.length - 1];
  // Where each profile step starts (the machine's profileFrame changes), with its name, from every sample.
  const profileSteps = Array.isArray(profile.steps) ? profile.steps.map(optionalObject) : [];
  let steps: ShotStep[] = [];
  samples.forEach((s, i) => {
    const frame = number(optionalObject(s.machine).profileFrame);
    if (frame === undefined || !Number.isFinite(times[i]) || (steps.length && steps[steps.length - 1].frame === frame)) return;
    steps.push({ t: Math.round(times[i] * 10) / 10, frame, name: text(profileSteps[frame]?.name).slice(0, 40) });
  });
  // Shots imported from de1app have every sample on frame 0: the steps are read from the targets instead.
  if (steps.length <= 1 && profileSteps.length > 1) steps = stepsFromTargets(samples, times, profileSteps);
  const duration = samples.length > 1 ? (Date.parse(text(optionalObject(lastSample.machine).timestamp)) - first) / 1000 : null;
  return {
    series, steps,
    duration: duration !== null && Number.isFinite(duration) && duration > 0 ? Math.round(duration * 10) / 10 : null,
    lastWeight: lastSample ? number(optionalObject(lastSample.scale).weight) : undefined,
  };
}

/** What "Copy for AI" says of a shot; a plugin's shot summary has these and more. */
export type ShotFacts = {
  kind: ShotKind; timestamp: string; profile: string; coffeeName: string; coffeeRoaster: string;
  dose: number | null; yield: number | null; duration: number | null;
  grind: string; grinderModel: string; rpm: number | null; water: string | null;
  score: number | null; balance: string | null; body: string | null; tds: number | null; ey: number | null;
  notes: string; steps: ShotStep[]; series: { t: (number | null)[]; pressure: (number | null)[]; flow: (number | null)[] };
};

/** A shot as plain text to paste into any AI chat ("Copy for AI"): the numbers, the taste and the curves' key points. */
export function shotText(s: ShotFacts, when = "") {
  const g = (v: number | null, unit: string, digits = 1) => v === null ? "" : `${Math.round(v * 10 ** digits) / 10 ** digits}${unit}`;
  const ratio = s.dose && s.yield ? ` (1:${(s.yield / s.dose).toFixed(1)})` : "";
  const peak = (values: (number | null)[]) => {
    let at = -1;
    values.forEach((v, i) => { if (v !== null && (at < 0 || v > (values[at] ?? -Infinity))) at = i; });
    return at < 0 ? null : { value: values[at] as number, t: s.series.t[at] };
  };
  const p = peak(s.series.pressure), f = peak(s.series.flow);
  const lines = [
    `${s.kind === "filter" ? "Filter brew" : "Espresso shot"}${when || s.timestamp ? ` — ${when || s.timestamp}` : ""}`,
    s.coffeeName ? `Coffee: ${s.coffeeName}${s.coffeeRoaster ? ` (${s.coffeeRoaster})` : ""}` : "",
    s.profile ? `Profile: ${s.profile}` : "",
    s.dose || s.yield || s.duration ? `Dose ${g(s.dose, " g") || "?"} → ${g(s.yield, " g") || "?"}${ratio}${s.duration ? ` in ${g(s.duration, " s")}` : ""}` : "",
    s.grind || s.grinderModel ? `Grind: ${[s.grind, s.grinderModel ? `on ${s.grinderModel}` : "", s.rpm ? `${s.rpm} rpm` : ""].filter(Boolean).join(" ")}` : "",
    s.water ? `Water: ${s.water}` : "",
    [s.score !== null ? `Score ${s.score}/100` : "", s.balance ?? "", s.body ? `${s.body} body` : ""].filter(Boolean).join(" · "),
    [s.tds !== null ? `TDS ${g(s.tds, " %", 2)}` : "", s.ey !== null ? `EY ${g(s.ey, " %")}` : ""].filter(Boolean).join(" · "),
    s.steps.length ? `Steps: ${s.steps.map((x) => `${x.name || `#${x.frame + 1}`} at ${x.t} s`).join(", ")}` : "",
    p || f ? `Curves: ${[p ? `peak pressure ${g(p.value, " bar")} at ${p.t} s` : "", f ? `peak flow ${g(f.value, " ml/s")} at ${f.t} s` : ""].filter(Boolean).join("; ")}` : "",
    s.notes ? `Notes: ${s.notes}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}
