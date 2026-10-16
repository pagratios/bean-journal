// Bean Journal's shot data: its own taste, body, water and notes block (under `extras.beanJournal`), and shots
// summarised for the page. Decaid's data guards, shot curves and profiles are the core's.
import { localId, number, optionalObject, tagChoice, tagIn, text, type ObjectData } from "./core/data";
import { BALANCES, BODIES, isBrew, shotCurves, shotKind, shotRpm, visualizerId } from "./core/shots";
import { designedProfile as coreDesignedProfile } from "./core/profiles";

export {
  object, optionalObject, items, text, number, localId, profileId, httpsUrl, originHost, unaccented, normTitle, type ObjectData,
} from "./core/data";
export { shotKind, isBrew, shotRpm, visualizerId, stepsFromTargets, shotText, BALANCES, BODIES, type ShotKind } from "./core/shots";
export { shiftedSteps, profileAt, editedProfile, profileExecution, BEVERAGES } from "./core/profiles";

/** The plugin's own data on a shot or the next shot (Decaid has no field for taste, body or water). */
export const tagOf = (holder: ObjectData) => tagIn(holder, "beanJournal");
/** The user's taste verdict kept on the shot: a value, null when cleared, undefined when never set. */
export const shotBalance = (annotations: ObjectData) => tagChoice(tagOf(annotations), "balance", BALANCES);
/** The cup's body as the plugin keeps it (thin, medium, heavy); null once cleared, undefined when never set. */
export const shotBodyLevel = (annotations: ObjectData) => tagChoice(tagOf(annotations), "body", BODIES);
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

/**
 * What the shot page shows: numbers, the coffee it was pulled with and light curves (at most `points` per series).
 * `coffeeId` is the shot's Decaid batch; `beanId` (that batch's bean) is filled in by the plugin, which knows the batches.
 */
export function shotSummary(shot: ObjectData, points = 240) {
  const workflow = optionalObject(shot.workflow);
  const context = optionalObject(workflow.context);
  const profile = optionalObject(workflow.profile);
  const annotations = optionalObject(shot.annotations);
  const { series, steps, duration, lastWeight } = shotCurves(shot, points);
  const enjoyment = number(annotations.enjoyment);
  return {
    id: localId(shot.id), timestamp: text(shot.timestamp), profile: text(profile.title),
    kind: shotKind(profile), brew: isBrew(shotKind(profile)),
    coffeeName: text(context.coffeeName), coffeeRoaster: text(context.coffeeRoaster),
    coffeeId: text(context.beanBatchId) || null, beanId: null as string | null,
    dose: number(annotations.actualDoseWeight) ?? number(context.targetDoseWeight) ?? null,
    yield: number(annotations.actualYield) ?? lastWeight ?? null,
    targetYield: number(context.targetYield) ?? null,
    duration,
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

/** A new assistant design (MCP create_profile), its dose kept in the profile's metadata. */
export function designedProfile(b: ObjectData) {
  const { profile, dose } = coreDesignedProfile(b);
  return { profile, metadata: { beanJournal: { madeBy: "assistant", ...(dose ? { dose } : {}) } } };
}
