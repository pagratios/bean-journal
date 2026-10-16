// Pure helpers: Decaid's data read safely, shots summarised for the page, profiles an assistant designs.
export type ObjectData = Record<string, unknown>;
export function object(value: unknown): ObjectData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalidData");
  return value as ObjectData;
}
export function optionalObject(value: unknown): ObjectData {
  return value == null ? {} : object(value);
}
export function items(value: unknown): ObjectData[] {
  if (!Array.isArray(value)) throw new Error("invalidData");
  return value.map(object);
}
export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
export function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function localId(value: unknown): string {
  const id = text(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(id) || ["constructor", "prototype"].includes(id)) throw new Error("invalidId");
  return id;
}
/** A Decaid profile's id: "profile:<hash>" (the colon is why localId won't do). */
export function profileId(value: unknown): string {
  const id = text(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,119}$/.test(id)) throw new Error("invalidId");
  return id;
}
// Decaid's plugin engine has no URL class: these parse by hand.
/** An https address without credentials (no "@" can sit in the host part), or null. */
export function httpsUrl(value: unknown): string | null {
  const url = text(value).trim();
  return url.length <= 1000 && /^https:\/\/([a-z0-9.-]+|\[[0-9a-f:.]+\])(:\d{1,5})?([/?#][^\s]*)?$/i.test(url) ? url : null;
}
/** The host of an http(s) Origin header, lower case and without brackets, or null. */
export function originHost(origin: string): string | null {
  const m = /^https?:\/\/([a-z0-9.-]+|\[[0-9a-f:.]+\])(?::\d{1,5})?\/?$/i.exec(origin);
  return m ? m[1].replace(/^\[|\]$/g, "").toLowerCase() : null;
}

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

export const BALANCES = ["sour", "balanced", "bitter"] as const;
/** The cup's body, kept in the plugin's extras (Decaid has no field for it). */
export const BODIES = ["thin", "medium", "heavy"] as const;
/** The plugin's own data on a shot or the next shot (Decaid has no field for taste, body or water). */
export const tagOf = (holder: ObjectData) => optionalObject(optionalObject(holder.extras).beanJournal);
/** The user's taste verdict kept on the shot: a value, null when cleared, undefined when never set. */
export function shotBalance(annotations: ObjectData): string | null | undefined {
  const tag = tagOf(annotations);
  if (!("balance" in tag)) return undefined;
  return (BALANCES as readonly unknown[]).includes(tag.balance) ? text(tag.balance) : null;
}
/** The cup's body as the plugin keeps it (thin, medium, heavy); null once cleared, undefined when never set. */
export function shotBodyLevel(annotations: ObjectData): string | null | undefined {
  const tag = tagOf(annotations);
  if (!("body" in tag)) return undefined;
  return (BODIES as readonly unknown[]).includes(tag.body) ? text(tag.body) : null;
}
/** The grinder's speed, a whole 1–5000, as the workflow carried it (Streamline's `extras.rpm`; some skins `grinderRpm`). */
export function shotRpm(context: ObjectData): number | undefined {
  const fits = (v: number | undefined): v is number => v !== undefined && Number.isInteger(v) && v >= 1 && v <= 5000;
  const extras = optionalObject(context.extras);
  return [number(extras.rpm), number(extras.grinderRpm)].find(fits);
}
/** A water's name as typed: one line, at most 80 characters. */
export const waterName = (value: unknown) => text(value).replace(/[\r\n\t]+/g, " ").trim().slice(0, 80);
/**
 * The water the shot was made with: the one the page keeps with the shot (null once cleared there), else the one the
 * next shot's workflow carried; undefined when neither says.
 */
export function shotWater(annotations: ObjectData, context: ObjectData = {}): string | null | undefined {
  const own = tagOf(annotations);
  if ("water" in own) return waterName(own.water) || null;
  return waterName(tagOf(context).water) || undefined;
}

// ── The notes block (setting VisualizerNotes): what Decaid has no field for, in the notes Visualizer receives ──
const OPEN = "[Bean Journal]", CLOSE = "[/Bean Journal]";
/** The user's own notes: the shot's notes without the exact block the plugin wrote (a block edited elsewhere stays). */
export function shotNotes(annotations: ObjectData): string {
  const notes = text(annotations.espressoNotes);
  const block = text(tagOf(annotations).notesBlock);
  const at = block ? notes.lastIndexOf(block) : -1;
  return at < 0 ? notes : notes.slice(0, at) + notes.slice(at + block.length);
}
/** The block as it is written after `notes` ("" for no block): a blank line from the notes, then the markers. */
export function notesBlock(notes: string, lines: string[]) {
  return lines.length ? `${notes ? "\n\n" : ""}${[OPEN, ...lines, CLOSE].join("\n")}` : "";
}
/** The user's new notes with the block kept after them (the page and assistants edit the notes without it). */
export function notesWithBlock(annotations: ObjectData, notes: string): ObjectData {
  const block = text(tagOf(annotations).notesBlock);
  const kept = block && text(annotations.espressoNotes).includes(block) ? block.replace(/^\n\n/, "") : "";
  if (!kept) return { espressoNotes: notes };
  const suffix = `${notes ? "\n\n" : ""}${kept}`;
  return { espressoNotes: notes + suffix, extras: { beanJournal: { notesBlock: suffix } } };
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/**
 * The notes patch that puts the shot's taste, body, water and RPM in its block, or null when nothing changes. A block
 * someone edited elsewhere (not the one remembered) is left alone, and no second one is added.
 */
export function notesBlockPatch(shot: ObjectData): ObjectData | null {
  const annotations = optionalObject(shot.annotations), context = optionalObject(optionalObject(shot.workflow).context);
  const all = text(annotations.espressoNotes), remembered = text(tagOf(annotations).notesBlock);
  const notes = shotNotes(annotations);
  if ((remembered && !all.includes(remembered)) || notes.includes(OPEN)) return null;
  const balance = shotBalance(annotations), body = shotBodyLevel(annotations);
  const water = shotWater(annotations, context), rpm = shotRpm(context);
  const taste = [balance ? `Taste: ${capital(balance)}` : "", body ? `Body: ${capital(body)}` : ""].filter(Boolean).join(" · ");
  const block = notesBlock(notes, [taste, water ? `Water: ${water}` : "", rpm !== undefined ? `Grinder: ${rpm} RPM` : ""].filter(Boolean));
  if (notes + block === all && block === remembered) return null;
  return { espressoNotes: notes + block, extras: { beanJournal: { notesBlock: block || null } } };
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
  const found: { t: number; frame: number; name: string }[] = [];
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

/**
 * What the shot page shows: numbers, the coffee it was pulled with and light curves (at most `points` per series).
 * `coffeeId` is the shot's Decaid batch; `beanId` (that batch's bean) is filled in by the plugin, which knows the batches.
 */
export function shotSummary(shot: ObjectData, points = 240) {
  const workflow = optionalObject(shot.workflow);
  const context = optionalObject(workflow.context);
  const profile = optionalObject(workflow.profile);
  const annotations = optionalObject(shot.annotations);
  const samples = espressoSamples(shot);
  const first = samples.length ? Date.parse(text(optionalObject(samples[0].machine).timestamp)) : NaN;
  const step = Math.max(1, Math.ceil(samples.length / points));
  type Key = "t" | "pressure" | "flow" | "weight" | "weightFlow" | "temp" | "targetPressure" | "targetFlow" | "targetTemp";
  const series = Object.fromEntries((["t", "pressure", "flow", "weight", "weightFlow", "temp", "targetPressure", "targetFlow", "targetTemp"] as Key[])
    .map((k) => [k, [] as (number | null)[]])) as Record<Key, (number | null)[]>;
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
  let steps: { t: number; frame: number; name: string }[] = [];
  samples.forEach((s, i) => {
    const frame = number(optionalObject(s.machine).profileFrame);
    if (frame === undefined || !Number.isFinite(times[i]) || (steps.length && steps[steps.length - 1].frame === frame)) return;
    steps.push({ t: Math.round(times[i] * 10) / 10, frame, name: text(profileSteps[frame]?.name).slice(0, 40) });
  });
  // Shots imported from de1app have every sample on frame 0: the steps are read from the targets instead.
  if (steps.length <= 1 && profileSteps.length > 1) steps = stepsFromTargets(samples, times, profileSteps);
  const duration = samples.length > 1 ? (Date.parse(text(optionalObject(lastSample.machine).timestamp)) - first) / 1000 : null;
  const enjoyment = number(annotations.enjoyment);
  return {
    id: localId(shot.id), timestamp: text(shot.timestamp), profile: text(profile.title),
    kind: shotKind(profile), brew: isBrew(shotKind(profile)),
    coffeeName: text(context.coffeeName), coffeeRoaster: text(context.coffeeRoaster),
    coffeeId: text(context.beanBatchId) || null, beanId: null as string | null,
    dose: number(annotations.actualDoseWeight) ?? number(context.targetDoseWeight) ?? null,
    yield: number(annotations.actualYield) ?? (lastSample ? number(optionalObject(lastSample.scale).weight) : undefined) ?? null,
    targetYield: number(context.targetYield) ?? null,
    duration: duration !== null && Number.isFinite(duration) && duration > 0 ? Math.round(duration * 10) / 10 : null,
    grind: text(context.grinderSetting),
    grinderId: text(context.grinderId) || null, grinderModel: text(context.grinderModel),
    rpm: shotRpm(context) ?? null,
    water: shotWater(annotations, context) ?? null,
    body: shotBodyLevel(annotations) ?? null,
    score: enjoyment !== undefined ? Math.round(enjoyment * 10) : null,
    balance: shotBalance(annotations) ?? null,
    notes: shotNotes(annotations), tds: number(annotations.drinkTds) ?? null,
    // Decaid keeps 0 for "no reading".
    ey: (number(annotations.drinkEy) ?? 0) > 0 ? number(annotations.drinkEy)! : null,
    visualizerId: visualizerId(annotations),
    series, steps,
  };
}
export type Shot = ReturnType<typeof shotSummary>;

/** A shot in a list (no curves): the newest of a set, to compare with or to load. */
export function shotLine(s: ObjectData) {
  const workflow = optionalObject(s.workflow), context = optionalObject(workflow.context), annotations = optionalObject(s.annotations);
  const enjoyment = number(annotations.enjoyment);
  return {
    id: localId(s.id), timestamp: text(s.timestamp), profile: text(optionalObject(workflow.profile).title),
    coffeeName: text(context.coffeeName), coffeeId: text(context.beanBatchId) || null,
    score: enjoyment !== undefined ? Math.round(enjoyment * 10) : null,
    grind: text(context.grinderSetting), grinder: text(context.grinderModel), targetYield: number(context.targetYield) ?? null,
    kind: shotKind(optionalObject(workflow.profile)),
    dose: number(annotations.actualDoseWeight) ?? number(context.targetDoseWeight) ?? null, yield: number(annotations.actualYield) ?? null,
    balance: shotBalance(annotations) ?? null, tds: number(annotations.drinkTds) ?? null, notes: shotNotes(annotations).slice(0, 200),
  };
}
export type ShotLine = ReturnType<typeof shotLine>;

/** Accents and case aside ("Café" = "cafe"). */
export const unaccented = (s: unknown) => text(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Accents, case, apostrophes and punctuation ignored: "Damian’s LRv3" = "damians lrv3". */
export const normTitle = (s: unknown) => unaccented(s)
  .replace(/['’‘`´]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

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

// ── Profiles an AI assistant designs (MCP create_profile) ──
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

/** A new assistant design, grouped under "AI / …" in the skin's profile list. */
export function designedProfile(b: ObjectData) {
  if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 60 || !Array.isArray(b.steps)) throw new Error("invalidArguments");
  const profile = editedProfile({ ...b, title: `AI / ${b.title.trim()}` }, {
    author: "AI assistant", notes: "", beverage_type: "espresso", tank_temperature: 0,
    target_weight: 0, target_volume: 0, target_volume_count_start: 0, legacy_profile_type: "settings_2c", type: "advanced", version: "2",
  });
  if (!Array.isArray(profile.steps)) throw new Error("invalidArguments");
  const dose = b.dose == null ? null : within(b.dose, 1, 100);
  return {
    profile,
    metadata: { beanJournal: { madeBy: "assistant", ...(dose ? { dose } : {}) } },
  };
}

/** A shot as plain text to paste into any AI chat ("Copy for AI"): the numbers, the taste and the curves' key points. */
export function shotText(s: Shot, when = "") {
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
