import { number, object, optionalObject, text, type ObjectData } from "./data";
import { isBrew, shotKind } from "./shots";
import { round1, type Kept } from "./surfaces";

export type RatioChoice = { locked: true; ratio: number } | { locked: false; yield: number };
export type RatioMemoryData = { version: 1; entries: { coffee: string; profile: string; choice: RatioChoice }[] };
export type RatioChange = {
  /** Shot/recipe loads and explicitly supplied dose, yield or lock settings win over memory. */
  explicit?: boolean;
  /** The exact typed ratio, before the yield is rounded to a tenth of a gram. Implies explicit. */
  ratio?: number;
};
export type RatioMemoryOptions = {
  readWorkflow(): Promise<ObjectData>;
  /** Decaid's merge semantics; return the merged workflow, or null to read it again. */
  writeWorkflow(patch: ObjectData): Promise<ObjectData | null>;
  /** Return null only for a missing store key; other failures must reject. */
  readMemory(): Promise<unknown>;
  writeMemory(data: RatioMemoryData): Promise<void>;
  /** A stable coffee identity, not its display name; null when no coffee is selected. */
  coffeeKey(workflow: ObjectData): string | null | Promise<string | null>;
  profileKey?(workflow: ObjectData): string | null;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  return value;
}

/**
 * Workflow profiles have no stable record id: Decaid hashes include the mutable stop weight and temperature.
 * Keep their name and design, but not notes, stop weight or brew temperatures. Same-named different designs stay
 * separate. A consumer with a stable profile identity can supply its own profileKey instead.
 */
export function ratioProfileKey(workflow: ObjectData): string | null {
  const profile = optionalObject(workflow.profile);
  if (!text(profile.title) || !isBrew(shotKind(profile))) return null;
  const design = Object.fromEntries(Object.entries(profile).filter(([k]) => !["notes", "target_weight"].includes(k)));
  if (Array.isArray(design.steps)) design.steps = design.steps.map((step) =>
    Object.fromEntries(Object.entries(object(step)).filter(([k]) => k !== "temperature")));
  return JSON.stringify(canonical(design));
}

function merge(before: ObjectData, patch: ObjectData): ObjectData {
  const result = { ...before };
  for (const [k, v] of Object.entries(patch)) {
    result[k] = v && typeof v === "object" && !Array.isArray(v)
      ? merge(optionalObject(before[k]), object(v)) : v;
  }
  return result;
}
const close = (a: number, b: number) => Math.abs(a - b) < 0.05;
const validYield = (n: unknown): n is number => number(n) !== undefined && Number(n) > 0 && Number(n) <= 2000;
const validRatio = (n: unknown): n is number => number(n) !== undefined && Number(n) > 0;
const keyOf = (coffee: string, profile: string) => JSON.stringify([coffee, profile]);
type Seen = { coffee: string | null; profile: string | null; locked: boolean; kept: Kept | null };

/**
 * One runtime per plugin. All loads, skin calls and workflow events share its queue. Events are notifications, not
 * snapshots: follow() reads Decaid after earlier changes have finished, so delayed echoes cannot restore old targets.
 */
export function createRatioMemory(options: RatioMemoryOptions) {
  let entries: RatioMemoryData["entries"] | null = null;
  let dirty = false;
  let seen: Seen | null = null;
  let work = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = work.then(task);
    work = next.then(() => undefined, () => undefined);
    return next;
  }
  async function load() {
    if (entries) return;
    const raw = await options.readMemory();
    if (raw == null) { entries = []; return; }
    const data = object(raw);
    if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error("invalidData");
    const keys = new Set<string>();
    const parsed = data.entries.map((value) => {
      const row = object(value), choice = object(row.choice);
      const coffee = text(row.coffee), profile = text(row.profile), key = keyOf(coffee, profile);
      if (!coffee || !profile || keys.has(key)) throw new Error("invalidData");
      keys.add(key);
      let checked: RatioChoice;
      if (choice.locked === true && validRatio(choice.ratio)) checked = { locked: true, ratio: choice.ratio };
      else if (choice.locked === false && validYield(choice.yield)) checked = { locked: false, yield: choice.yield };
      else throw new Error("invalidData");
      return { coffee, profile, choice: checked };
    });
    entries = parsed;
  }
  async function save(now: Seen) {
    seen = now;
    if (now.coffee && now.profile && now.kept) {
      const choice: RatioChoice = now.locked ? { locked: true, ratio: now.kept.ratio } : { locked: false, yield: now.kept.yield };
      const at = entries!.findIndex((row) => row.coffee === now.coffee && row.profile === now.profile);
      if (at < 0 || JSON.stringify(entries![at].choice) !== JSON.stringify(choice)) {
        const row = { coffee: now.coffee, profile: now.profile, choice };
        if (at < 0) entries!.push(row);
        else entries![at] = row;
        dirty = true;
      }
    }
    if (dirty) {
      await options.writeMemory({ version: 1, entries: entries!.map((row) => ({ ...row, choice: { ...row.choice } })) });
      dirty = false;
    }
  }
  async function plan(workflow: ObjectData, change: RatioChange = {}, keepExact = false, profileLoad = false) {
    const context = optionalObject(workflow.context), profile = optionalObject(workflow.profile);
    const coffee = await options.coffeeKey(workflow);
    const profileKey = isBrew(shotKind(profile)) ? (options.profileKey ?? ratioProfileKey)(workflow) : null;
    const dose = number(context.targetDoseWeight), yieldG = number(context.targetYield);
    const locked = optionalObject(context.extras).lockRatio === true;
    const now: Seen = { coffee, profile: profileKey, locked, kept: null };
    let patch: ObjectData = {};
    if (!profileKey || !dose || dose <= 0 || !validYield(yieldG)) {
      if (change.ratio !== undefined) throw new Error("invalidArguments");
      return { now, patch };
    }
    const same = !!seen?.kept && seen.coffee === coffee && seen.profile === profileKey;
    const before = same ? seen?.kept : null;
    const explicit = change.explicit || change.ratio !== undefined;
    let target = yieldG, ratio = yieldG / dose;
    let nextLocked = locked;
    let replaced = before?.replaced && Date.now() - before.replaced.at < 10000 ? before.replaced : undefined;
    const saved = (!same || profileLoad) && !explicit && coffee
      ? entries!.find((row) => row.coffee === coffee && row.profile === profileKey)?.choice : undefined;
    if (change.ratio !== undefined) {
      if (!validRatio(change.ratio) || change.ratio < 0.5 || change.ratio > 20) throw new Error("invalidArguments");
      ratio = change.ratio;
      target = round1(dose * ratio);
    } else if (saved) {
      nextLocked = saved.locked;
      ratio = saved.locked ? saved.ratio : saved.yield / dose;
      target = saved.locked ? round1(dose * ratio) : saved.yield;
      replaced = undefined;
    } else if (before) {
      const sameNumbers = close(dose, before.dose) && close(yieldG, before.yield);
      const followed = Math.abs(yieldG - round1(dose * before.ratio)) < 0.06;
      const staleYield = close(yieldG, before.yield) || (!!replaced && close(yieldG, replaced.yield));
      if (!explicit && locked && !close(dose, before.dose) && staleYield) {
        ratio = before.ratio;
        target = round1(dose * ratio);
      } else if ((!explicit && (sameNumbers || locked && followed)) || (keepExact && sameNumbers)) ratio = before.ratio;
    } else if (!explicit && locked && seen?.kept && Math.abs(yieldG - round1(dose * seen.kept.ratio)) < 0.06) {
      // An unseen pair inherits the current settings, including precision hidden by rounded grams.
      ratio = seen.kept.ratio;
    }
    if (!validYield(target) || !validRatio(ratio)) throw new Error("invalidArguments");
    if (!close(target, yieldG)) {
      patch = { context: { targetYield: target }, profile: { target_weight: target } };
      replaced = saved || explicit ? undefined : { yield: yieldG, at: Date.now() };
    }
    if (saved && nextLocked !== locked) patch = merge(patch, { context: { extras: { lockRatio: nextLocked } } });
    // Restoration and explicit targets also repair a stale profile stop weight.
    if ((saved || explicit) && !close(number(profile.target_weight) ?? NaN, target)) patch = merge(patch, { profile: { target_weight: target } });
    now.locked = nextLocked;
    now.kept = { dose, yield: target, title: text(profile.title), ratio, replaced };
    return { now, patch };
  }
  async function write(patch: ObjectData) {
    return await options.writeWorkflow(patch) ?? await options.readWorkflow();
  }
  async function follow() {
    await load();
    for (let attempt = 0; attempt < 3; attempt++) {
      const workflow = await options.readWorkflow();
      const { now, patch } = await plan(workflow);
      let result = workflow;
      if (Object.keys(patch).length) {
        // Identity resolution may have awaited an adapter. Never apply its old choice to a newer workflow.
        if (JSON.stringify(await options.readWorkflow()) !== JSON.stringify(workflow)) continue;
        result = await write(patch);
      }
      await save(now);
      return result;
    }
    throw new Error("workflowChanged");
  }
  return {
    get kept(): Kept | null { return seen?.kept ?? null; },
    follow: () => serial(follow),
    change: (patch: ObjectData | ((workflow: ObjectData) => ObjectData), change: RatioChange = {}) => serial(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const workflow = await follow();
        const sent = typeof patch === "function" ? patch(workflow) : patch;
        const candidate = merge(workflow, sent);
        const context = optionalObject(sent.context);
        const keepExact = !("targetDoseWeight" in context) && !("targetYield" in context)
          && !("target_weight" in optionalObject(sent.profile));
        const { now, patch: target } = await plan(candidate, change, keepExact, "title" in optionalObject(sent.profile));
        if (JSON.stringify(await options.readWorkflow()) !== JSON.stringify(workflow)) continue;
        const result = await write(merge(sent, target));
        await save(now);
        return result;
      }
      throw new Error("workflowChanged");
    }),
  };
}
