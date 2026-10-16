// Decaid profiles: steps checked against the machine's targets and limits, edits, a brew temperature, AI designs.
import { items, number, object, text, type ObjectData } from "./data";

/** Every step `delta` °C warmer (or cooler), so a profile's rises and falls stay; null when a step leaves 0–100 °C. */
export function shiftedSteps(steps: ObjectData[], delta: number): ObjectData[] | null {
  const shifted = steps.map((s) => ({ ...s, temperature: Math.round(((number(s.temperature) ?? NaN) + delta) * 100) / 100 }));
  return shifted.every((s) => Number.isFinite(s.temperature) && s.temperature >= 0 && s.temperature <= 100) ? shifted : null;
}

/** The profile brewed at `temp` °C: its first step at that, the others moved as much. Null when it can't be. */
export function profileAt(profile: ObjectData, temp: number): ObjectData | null {
  const steps = items(profile.steps);
  const base = number(steps[0]?.temperature);
  if (base === undefined) return null;
  const shifted = shiftedSteps(steps, temp - base);
  return shifted ? { ...profile, steps: shifted } : null;
}

/** Decaid's beverage categories (a profile's beverage_type). */
export const BEVERAGES = ["espresso", "filter", "pourover", "tea", "tea_portafilter", "calibrate", "cleaning", "manual"] as const;
/** A number in [min, max], `fallback` when left out; anything else is refused. */
function within(v: unknown, min: number, max: number, fallback?: number): number {
  if (v === undefined && fallback !== undefined) return fallback;
  const n = number(v);
  if (n === undefined || n < min || n > max) throw new Error("invalidArguments");
  return Math.round(n * 100) / 100;
}
/** Decaid steps checked against the machine's targets, exits and limits. */
function profileSteps(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error("invalidArguments");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalidArguments");
    const s = object(raw);
    if (Object.keys(s).some((k) => !["name", "temperature", "sensor", "pump", "transition", "pressure", "flow", "seconds", "volume", "weight", "exit", "limiter"].includes(k))) throw new Error("invalidArguments");
    const name = text(s.name).trim(), pump = text(s.pump);
    if (!name || name.length > 40 || (pump !== "pressure" && pump !== "flow")) throw new Error("invalidArguments");
    // The pump's own target must be given; the other one is only the limiter's business.
    if (s[pump] == null) throw new Error("invalidArguments");
    const transition = s.transition === undefined ? "fast" : text(s.transition), sensor = s.sensor === undefined ? "coffee" : text(s.sensor);
    if (!["fast", "smooth"].includes(transition) || !["coffee", "water"].includes(sensor)) throw new Error("invalidArguments");
    const step: ObjectData = {
      name, temperature: within(s.temperature, 0, 105), sensor, pump, transition,
      pressure: within(s.pressure, 0, 12, 0), flow: within(s.flow, 0, 15, 0), seconds: within(s.seconds, 0, 127),
      volume: within(s.volume, 0, 2000, 0), weight: within(s.weight, 0, 2000, 0),
    };
    if (s.exit != null) {
      if (typeof s.exit !== "object" || Array.isArray(s.exit)) throw new Error("invalidArguments");
      const e = object(s.exit);
      if (Object.keys(e).some((k) => !["type", "condition", "value"].includes(k))
        || !["pressure", "flow"].includes(text(e.type)) || !["over", "under"].includes(text(e.condition))) throw new Error("invalidArguments");
      step.exit = { type: text(e.type), condition: text(e.condition), value: within(e.value, 0, e.type === "flow" ? 8 : 12) };
    }
    if (s.limiter != null) {
      if (typeof s.limiter !== "object" || Array.isArray(s.limiter)) throw new Error("invalidArguments");
      const l = object(s.limiter);
      if (Object.keys(l).some((k) => !["value", "range"].includes(k))) throw new Error("invalidArguments");
      step.limiter = { value: within(l.value, 0, pump === "pressure" ? 8 : 12), range: within(l.range, 0, 10, 0.6) };
    }
    return step;
  });
}

/** Only named profile fields change; an edited step list replaces the list, including cleared exits and limits. */
export function editedProfile(b: ObjectData, original: ObjectData) {
  const patch: ObjectData = {};
  for (const [field, max] of [["title", 120], ["author", 120], ["notes", 10000]] as const) {
    if (!(field in b)) continue;
    if (typeof b[field] !== "string" || b[field].length > max || (field === "title" && !b[field].trim())) throw new Error("invalidArguments");
    patch[field] = field === "title" ? b[field].trim() : b[field];
  }
  if ("beverageType" in b) {
    if (!(BEVERAGES as readonly unknown[]).includes(b.beverageType)) throw new Error("invalidArguments");
    patch.beverage_type = b.beverageType;
  }
  if ("steps" in b) patch.steps = profileSteps(b.steps);
  for (const [field, key, max] of [
    ["targetWeight", "target_weight", 2000], ["targetVolume", "target_volume", 2000], ["tankTemperature", "tank_temperature", 110],
  ] as const) if (field in b) patch[key] = within(b[field], 0, max);
  if ("volumeCountStart" in b) {
    if (!Number.isInteger(b.volumeCountStart)) throw new Error("invalidArguments");
    patch.target_volume_count_start = within(b.volumeCountStart, 0, items(patch.steps ?? original.steps).length);
  }
  const profile = { ...original, ...patch };
  if ((number(profile.target_volume_count_start) ?? 0) > items(profile.steps ?? []).length) throw new Error("invalidArguments");
  return profile;
}

/** Decaid hashes execution separately from title/author/notes, and omits the unused pump target. */
export function profileExecution(profile: ObjectData) {
  return JSON.stringify([
    profile.beverage_type, profile.tank_temperature ?? 0, profile.target_weight ?? 0, profile.target_volume ?? 0, profile.target_volume_count_start ?? 0,
    items(profile.steps).map((s) => [
      s.name, s.pump, s[s.pump === "flow" ? "flow" : "pressure"] ?? 0, s.temperature, s.seconds,
      s.sensor ?? "coffee", s.transition ?? "fast", s.volume ?? 0, s.weight ?? 0,
      s.exit == null ? null : [object(s.exit).type, object(s.exit).condition, object(s.exit).value],
      s.limiter == null ? null : [object(s.limiter).value, object(s.limiter).range ?? 0.6],
    ]),
  ]);
}

/**
 * A new assistant design, grouped under "AI / …" in the skin's profile list, and the dose it was made for (null when
 * not given). The plugin keeps that dose in the profile's metadata under its own key.
 */
export function designedProfile(b: ObjectData) {
  if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 60 || !Array.isArray(b.steps)) throw new Error("invalidArguments");
  const profile = editedProfile({ ...b, title: `AI / ${b.title.trim()}` }, {
    author: "AI assistant", notes: "", beverage_type: "espresso", tank_temperature: 0,
    target_weight: 0, target_volume: 0, target_volume_count_start: 0, legacy_profile_type: "settings_2c", type: "advanced", version: "2",
  });
  if (!Array.isArray(profile.steps)) throw new Error("invalidArguments");
  return { profile, dose: b.dose == null ? null : within(b.dose, 1, 100) };
}
