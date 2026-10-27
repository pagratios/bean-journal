// Bean Journal's MCP server: AI assistants (Claude, Copilot…) reach the tablet at
// /api/v1/plugins/bean-journal.reaplugin/mcp with the token from the AI tab. The JSON-RPC server, access levels and
// confirmations are the core's; these are Bean Journal's tools, each one or more of the page's own actions.
import {
  mcpMessage as coreMessage, mcpToolList as coreToolList, mcpTokenPattern,
  type McpConfirm, type McpContext, type McpLevel, type McpSchema as Schema, type McpTool as Tool,
} from "./core/mcp";
import { BEVERAGES } from "./core/profiles";
import { BALANCES, BODIES } from "./core/shots";

export {
  MCP_BUDGET, MCP_CONFIRMS, MCP_LEVELS, MCP_PROTOCOLS, rateLimit, type McpConfirm, type McpContext, type McpLevel,
} from "./core/mcp";
export const MCP_TOKEN = mcpTokenPattern("bjm");

type ObjectData = Record<string, unknown>;
const isObject = (value: unknown): value is ObjectData => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value : "";
/** {} for nothing; anything but an object is refused, as the page's own reader does. */
function optionalObject(value: unknown): ObjectData {
  if (value == null) return {};
  if (!isObject(value)) throw new Error("invalidData");
  return value;
}

const id = (what: string): Schema => ({ type: "string", description: what });
const num = (min: number, max: number, description?: string): Schema => ({ type: "number", minimum: min, maximum: max, ...(description ? { description } : {}) });
/** The same field, where null clears it. */
const orNull = (schema: Schema): Schema => ({ ...schema, type: [schema.type, "null"] });
const shotId = id("The shot's Decaid id (get_shot, list_shots).");
const coffeeId = id("A coffee's id (list_coffees): one bag of a coffee.");
const profileId = id("A Decaid profile's id (list_profiles).");
const lockRatio: Schema = { type: "boolean", description: "Keeps the drink proportional to dose. Remembered per coffee/profile; explicit settings win." };
const water: Schema = { type: ["string", "null"], maxLength: 80, description: "The water, as free text (list_equipment has the recent ones); null: none." };
const filter: Record<string, Schema> = {
  coffee_name: { type: "string", description: "Only shots pulled with this coffee name." },
  coffee_roaster: { type: "string", description: "Only shots pulled with this roaster." },
  profile_title: { type: "string", description: "Only shots pulled with this profile title." },
};
const filterOf = (a: ObjectData) => ({ coffeeName: a.coffee_name, coffeeRoaster: a.coffee_roaster, profileTitle: a.profile_title });
const invalid = (): never => { throw new Error("invalidArguments"); };
/** The page's shot without its curves (240 points × 9 series), unless the assistant asks for them. */
const withoutCurves = (shot: unknown, a: ObjectData) => {
  if (a.include_curves === true || !isObject(shot)) return shot;
  const { series: _series, ...rest } = shot;
  void _series;
  return rest;
};
/** Answers that carry a shot as `shot` ({ shot }, { tds, shot }…). */
const shotAnswer = (r: unknown, a: ObjectData) => isObject(r) && isObject(r.shot) ? { ...r, shot: withoutCurves(r.shot, a) } : r;
const pick = (a: ObjectData, names: Record<string, string>) =>
  Object.fromEntries(Object.entries(names).filter(([from]) => from in a).map(([from, to]) => [to, a[from]]));
/** One step of a Decent profile (de1app / pyDE1 v2 JSON). */
const step: Schema = {
  type: "object", additionalProperties: false, required: ["name", "pump", "temperature", "seconds"],
  properties: {
    name: { type: "string", maxLength: 40 },
    pump: { type: "string", enum: ["pressure", "flow"], description: "What the step holds: pressure (bar) or flow (ml/s)." },
    pressure: num(0, 12, "Bar; the target with pump pressure."), flow: num(0, 15, "ml/s; the target with pump flow."),
    temperature: num(0, 105, "°C"), seconds: num(0, 127, "Longest the step lasts."),
    transition: { type: "string", enum: ["fast", "smooth"] }, sensor: { type: "string", enum: ["coffee", "water"] },
    volume: num(0, 2000, "Ends the step after this much water (ml); 0: no limit."),
    weight: num(0, 2000, "Ends the step at this weight in the cup (g); 0: no limit."),
    exit: { type: ["object", "null"], additionalProperties: false, required: ["type", "condition", "value"], description: "Moves on early when pressure or flow goes over/under a value; null: off. Flow at most 8; pressure at most 12.",
      properties: { type: { type: "string", enum: ["pressure", "flow"] }, condition: { type: "string", enum: ["over", "under"] }, value: num(0, 12) } },
    limiter: { type: ["object", "null"], additionalProperties: false, required: ["value"], description: "Caps flow (at most 8) on a pressure step, or pressure (at most 12) on a flow step; null: off.",
      properties: { value: num(0, 12), range: num(0, 10) } },
  },
};
const profileFields: Record<string, Schema> = {
  title: { type: "string", minLength: 1, maxLength: 120 }, author: { type: "string", maxLength: 120 },
  notes: { type: "string", maxLength: 10000 },
  beverage_type: { type: "string", enum: [...BEVERAGES], description: "The beverage category, not the legacy JSON format's type field." },
  steps: { type: "array", minItems: 1, maxItems: 20, items: step, description: "The whole step list, in order; replaces the saved list." },
  target_weight: num(0, 2000, "Stop at this weight in the cup (g); 0: none."),
  target_volume: num(0, 2000, "Stop after this much water (ml) when there is no scale; 0: none."),
  tank_temperature: num(0, 110, "Water tank temperature (°C); 0: the machine's default."),
  target_volume_count_start: { type: "integer", minimum: 0, maximum: 20, description: "1-based step after which volume counting starts; 0: from the start. At most the step count." },
};
const profileNames = {
  title: "title", author: "author", notes: "notes", beverage_type: "beverageType", steps: "steps", target_weight: "targetWeight",
  target_volume: "targetVolume", tank_temperature: "tankTemperature", target_volume_count_start: "volumeCountStart", dose: "dose",
};
const day: Schema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "YYYY-MM-DD." };
/** A coffee (Decaid's bean, shared by its bags) and its bag (Decaid's batch), as the page's add and edit form has them. */
const coffeeFields: Record<string, Schema> = {
  roaster: { type: "string", minLength: 1, maxLength: 120 }, name: { type: "string", minLength: 1, maxLength: 120 },
  country: { type: "string", maxLength: 80 }, region: { type: "string", maxLength: 120 },
  producer: { type: "string", maxLength: 120 }, farm: { type: "string", maxLength: 120 },
  varieties: { type: "array", maxItems: 10, items: { type: "string", maxLength: 60 }, description: "e.g. [\"SL28\", \"SL34\"]." },
  altitude: { type: "array", maxItems: 2, items: { type: "integer", minimum: 0, maximum: 6000 }, description: "Metres: [1900], or a range [1700, 2100]." },
  process: { type: "string", maxLength: 80, description: "e.g. Washed, Natural, Honey." }, decaf: { type: "boolean" },
  species: { type: "string", maxLength: 80, description: "e.g. Arabica, Robusta." },
  decaf_process: { type: "string", maxLength: 80, description: "e.g. Sugarcane EA, Swiss Water." },
  tasting_notes: { type: "string", maxLength: 1000, description: "The roaster's tasting notes." },
  link: { type: "string", maxLength: 500, description: "The roaster's page for it (https)." },
  photo: { type: "string", maxLength: 600000, description: "An https image URL, shown from the web (e.g. the roaster's product photo), or a data:image/…;base64 URL." },
  roast_date: day, roast_level: { type: "string", maxLength: 40, description: "e.g. Light, Medium." },
  harvest_date: { type: "string", maxLength: 40, description: "As the roaster gives it, e.g. 2025 or Nov 2025 - Jan 2026." },
  quality_score: num(0, 100, "The cupping (SCA) score."),
  price: num(0, 1000000, "What the bag cost, in currency."), currency: { type: "string", maxLength: 10, description: "e.g. EUR." },
  buy_date: day,
  weight: num(0, 20000, "Grams in the bag as bought."),
  remaining: num(0, 20000, "Grams left; a new bag with weight and no remaining starts full."),
  frozen: { type: "boolean", description: "Whole bag frozen. Changes use today; refreezing keeps earlier freezer days and clears the old thaw date." },
  open_date: day, best_before: day,
  bag_notes: { type: "string", maxLength: 2000, description: "Notes about this bag." },
};
const coffeeNames = {
  roaster: "roaster", name: "name", country: "country", region: "region", producer: "producer", farm: "farm", varieties: "varieties",
  altitude: "altitude", process: "process", decaf: "decaf", species: "species", decaf_process: "decafProcess", tasting_notes: "tastingNotes",
  link: "link", roast_date: "roastDate", roast_level: "roastLevel", harvest_date: "harvestDate", quality_score: "qualityScore", price: "price",
  currency: "currency", buy_date: "buyDate", weight: "weight", remaining: "remaining", frozen: "frozen", open_date: "openDate", best_before: "bestBefore",
  bag_notes: "bagNotes", finished: "finished", freeze_date: "freezeDate", thaw_date: "thawDate",
};
/** The photo goes beside the fields: the page sets it apart, an assistant with the rest. */
const withPhoto = (a: ObjectData) => "photo" in a ? { photo: a.photo } : {};
/** Decaid refuses null for these: they can change but not be cleared. */
const notNullable = ["roaster", "name", "decaf", "frozen", "finished"];
const coffeeEdits: Record<string, Schema> = Object.fromEntries(Object.entries({
  ...coffeeFields,
  finished: { type: "boolean", description: "The bag is used up: it moves to the end of the list, its shots stay." },
  freeze_date: day, thaw_date: day,
}).map(([k, s]) => [k, notNullable.includes(k) ? s : orNull(s)]));
const coffeeOnly = (r: unknown) => isObject(r) ? Object.fromEntries(["coffee", "duplicates"].filter((k) => k in r).map((k) => [k, r[k]])) : r;

export const MCP_TOOLS: Tool[] = [
  // ── Read only ──
  { name: "get_status", level: "read", kind: "read", title: "Plugin status and next shot",
    description: "Bean Journal on the Decent's tablet: the coffee chosen for the next shot (null: none, with the names Streamline shows) with its dose and yield; `next`: the grinder, RPM, grind, water and lockRatio (Keep ratio in Streamline) of the next shot; the coffee-choice preference and the AI access levels.",
    call: () => ({ action: "status" }) },
  { name: "get_dial_in_context", level: "read", kind: "read", title: "Everything to dial in",
    description: "One call with what dialling in a coffee needs: the coffee for the next shot and its bag (origin, process, roast date, frozen, restingDays excluding freezer time, grams left) and its recent shots (numbers, score, taste, body, grind, water). Start here; coffee_id for another coffee.",
    properties: { coffee_id: { ...coffeeId, description: "Another coffee than the one chosen for the next shot." } },
    call: (a) => ({ action: "dial-in", body: { coffeeId: a.coffee_id } }) },
  { name: "list_coffees", level: "read", kind: "read", title: "Coffees",
    description: "Coffees on this tablet, one per bag: identity, origin/process/varieties/species, roast/harvest dates and level, tasting notes, score, price, grams left, frozen/opened and photo. restingDays excludes freezer time (null if unknown); pastFrozenDays is earlier freezer time. No-bag ids start with \"bean:\". history reports source/stale/refreshing/error: saved or provisional order is not freshly validated. Report errors; retry_history retries in the background.",
    properties: { include_finished: { type: "boolean", description: "Also the finished bags." },
      retry_history: { type: "boolean", description: "Retry failed background brew-order validation." } },
    call: (a) => ({ action: "coffees", body: { includeFinished: a.include_finished === true,
      ...(a.retry_history === true ? { retryHistory: true } : {}) } }) },
  { name: "get_shot", level: "read", kind: "read", title: "One shot",
    description: "One shot from the Decent's history: profile, coffee, dose, yield, time, grind, grinder, RPM, water, score, taste, body, notes, TDS/EY, the profile's steps and visualizerId (on visualizer.coffee/shots/<id> once Decaid's Visualizer plugin uploaded it). By shot_id, else the newest (offset 0) or an older one, optionally of one coffee and/or profile.",
    properties: {
      shot_id: shotId, offset: { type: "integer", minimum: 0, description: "0: the newest shot; 1: the one before…" }, ...filter,
      include_curves: { type: "boolean", description: "Also the curves: pressure, flow, weight, temperature and targets, 240 points." },
    },
    call: (a) => a.shot_id != null ? { action: "shot-by-id", body: { shotId: a.shot_id } } : { action: "shot", body: { offset: a.offset ?? 0, filter: filterOf(a) } },
    shape: shotAnswer },
  { name: "list_shots", level: "read", kind: "read", title: "Recent shots",
    description: "The 30 newest shots, short (no curves), optionally of one coffee and/or profile.",
    properties: { ...filter }, call: (a) => ({ action: "shots", body: { filter: filterOf(a) } }) },
  { name: "list_profiles", level: "read", kind: "read", title: "Profiles",
    description: "The Decent profiles on the tablet (id, title, author, kind, who made it). With profile_id: that profile's whole design, its steps (pump, pressure, flow, temperature, time, exits, limits), target weight and notes; a start for create_profile.",
    properties: { profile_id: { ...profileId, description: "One profile's whole design." } },
    call: (a) => a.profile_id != null ? { action: "profile", body: { profileId: a.profile_id } } : { action: "profiles" } },
  { name: "list_equipment", level: "read", kind: "read", title: "Grinders and waters",
    description: "The user's gear on the tablet. `grinders`: Decaid's grinders (id: the grinder_id other tools take; model; settingType numeric or preset with settingValues; step sizes). `waters`: the waters typed for recent shots, newest first (free text).",
    call: () => ({ action: "equipment" }) },
  { name: "get_preferences", level: "read", kind: "read", title: "Preferences",
    description: "onCoffeeChoice: what choosing a coffee on the page does (keep the current settings, or load the coffee's last or best shot). visualizerNotes: new shots' notes get a Bean Journal block (taste, body, water, RPM) that Visualizer shows. No tokens or access settings.",
    call: () => ({ action: "preferences" }) },
  { name: "get_refractometer", level: "read", kind: "read", title: "Refractometer",
    description: "The tablet's TDS sensors that support a single measurement, a DiFluid R2 first. No scan or measurement runs.",
    call: () => ({ action: "refractometer" }) },
  // ── Shots and coffee ──
  { name: "rate_shot", level: "shots", kind: "edit", title: "Rate or correct a shot",
    description: "Saves a shot's score, taste, body, notes, TDS/EY, dose, yield, grind, grinder, RPM, water or coffee on the tablet. Only the fields given change; null clears one.",
    properties: {
      shot_id: shotId,
      score: { type: ["integer", "null"], minimum: 0, maximum: 100 },
      balance: { type: ["string", "null"], enum: [...BALANCES, null] },
      body: { type: ["string", "null"], enum: [...BODIES, null] },
      notes: { type: "string", maxLength: 10000, description: "The user's notes; a Bean Journal block in them is kept apart and stays." },
      tds: { type: ["number", "null"], minimum: 0, maximum: 30, description: "Refractometer reading, %." },
      ey: { type: ["number", "null"], minimum: 0, maximum: 100, description: "Extraction yield, %." },
      dose: { type: "number", exclusiveMinimum: 0, maximum: 200, description: "Grams of coffee." },
      yield: { type: "number", exclusiveMinimum: 0, maximum: 2000, description: "Grams in the cup." },
      grind: { type: ["string", "null"], maxLength: 60 },
      grinder_id: { type: ["string", "null"], description: "A grinder's id (list_equipment)." },
      grinder_model: { type: ["string", "null"], maxLength: 80, description: "A grinder by name, when it isn't one of list_equipment's." },
      rpm: { type: ["integer", "null"], minimum: 0, maximum: 5000 },
      water,
      coffee_id: { type: ["string", "null"], description: "The coffee it was pulled with (list_coffees); null: none." },
    },
    required: ["shot_id"],
    call: (a) => {
      const fields = pick(a, {
        score: "score", balance: "balance", body: "body", notes: "notes", tds: "tds", ey: "ey", dose: "dose", yield: "yield",
        grind: "grind", grinder_id: "grinderId", grinder_model: "grinderModel", rpm: "rpm", water: "water",
      });
      const coffee = a.coffee_id !== undefined;
      return [
        ...(coffee ? [{ action: "assign-coffee", body: { shotId: a.shot_id, coffeeId: a.coffee_id } }] : []),
        // Nothing to save at all: the page's own refusal.
        ...(Object.keys(fields).length || !coffee ? [{ action: "rate-shot", body: { shotId: a.shot_id, ...fields } }] : []),
      ];
    },
    shape: shotAnswer },
  { name: "delete_shot", level: "shots", kind: "edit", alwaysConfirm: true, title: "Delete a shot",
    description: "Permanently removes a shot from the tablet's history; it cannot be undone. Always asks first.",
    properties: { shot_id: shotId }, required: ["shot_id"],
    call: (a) => ({ action: "delete-shot", body: { shotId: a.shot_id, confirmed: true } }) },
  { name: "measure_tds", level: "shots", kind: "edit", title: "Measure TDS",
    description: "Runs one refractometer measurement (at most 30 seconds), with an R2 preferred. Returns TDS %. With shot_id, saves that reading on the shot. Without shot_id, no shot changes.",
    properties: { sensor_id: id("One of get_refractometer's sensor ids; omitted: the preferred sensor."), shot_id: shotId },
    call: (a) => ({ action: "measure-tds", body: { sensorId: a.sensor_id, shotId: a.shot_id } }),
    shape: shotAnswer },
  { name: "set_next_shot", level: "shots", kind: "edit", title: "Next shot",
    description: "Sets the next shots' coffee (coffee_id), grinder, RPM, grind, water and/or lock_ratio (Keep ratio in Streamline). Choosing a coffee restores its remembered ratio mode/target for this profile; unseen pairs keep current settings. An explicit lock_ratio wins and keeps the current yield. Other fields stay; null clears one (not lock_ratio). Refused while a shot runs.",
    properties: {
      coffee_id: { type: ["string", "null"], description: "The coffee the next shots are pulled with (list_coffees); null: none." },
      grinder_id: { type: ["string", "null"], description: "A grinder's id (list_equipment); null: none." },
      grinder_model: { type: ["string", "null"], maxLength: 80, description: "A grinder by name, when it isn't one of list_equipment's." },
      rpm: { type: ["integer", "null"], minimum: 1, maximum: 5000 },
      grind: { type: ["string", "null"], maxLength: 60 },
      water,
      lock_ratio: lockRatio,
    },
    call: (a) => {
      return { action: "next-settings", body: pick(a, { coffee_id: "coffeeId", grinder_id: "grinderId", grinder_model: "grinderModel",
        rpm: "rpm", grind: "grind", water: "water", lock_ratio: "lockRatio" }) };
    } },
  { name: "add_coffee", level: "shots", kind: "edit", title: "Add a coffee",
    description: "Adds a coffee and its bag to the tablet, as the page's Add coffee form does. When a coffee with this roaster and name is there already, nothing is saved and `duplicates` lists its bags: ask the user, then add_to_coffee_id (a new bag of that coffee) or save_new.",
    properties: {
      ...coffeeFields,
      add_to_coffee_id: id("Add this bag to that coffee (one of `duplicates`) instead of a new coffee."),
      save_new: { type: "boolean", description: "Save a separate coffee even though one has this roaster and name." },
    },
    required: ["roaster", "name"],
    call: (a) => {
      const fields = pick(a, coffeeNames);
      if (a.add_to_coffee_id != null && a.save_new === true) invalid();
      if (a.add_to_coffee_id == null) return { action: "save-coffee", body: { fields, ...withPhoto(a), ...(a.save_new === true ? { saveNew: true } : {}) } };
      // The page adds to a bean (all of a coffee's bags share one); the assistant knows the bag it was shown.
      return [{ action: "coffee", body: { id: a.add_to_coffee_id } }, { action: "save-coffee", body: (found) => {
        const beanId = text(optionalObject(found.coffee).beanId);
        return beanId ? { fields, ...withPhoto(a), addToBeanId: beanId } : invalid();
      } }];
    },
    shape: coffeeOnly },
  { name: "update_coffee", level: "shots", kind: "edit", title: "Edit a coffee or its bag",
    description: "Edits a coffee (coffee_id from list_coffees). Coffee fields (roaster to photo) change it for all its bags; bag fields (roast_date on) change this bag. Only the fields given change; null clears one. finished: the bag is used up.",
    properties: { coffee_id: coffeeId, ...coffeeEdits },
    required: ["coffee_id"],
    call: (a) => ({ action: "save-coffee", body: { id: a.coffee_id, fields: pick(a, coffeeNames), ...withPhoto(a) } }),
    shape: coffeeOnly },
  // ── Everything: profiles and the machine ──
  { name: "create_profile", level: "full", kind: "machine", title: "Design a profile",
    description: "Saves a new Decent profile of your design on the tablet, titled \"AI / <title>\". Answers `duplicates` when a profile has that title: ask the user, then save_new or replace_profile_id (only AI-made ones). An identical design already there is answered as `existing`, unchanged. Doesn't load it: load_profile does.",
    properties: {
      ...profileFields, title: { type: "string", minLength: 1, maxLength: 60 },
      beverage_type: { ...profileFields.beverage_type, description: "Default espresso. Supports all eight Decaid beverage categories." },
      dose: num(1, 100, "The dose (g) it is meant for; load_profile uses it."),
      save_new: { type: "boolean", description: "Save it even though a profile has this title." },
      replace_profile_id: id("Replace this AI-made profile (one of `duplicates`) with the new design."),
    },
    required: ["title", "steps"],
    call: (a) => ({ action: "create-profile", body: { ...pick(a, {
      ...profileNames, save_new: "saveNew", replace_profile_id: "replaceProfileId",
    }) } }) },
  { name: "update_profile", level: "full", kind: "machine", title: "Edit a saved profile",
    description: "Edits any saved profile's named fields; omitted fields stay. Read list_profiles with profile_id first and pass updatedAt. Design changes save a child revision and keep the original hidden (defaults stay visible); title/author/notes update in place on user profiles. Doesn't load. Title collisions return duplicates; ask before save_new. An identical design returns existing, unchanged.",
    properties: {
      profile_id: profileId, expected_updated_at: id("The updatedAt just read with list_profiles(profile_id); changed profiles are refused."),
      ...profileFields, dose: { ...num(1, 100), type: ["number", "null"], description: "Dose for loading (g); null clears the saved dose." },
      save_new: { type: "boolean", description: "Allow a title already in use, after asking the user." },
    },
    required: ["profile_id", "expected_updated_at"],
    call: (a) => ({ action: "update-profile", body: { profileId: a.profile_id, expectedUpdatedAt: a.expected_updated_at,
      ...pick(a, { ...profileNames, save_new: "saveNew" }) } }) },
  { name: "update_preferences", level: "full", kind: "machine", title: "Change preferences",
    description: "Changes only the named preferences: what choosing a coffee on the page does, and the Bean Journal block in shot notes. No tokens, access levels or confirmation settings can be changed. Decaid reloads the plugin after saving.",
    properties: {
      on_coffee_choice: { type: "string", enum: ["keep", "last", "best"], description: "Keep settings, or load the coffee's last/best shot when choosing it on the page." },
      visualizer_notes: { type: "boolean", description: "Add taste, body, water and RPM to new shots' notes, for Visualizer. Off leaves existing notes alone." },
    },
    call: (a) => {
      const changes = pick(a, { on_coffee_choice: "onCoffeeChoice", visualizer_notes: "visualizerNotes" });
      return Object.keys(changes).length ? { action: "update-preferences", body: changes } : invalid();
    } },
  { name: "search_refractometer", level: "full", kind: "machine", title: "Search for a refractometer",
    description: "Runs the page's full Bluetooth discovery-only scan while the machine is idle, then lists TDS sensors. Never requests a device connection.",
    call: () => ({ action: "search-refractometer" }) },
  { name: "choose_coffee", level: "full", kind: "machine", title: "Choose coffee with settings",
    description: "Chooses a coffee for the next shot. Keep restores this coffee/profile's remembered ratio mode/target, keeping other settings; unseen pairs keep current settings. Last/best loads the shot's explicit settings instead of memory. Best falls back to last if none is rated. No shot: uses Keep. Never starts a shot. set_next_shot at Shots and coffee can choose a coffee without loading.",
    properties: { coffee_id: coffeeId, settings: { type: "string", enum: ["keep", "last", "best"], description: "Omitted: the saved coffee-choice preference." } },
    required: ["coffee_id"], call: (a) => ({ action: "choose-coffee", body: { coffeeId: a.coffee_id, settings: a.settings } }) },
  { name: "load_profile", level: "full", kind: "machine", title: "Load a profile on the machine",
    description: "Loads a saved profile for the next run; never starts it, and the machine must be idle. Without explicit dose/yield/ratio/lock_ratio, restores the coffee/profile's remembered ratio mode/target (unseen pairs use saved/current numbers). Explicit settings win and update memory. Other brew settings: temperature, grind and optional coffee/grinder/RPM/water. Cleaning/calibration profiles accept only temperature. The saved profile stays unchanged.",
    properties: {
      profile_id: profileId, dose: num(1, 100, "Grams of coffee."), yield: num(1, 2000, "Grams in the cup to stop at."),
      ratio: num(0.5, 20, "Instead of yield: grams in the cup per gram of coffee (2 = 1:2)."),
      lock_ratio: lockRatio,
      temperature: num(70, 100, "°C of the first step; the other steps move as much."),
      grind: { type: "string", maxLength: 60 }, coffee_id: { ...coffeeId, description: "Also choose this coffee for the next shot." },
      grinder_id: { type: ["string", "null"], description: "A grinder's id (list_equipment) for the next shot; null: none." },
      grinder_model: { type: ["string", "null"], maxLength: 80, description: "A grinder by name, when it isn't one of list_equipment's." },
      rpm: { type: ["integer", "null"], minimum: 1, maximum: 5000, description: "The grinder's speed for the next shot; null: none." },
      water,
    },
    required: ["profile_id"],
    call: (a) => ({ action: "load-profile", body: { profileId: a.profile_id, ...pick(a, { dose: "dose", yield: "yield", ratio: "ratio", lock_ratio: "lockRatio", temperature: "temperature", grind: "grind", coffee_id: "coffeeId", grinder_id: "grinderId", grinder_model: "grinderModel", rpm: "rpm", water: "water" }), confirmed: true } }) },
  { name: "load_shot_settings", level: "full", kind: "machine", title: "Load a shot's settings",
    description: "Loads a shot's profile as it ran, its dose, stop weight, ratio lock when recorded, grinder, speed, grind and water for the next shot, optionally with a coffee. These explicit settings win over and update the coffee/profile's memory. Never starts a shot; the machine must be idle.",
    properties: { shot_id: shotId, coffee_id: { ...coffeeId, description: "Also choose this coffee for the next shot." } }, required: ["shot_id"],
    call: (a) => ({ action: "load-shot", body: { shotId: a.shot_id, coffeeId: a.coffee_id } }) },
];

export function mcpToolList(level: McpLevel, confirm: McpConfirm = "changes") {
  return coreToolList(MCP_TOOLS, level, confirm);
}

const SERVER = { name: "bean-journal", title: "Bean Journal on the Decent", tools: MCP_TOOLS };
/** One JSON-RPC message in, its answer out (null for a notification, which gets none). */
export function mcpMessage(message: unknown, ctx: McpContext) {
  return coreMessage(message, SERVER, ctx);
}
