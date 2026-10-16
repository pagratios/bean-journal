// Local preview: a fake Decaid (port 8080) that runs the built bean-journal.reaplugin as Decaid does, with sample
// coffees, grinders and shots, and serves a stock Streamline checkout (port 3000) to try the plugin's surfaces.
// Run: npm run build, then node tools/preview-server.mjs, with SKIN=<a decentespresso/streamline-js checkout> for the
// skin (PowerShell: $env:SKIN = "C:\path\to\streamline-js"). R2=0 leaves the refractometer out, R2=fail makes it fail,
// SCALE=0 leaves the scale out. Everything lives in memory: a restart starts from the samples again.
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, watchFile } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";

const ID = "bean-journal.reaplugin";
const DECAID_PORT = 8080, SKIN_PORT = 3000;
const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "..", "build", ID);
const PLUGIN_JS = join(BUILD, "plugin.js"), MANIFEST = join(BUILD, "manifest.json");
const SKIN = process.env.SKIN ? resolve(process.env.SKIN) : null;
if (!existsSync(PLUGIN_JS) || !existsSync(MANIFEST)) {
  console.error(`No build in ${BUILD}: run npm run build first.`);
  process.exit(1);
}
if (SKIN && !existsSync(join(SKIN, "index.html"))) {
  console.error(`SKIN=${SKIN} has no index.html: point it at a Streamline checkout (decentespresso/streamline-js).`);
  process.exit(1);
}
const manifest = () => JSON.parse(readFileSync(MANIFEST, "utf8"));

// ── Small helpers ──
const NOW = Date.now(), DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
/** A Decaid date field as Dart writes a local midnight back: "YYYY-MM-DDT00:00:00.000". */
const daysAgo = (n) => `${iso(NOW - n * DAY).slice(0, 10)}T00:00:00.000`;
/** Fixed, valid v4 UUIDs for the samples, so links between them read easily. */
const uid = (kind, n) => `${kind}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
/** Dart's toJson leaves null fields out. */
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const fail = (status, error) => Object.assign(new Error(error), { status });
/** Decaid's deep merge (shots and workflow): objects merge key by key, anything else (null too) replaces. */
function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObject(v) && isObject(out[k]) ? deepMerge(out[k], v) : v;
  return out;
}
const DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
/** Dart's DateTime.parse: a bare date becomes local midnight; anything else unparsable is a 400. */
function decaidDate(value, key) {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string" || !DATE.test(value) || Number.isNaN(Date.parse(value.slice(0, 10)))) throw fail(400, `FormatException: Invalid date format for ${key}: ${value}`);
  return value.length === 10 ? `${value}T00:00:00.000` : value;
}
function rejectNulls(body, keys) {
  for (const k of keys) if (k in body && body[k] === null) throw fail(400, `Field "${k}" must not be null`);
}
const svgPhoto = (from, to, label) => "data:image/svg+xml;base64," + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="800" viewBox="0 0 640 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="640" height="800" fill="url(#g)"/><rect x="150" y="170" width="340" height="460" rx="28" fill="#fff" opacity=".9"/><text x="320" y="420" font-family="sans-serif" font-size="44" font-weight="700" fill="#333" text-anchor="middle">${label}</text></svg>`,
).toString("base64");

// ── Decaid's data: beans and their batches (Bean Journal's coffees and bags) ──
const beans = [], batches = [];
const kv = new Map();
const kvSpace = (ns) => kv.get(ns) ?? kv.set(ns, new Map()).get(ns);
function sampleBean(n, bean, ...bags) {
  const createdAt = iso(NOW - (90 - n * 6) * DAY);
  const b = compact({ id: uid("b", n), decaf: false, archived: false, createdAt, updatedAt: createdAt, ...bean });
  beans.push(b);
  bags.forEach((bag, i) => {
    const made = iso(Date.parse(createdAt) + i * 30 * DAY);
    batches.push(compact({ id: uid("c", n * 10 + i), beanId: b.id, frozen: false, archived: false, createdAt: made, updatedAt: made, ...bag }));
  });
  return b;
}
const photo = (bean, from, to, label) => {
  const stamp = iso(NOW - 7 * DAY);
  bean.extras = { ...bean.extras, beanJournal: { ...bean.extras?.beanJournal, photo: stamp } };
  kvSpace("beanJournal-photos").set(bean.id, svgPhoto(from, to, label));
};
const kiambu = sampleBean(1, {
  roaster: "Taf Coffee", name: "Kiambu AA", country: "Kenya", region: "Kiambu", producer: "Kiambu Farmers' Cooperative",
  variety: ["SL28", "SL34"], altitude: [1700, 1900], processing: "Washed", notes: "Blackcurrant, grapefruit, brown sugar",
  extras: { beanJournal: { farm: "Gatomboya", link: "https://example.com/coffee/kiambu-aa" } },
}, { roastDate: daysAgo(12), roastLevel: "Light", weight: 250, weightRemaining: 182, openDate: daysAgo(8), bestBeforeDate: daysAgo(-170) });
photo(kiambu, "#7a1f3d", "#e0a96d", "Kiambu AA");
sampleBean(2, {
  roaster: "The Underdog", name: "Huila Pink Bourbon", country: "Colombia", region: "Huila", producer: "Finca El Diviso",
  variety: ["Pink Bourbon"], altitude: [1700, 1800], processing: "Natural", notes: "Strawberry, cacao nibs, jasmine",
}, { roastDate: daysAgo(26), roastLevel: "Medium-light", weight: 250, weightRemaining: 240, frozen: true, freezeDate: daysAgo(22), notes: "Split into two jars; one in the freezer" });
const guji = sampleBean(3, {
  roaster: "Coffee Island", name: "Guji Hambela", country: "Ethiopia", region: "Guji", producer: "Hambela Wamena smallholders",
  variety: ["Heirloom"], altitude: [2000, 2200], processing: "Washed", notes: "Peach, bergamot, honey",
  extras: { beanJournal: { link: "https://example.com/coffee/guji-hambela" } },
}, { roastDate: daysAgo(80), roastLevel: "Light", weight: 200, weightRemaining: 0, openDate: daysAgo(75), archived: true },
{ roastDate: daysAgo(30), roastLevel: "Light", weight: 200, weightRemaining: 64, openDate: daysAgo(25) });
photo(guji, "#2f5d50", "#f3c969", "Guji");
sampleBean(4, {
  roaster: "Friedhats", name: "Myanmar Hopong Long Hay", country: "Myanmar", region: "Shan State", producer: "Long Hay village",
  variety: ["Catuai", "Catimor"], altitude: [1200, 1300], processing: "Natural", notes: "Rum raisin, plum, cacao",
}, { roastDate: daysAgo(64), roastLevel: "Light", weight: 250, weightRemaining: 0, openDate: daysAgo(58), archived: true });
// Most of the tablet's batches have no batch-level weight (imports, quick adds): one like them.
sampleBean(5, {
  roaster: "Square Mile", name: "Red Brick", variety: ["Bourbon", "Catuai", "Heirloom"], processing: "Washed and natural",
  notes: "Dark chocolate, cherry, brown sugar",
}, { roastDate: daysAgo(18), roastLevel: "Medium" });
sampleBean(6, {
  roaster: "La Cabra", name: "Gakenke", country: "Rwanda", region: "Northern Province", producer: "Gakenke washing station",
  variety: ["Red Bourbon"], altitude: [1800, 2000], processing: "Washed", notes: "Black tea, red apple, honeysuckle",
}, { roastDate: daysAgo(5), roastLevel: "Light", weight: 250, weightRemaining: 250, bestBeforeDate: daysAgo(-175) });
// Beans without any batch, as de1app and Visualizer imports leave them.
sampleBean(7, { roaster: "Local Roaster", name: "Santos Espresso", country: "Brazil", region: "Sul de Minas", processing: "Pulped natural", notes: "Hazelnut, milk chocolate" });
sampleBean(8, { roaster: "Dak Coffee Roasters", name: "Decaf El Carmen", country: "Colombia", region: "Huila", decaf: true, decafProcess: "Sugarcane EA", processing: "Washed", notes: "Caramel, red apple" });
const bag = (n, i = 0) => batches.find((b) => b.id === uid("c", n * 10 + i));

const grinders = [
  { id: uid("d", 1), model: "Lagom P64", burrs: "SSP High Uniformity", burrSize: 64, burrType: "flat", settingType: "numeric", settingSmallStep: 0.1, settingBigStep: 1, rpmSmallStep: 50, rpmBigStep: 200 },
  { id: uid("d", 2), model: "Niche Zero", burrs: "Stock 63 mm", burrSize: 63, burrType: "conical", settingType: "numeric", settingSmallStep: 1, settingBigStep: 5 },
  { id: uid("d", 3), model: "Hand grinder", settingType: "preset", settingValues: ["Fine", "Medium-fine", "Medium", "Coarse"] },
  { id: uid("d", 4), model: "Baratza Sette 270", settingType: "numeric", settingSmallStep: 1, archived: true },
].map((g) => ({ archived: false, createdAt: iso(NOW - 200 * DAY), updatedAt: iso(NOW - 200 * DAY), ...g }));

kvSpace("streamlineSettings").set("theme", "light");
kvSpace("beanJournal").set("waters", ["Lotus Light Roast", "Volvic", "Third Wave Water espresso"]);

// ── Profiles ──
const step = (s) => ({ transition: "fast", sensor: "coffee", volume: 0, weight: 0, ...s });
const blooming = { version: "2", title: "Blooming espresso", author: "Decent", notes: "A long bloom, then a pour held at 6 bar.", beverage_type: "espresso",
  target_weight: 36, target_volume: 0, target_volume_count_start: 2, tank_temperature: 0, steps: [
    step({ name: "fill", pump: "flow", flow: 4, temperature: 92, seconds: 12, exit: { type: "pressure", condition: "over", value: 3 } }),
    step({ name: "bloom", pump: "flow", flow: 0, temperature: 92, seconds: 30 }),
    step({ name: "pour", pump: "pressure", pressure: 6, temperature: 92, seconds: 60, transition: "smooth", limiter: { value: 3.5, range: 0.6 } }),
  ] };
const turbo = { version: "2", title: "Turbo shot", author: "Bean Journal preview", notes: "Coarse, fast, 1:2.5.", beverage_type: "espresso",
  target_weight: 45, target_volume: 0, target_volume_count_start: 0, tank_temperature: 0, steps: [
    step({ name: "preinfusion", pump: "flow", flow: 6, temperature: 93, seconds: 8, exit: { type: "pressure", condition: "over", value: 4 } }),
    step({ name: "pour", pump: "pressure", pressure: 6, temperature: 93, seconds: 30, limiter: { value: 4.5, range: 0.6 } }),
  ] };
const flush = { version: "2", title: "Cleaning forward flush", author: "Decent", notes: "", beverage_type: "cleaning",
  target_weight: 0, target_volume: 0, target_volume_count_start: 0, tank_temperature: 0, steps: [
    step({ name: "flush", pump: "flow", flow: 6, temperature: 90, seconds: 10, sensor: "water" }),
  ] };
/** Decaid's content id: a hash of what the machine runs, not of its name or notes. */
function profileId(profile) {
  const execution = Object.fromEntries(Object.entries(profile).filter(([k]) => !["title", "author", "notes", "type", "legacy_profile_type"].includes(k)).sort(([a], [b]) => a.localeCompare(b)));
  return `profile:${createHash("sha256").update(JSON.stringify(execution)).digest("hex").slice(0, 20)}`;
}
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
function profileRecord(profile, over = {}) {
  const at = iso(NOW - 100 * DAY);
  const meta = hash([profile.title, profile.author, profile.notes]);
  return { id: profileId(profile), profile, metadataHash: meta, compoundHash: hash([profileId(profile), meta]), parentId: null,
    visibility: "visible", isDefault: false, createdAt: at, updatedAt: at, ...over };
}
const profiles = new Map([profileRecord(blooming, { isDefault: true }), profileRecord(turbo), profileRecord(flush, { isDefault: true })].map((p) => [p.id, p]));

// ── The workflow (the next shot) ──
let workflow = {
  id: "preview-workflow", name: "Espresso", description: "", profile: blooming,
  context: { targetDoseWeight: 18, targetYield: 40, grinderId: grinders[0].id, grinderModel: "Lagom P64", grinderSetting: "1.6",
    beanBatchId: bag(1).id, coffeeName: kiambu.name, coffeeRoaster: kiambu.roaster, extras: { rpm: 900, beanJournal: { water: "Lotus Light Roast" } } },
  steamSettings: { targetTemperature: 150, duration: 50, flow: 0.8 },
  hotWaterData: { targetTemperature: 85, duration: 30, volume: 100, flow: 6 },
  rinseData: { targetTemperature: 90, duration: 10, flow: 6 },
};

// ── Shots ──
/** A shot's measurements, half a second apart: fill, a low bloom, then a pour that comes in and fades. */
function curve(start, seconds, finalYield, peak) {
  const out = [];
  for (let t = 0; t <= seconds; t += 0.5) {
    const ramp = Math.min(1, t / 6);
    const pressure = t < 4 ? t * 0.8 : peak * ramp * (1 - Math.max(0, t - seconds * 0.55) / (seconds * 1.2));
    const flow = t < 4 ? 4 : t < 10 ? 1 : 1.6 + 0.6 * Math.sin(t / 7);
    const weight = Math.max(0, finalYield * Math.pow(Math.max(0, t - 7) / (seconds - 7), 1.15));
    const timestamp = iso(start + t * 1000);
    out.push({ machine: { timestamp, state: { state: "espresso", substate: t < 8 ? "preinfusion" : "pouring" },
      pressure: +pressure.toFixed(2), flow: +flow.toFixed(2), mixTemperature: 92.3, groupTemperature: +(92 + Math.sin(t / 5) * 0.4).toFixed(2),
      profileFrame: t < 12 ? 0 : t < 20 ? 1 : 2, targetPressure: t < 4 ? 0 : peak, targetFlow: t < 4 ? 4 : 0, targetMixTemperature: 92.5, targetGroupTemperature: 92.5 },
      // No weightFlow from the scale, as some scales: readers work it out from the weight.
      scale: { timestamp, weight: +weight.toFixed(1) } });
  }
  return out;
}
const shots = [];
const COFFEE = { 1: [1, 0], 2: [2, 0], 3: [3, 1], 30: [3, 0], 4: [4, 0], 5: [5, 0], 6: [6, 0] };
const BLOCK = "\n\n[Bean Journal]\nTaste: Balanced · Body: Medium\nWater: Volvic\nGrinder: 1000 RPM\n[/Bean Journal]";
[
  // n, coffee, days ago, profile, dose, yield, seconds, peak, grinder, grind, rpm, score, balance, body, notes, tds, ey, water, visualizer
  [1, 1, 0.1, blooming, 18, 41.2, 31, 6.2, 0, "1.6", 900, 88, "balanced", "medium", "Juicy, blackcurrant; long sweet finish", 9.4, 21.5, "Lotus Light Roast", "6f1c2b9e-4b7d-4c1a-9a51-0f2d7e3c8a11"],
  [2, 1, 0.4, blooming, 18, 39.5, 27, 7.0, 0, "1.8", 900, 72, "sour", "thin", "A touch thin: grind finer", null, null, "Lotus Light Roast", "0b7e4d2a-91c3-4f6e-8d25-3a9c1e7b5f42"],
  [3, 1, 1.2, turbo, 18, 45, 18, 6.0, 0, "2.4", 1100, null, null, null, "", null, null, "Lotus Light Roast", null],
  [4, 6, 0.8, blooming, 18, 40, 30, 6.4, 0, "1.7", 1000, 85, "balanced", "medium", "Black tea and apple", null, null, "Volvic", null],
  [5, 2, 2.5, blooming, 18, 38, 33, 6.8, 1, "14", null, 90, "balanced", "heavy", "Strawberry jam, very sweet", 9.8, 20.7, "Volvic", "c3d9a8e1-7f2b-4e5d-b6a4-91e0f3c2d773"],
  [6, 2, 3, blooming, 18.5, 36, 36, 8.0, 1, "12", null, 65, "bitter", "heavy", "Too long; go coarser", null, null, "Volvic", null],
  [7, 3, 4, turbo, 18, 54, 16, 5.6, 0, "2.6", 1200, 80, "balanced", "thin", "Tea-like, bergamot", null, null, "Third Wave Water espresso", null],
  [8, 30, 40, blooming, 18, 40, 29, 6.5, 0, "1.7", 900, 82, "balanced", "medium", "", null, null, null, null],
  [9, 4, 55, blooming, 18, 40, 30, 6.6, 1, "15", null, 78, "sour", "medium", "Raisins, a little sharp", null, null, null, null],
  [10, 5, 6, blooming, 19, 38, 28, 7.2, 1, "14", null, 75, "balanced", "heavy", "Good with milk", null, null, null, null],
  [11, "santos", 9, blooming, 18, 36, 27, 7.5, 1, "16", null, null, null, null, "", null, null, null, null],
  [12, null, 0.6, blooming, 18, 40, 29, 6.5, 2, "Medium-fine", null, null, null, null, "Forgot to choose the coffee", null, null, null, null],
].forEach(([n, coffee, ago, profile, dose, yieldG, seconds, peak, grinder, grind, rpm, score, balance, body, notes, tds, ey, water, visualizerId]) => {
  const start = NOW - ago * DAY - n * 60000;
  const g = grinders[grinder];
  const batch = typeof coffee === "number" ? bag(...COFFEE[coffee]) : null;
  const bean = batch ? beans.find((b) => b.id === batch.beanId) : coffee === "santos" ? beans[6] : null;
  const extras = compact({ rpm, beanJournal: water ? { water } : null });
  const context = compact({ targetDoseWeight: dose, targetYield: Math.round(dose * 2.2), grinderId: g.id, grinderModel: g.model, grinderSetting: grind,
    beanBatchId: batch?.id, coffeeName: bean?.name, coffeeRoaster: bean?.roaster, extras: Object.keys(extras).length ? extras : null });
  const tag = compact({ balance, body });
  const annotations = compact({ actualDoseWeight: dose, actualYield: yieldG, enjoyment: score === null ? null : score / 10,
    espressoNotes: n === 4 ? notes + BLOCK : notes || null, drinkTds: tds, drinkEy: ey,
    extras: compact({ beanJournal: Object.keys(tag).length || n === 4 ? { ...tag, ...(n === 4 ? { notesBlock: BLOCK } : {}) } : null, visualizerId }) });
  shots.push({ id: uid("e", n), timestamp: iso(start), createdAt: iso(start + seconds * 1000), updatedAt: iso(start + seconds * 1000),
    workflow: { id: workflow.id, name: workflow.name, profile, context }, annotations, measurements: curve(start, seconds, yieldG, peak),
    stopReason: "targetWeight" });
});
/** Shots in lists and events: without the measurements, as Decaid sends them. */
const summary = ({ measurements: _m, ...rest }) => rest;

// ── The plugin's settings (Decaid keeps them; secure ones are never read back) ──
let settings = {};
const isSecureState = (v) => isObject(v) && Object.keys(v).length === 1 && typeof v.isSet === "boolean";
function settingsView() {
  const out = {};
  for (const [k, s] of Object.entries(manifest().settings ?? {})) {
    if (s.secure) out[k] = { isSet: k in settings };
    else if (k in settings) out[k] = settings[k];
  }
  return out;
}
/** As Decaid: only the manifest's settings, enum values checked, null removes, then the plugin is loaded again. */
function saveSettings(patch) {
  if (!isObject(patch)) throw fail(400, "Settings must be an object");
  const schema = manifest().settings ?? {};
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in schema)) throw fail(400, `Setting "${k}" not defined in plugin manifest`);
    if (v === null || isSecureState(v)) continue;
    if (schema[k].type === "enum" && !schema[k].values.includes(v)) throw fail(400, `Setting "${k}" must be one of: ${schema[k].values.join(", ")}`);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete settings[k];
    else if (!isSecureState(v)) settings[k] = v;
  }
  reloadPlugin();
  return settingsView();
}

// ── Decaid's REST API, used by the plugin (in-process fetch) and by the browser (port 8080) ──
const routes = [];
/** `conditional`: answered with an ETag and 304 to a matching If-None-Match, as Decaid's list endpoints. */
const on = (method, pattern, fn, conditional = false) => routes.push({ method, re: new RegExp(`^/api/v1${pattern}$`), fn, conditional });
const CREATED = Symbol("created");
const created = (data) => ({ [CREATED]: true, data });
const notFound = (what) => fail(404, `${what} not found`);
const archivedToo = (q) => q.get("includeArchived") === "true";
const BEAN_FIELDS = ["roaster", "name", "species", "decaf", "decafProcess", "country", "region", "producer", "variety", "altitude", "processing", "notes", "archived", "extras"];
const BATCH_FIELDS = ["roastDate", "roastLevel", "harvestDate", "qualityScore", "price", "currency", "weight", "weightRemaining", "buyDate", "openDate", "bestBeforeDate", "freezeDate", "unfreezeDate", "frozen", "archived", "notes", "extras"];
const BATCH_DATES = ["roastDate", "buyDate", "openDate", "bestBeforeDate", "freezeDate", "unfreezeDate"];
function checkBean(body) {
  if ("variety" in body && body.variety !== null && !(Array.isArray(body.variety) && body.variety.every((v) => typeof v === "string"))) throw fail(400, "variety must be a list of strings");
  if ("altitude" in body && body.altitude !== null && !(Array.isArray(body.altitude) && body.altitude.every(Number.isInteger))) throw fail(400, "altitude must be a list of integers");
}
function batchFields(body) {
  const out = pick(body, BATCH_FIELDS);
  for (const k of ["qualityScore", "price", "weight", "weightRemaining"]) if (k in out && out[k] !== null && typeof out[k] !== "number") throw fail(400, `${k} must be a number`);
  for (const k of BATCH_DATES) if (k in out) out[k] = decaidDate(out[k], k);
  return out;
}
const beanOf = (id) => beans.find((b) => b.id === id) ?? null;
const batchOf = (id) => batches.find((b) => b.id === id) ?? null;

on("GET", "/beans", (q) => beans.filter((b) => archivedToo(q) || !b.archived), true);
on("POST", "/beans", (q, body) => {
  if (!isObject(body) || typeof body.roaster !== "string" || typeof body.name !== "string") throw fail(400, "roaster and name are required");
  checkBean(body);
  const at = iso(Date.now());
  // Bean.create: a new bean is never archived.
  const { archived: _archived, ...fields } = pick(body, BEAN_FIELDS);
  const bean = compact({ id: randomUUID(), decaf: false, ...fields, archived: false, createdAt: at, updatedAt: at });
  beans.push(bean);
  return created(bean);
});
on("GET", "/beans/([^/]+)", (q, body, [id]) => beanOf(id) ?? Promise.reject(notFound("Bean")));
on("PUT", "/beans/([^/]+)", (q, body, [id]) => {
  const i = beans.findIndex((b) => b.id === id);
  if (i < 0) throw notFound("Bean");
  if (!isObject(body)) throw fail(400, "Expected an object");
  rejectNulls(body, ["roaster", "name", "decaf", "archived"]);
  checkBean(body);
  // A PUT replaces `extras` wholesale, as Decaid does.
  beans[i] = compact({ ...beans[i], ...pick(body, BEAN_FIELDS), id, createdAt: beans[i].createdAt, updatedAt: iso(Date.now()) });
  return beans[i];
});
// A hard delete of the bean and its batches.
on("DELETE", "/beans/([^/]+)", (q, body, [id]) => {
  const i = beans.findIndex((b) => b.id === id);
  if (i >= 0) beans.splice(i, 1);
  for (let j = batches.length - 1; j >= 0; j--) if (batches[j].beanId === id) batches.splice(j, 1);
  return { success: true, id };
});
on("GET", "/beans/([^/]+)/batches", (q, body, [id]) => batches.filter((b) => b.beanId === id && (archivedToo(q) || !b.archived)), true);
// BeanBatch.create: weightRemaining starts as the weight and a new batch is never archived, whatever is sent.
on("POST", "/beans/([^/]+)/batches", (q, body, [beanId]) => {
  if (!beanOf(beanId)) throw fail(400, "FOREIGN KEY constraint failed");
  if (!isObject(body)) throw fail(400, "Expected an object");
  const { weightRemaining: _w, archived: _a, ...fields } = batchFields(body);
  const at = iso(Date.now());
  const batch = compact({ id: randomUUID(), beanId, frozen: false, ...fields, weightRemaining: fields.weight ?? null, archived: false, createdAt: at, updatedAt: at });
  batches.push(batch);
  return created(batch);
});
on("GET", "/bean-batches", (q) => batches.filter((b) => archivedToo(q) || !b.archived), true);
on("GET", "/bean-batches/([^/]+)", (q, body, [id]) => batchOf(id) ?? Promise.reject(notFound("Batch")));
on("PUT", "/bean-batches/([^/]+)", (q, body, [id]) => {
  const i = batches.findIndex((b) => b.id === id);
  if (i < 0) throw notFound("Batch");
  if (!isObject(body)) throw fail(400, "Expected an object");
  rejectNulls(body, ["frozen", "archived"]);
  batches[i] = compact({ ...batches[i], ...batchFields(body), id, beanId: batches[i].beanId, createdAt: batches[i].createdAt, updatedAt: iso(Date.now()) });
  return batches[i];
});
on("DELETE", "/bean-batches/([^/]+)", (q, body, [id]) => {
  const i = batches.findIndex((b) => b.id === id);
  if (i >= 0) batches.splice(i, 1);
  return { success: true, id };
});

on("GET", "/grinders", (q) => grinders.filter((g) => archivedToo(q) || !g.archived), true);
on("POST", "/grinders", (q, body) => {
  if (!isObject(body) || typeof body.model !== "string" || !body.model) throw fail(400, "model is required");
  const at = iso(Date.now());
  const g = compact({ settingType: "numeric", ...body, id: randomUUID(), archived: false, createdAt: at, updatedAt: at });
  grinders.push(g);
  return created(g);
});
on("GET", "/grinders/([^/]+)", (q, body, [id]) => grinders.find((g) => g.id === id) ?? Promise.reject(notFound("Grinder")));
on("PUT", "/grinders/([^/]+)", (q, body, [id]) => {
  const i = grinders.findIndex((g) => g.id === id);
  if (i < 0) throw notFound("Grinder");
  grinders[i] = compact({ ...grinders[i], ...body, id, createdAt: grinders[i].createdAt, updatedAt: iso(Date.now()) });
  return grinders[i];
});

on("GET", "/shots", (q) => {
  const limit = Number.parseInt(q.get("limit") ?? "", 10) || 20, offset = Number.parseInt(q.get("offset") ?? "", 10) || 0;
  const order = q.get("order");
  if (order && order !== "asc" && order !== "desc") throw fail(400, "Invalid order value. Supported: asc, desc");
  const filters = ["grinderId", "grinderModel", "beanId", "beanBatchId", "coffeeName", "coffeeRoaster", "profileTitle", "search"];
  const sorted = (list) => list.sort((a, b) => order === "asc" ? a.timestamp.localeCompare(b.timestamp) : b.timestamp.localeCompare(a.timestamp));
  const ids = q.getAll("ids").flatMap((v) => v.split(",")).filter(Boolean);
  if (ids.length && !filters.some((f) => q.has(f))) return sorted(shots.filter((s) => ids.includes(s.id))).map(clone);
  // beanId: every batch of the bean, finished ones too.
  const beanBatches = q.has("beanId") ? batches.filter((b) => b.beanId === q.get("beanId")).map((b) => b.id) : null;
  const is = (name, value) => !q.has(name) || value === q.get(name);
  const search = q.get("search")?.toLowerCase();
  const matching = sorted(shots.filter((s) => {
    const c = s.workflow?.context ?? {};
    return is("grinderId", c.grinderId) && is("grinderModel", c.grinderModel) && is("beanBatchId", c.beanBatchId) &&
      (!beanBatches || beanBatches.includes(c.beanBatchId)) && is("coffeeName", c.coffeeName) && is("coffeeRoaster", c.coffeeRoaster) &&
      is("profileTitle", s.workflow?.profile?.title) &&
      (!search || [c.coffeeName, c.coffeeRoaster, s.workflow?.profile?.title, c.grinderModel, s.annotations?.espressoNotes].some((v) => typeof v === "string" && v.toLowerCase().includes(search)));
  }));
  const page = Math.min(100, Math.max(1, limit)), from = Math.max(0, offset);
  return { items: matching.slice(from, from + page).map(summary), total: matching.length, limit, offset };
}, true);
on("GET", "/shots/ids", () => shots.map((s) => s.id));
on("GET", "/shots/latest", () => {
  const latest = [...shots].sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  return latest ? summary(latest) : null;
});
on("GET", "/shots/([^/]+)", (q, body, [id]) => shots.find((s) => s.id === id) ?? Promise.reject(notFound("Shot")));
on("PUT", "/shots/([^/]+)", (q, body, [id]) => {
  if (!isObject(body)) throw fail(400, "Expected an object");
  if (body.id != null && body.id !== id) throw fail(400, "ID in path does not match ID in body");
  if ("measurements" in body) throw fail(400, "measurements is not editable via this endpoint");
  if ("createdAt" in body || "updatedAt" in body) throw fail(400, "createdAt and updatedAt are system-managed and cannot be modified via this endpoint");
  const enjoyment = body.annotations?.enjoyment;
  if (enjoyment != null && (typeof enjoyment !== "number" || enjoyment < 0 || enjoyment > 10)) throw fail(400, `annotations.enjoyment must be between 0 and 10, got ${enjoyment}`);
  const i = shots.findIndex((s) => s.id === id);
  if (i < 0) throw notFound("Shot");
  // The deprecated aliases, as Decaid takes them.
  const patch = { ...body };
  if ("shotNotes" in patch || "metadata" in patch) {
    patch.annotations = { ...("shotNotes" in patch ? { espressoNotes: patch.shotNotes } : {}), ...("metadata" in patch ? { extras: patch.metadata } : {}), ...patch.annotations };
    delete patch.shotNotes;
    delete patch.metadata;
  }
  const before = JSON.stringify(shots[i]);
  const merged = deepMerge(shots[i], patch);
  merged.id = id;
  if (JSON.stringify(merged) !== before) merged.updatedAt = iso(Date.now());
  shots[i] = merged;
  pluginEvent("shotUpdated", { id, shot: summary(merged), patch: body });
  return merged;
});
on("DELETE", "/shots/([^/]+)", (q, body, [id]) => {
  const i = shots.findIndex((s) => s.id === id);
  if (i < 0) throw notFound("Shot");
  shots.splice(i, 1);
  return { success: true, id };
});

on("GET", "/workflow", () => workflow);
on("PUT", "/workflow", (q, body) => {
  if (!isObject(body)) throw fail(400, "Expected an object");
  rejectNulls(body, ["steamSettings", "context"]);
  if ("context" in body && !isObject(body.context)) throw fail(400, 'Field "context" must be an object');
  if (isObject(body.context) && "targetYield" in body.context && typeof body.context.targetYield !== "number") throw fail(400, 'Field "targetYield" must be a number');
  workflow = deepMerge(workflow, body);
  // As Decaid does for plugins with events.workflow: the whole workflow after each change.
  pluginEvent("workflowUpdated", workflow);
  return workflow;
});

on("GET", "/profiles", (q) => {
  const visibility = q.get("visibility");
  if (visibility && !["visible", "hidden", "deleted"].includes(visibility)) throw fail(400, "Invalid visibility value");
  return [...profiles.values()].filter((p) => (visibility ? p.visibility === visibility : p.visibility === "visible" || (q.get("includeHidden") === "true" && p.visibility === "hidden"))
    && (!q.has("parentId") || p.parentId === q.get("parentId")));
}, true);
function checkProfile(profile) {
  if (!isObject(profile) || typeof profile.title !== "string" || !profile.title || !Array.isArray(profile.steps) || !profile.steps.length) throw fail(400, "A profile needs a title and at least one step");
}
on("POST", "/profiles", (q, body) => {
  checkProfile(body?.profile);
  const id = profileId(body.profile);
  const existing = profiles.get(id);
  if (existing) {
    if (existing.visibility === "deleted") existing.visibility = "visible";
    return created(existing);
  }
  const record = profileRecord(body.profile, { parentId: body.parentId ?? null, createdAt: iso(Date.now()), updatedAt: iso(Date.now()), ...(isObject(body.metadata) ? { metadata: body.metadata } : {}) });
  profiles.set(id, record);
  return created(record);
});
on("GET", "/profiles/([^/]+)", (q, body, [id]) => profiles.get(id) ?? Promise.reject(notFound("Profile")));
// An execution change gives the profile a new id: the record moves to it, as Decaid's content ids do.
on("PUT", "/profiles/([^/]+)", (q, body, [id]) => {
  const record = profiles.get(id);
  if (!record) throw notFound("Profile");
  if (!isObject(body) || body.profile === null) throw fail(400, "profile must not be null");
  const profile = body.profile ?? record.profile;
  checkProfile(profile);
  const next = profileId(profile);
  if (next !== id && record.isDefault) throw fail(400, "Cannot modify default profile content");
  if (next !== id && profiles.has(next)) throw fail(400, "Target profile id already exists");
  const meta = hash([profile.title, profile.author, profile.notes]);
  const updated = { ...record, id: next, profile, metadataHash: meta, compoundHash: hash([next, meta]), updatedAt: iso(Date.now()) };
  if ("metadata" in body) { if (body.metadata === null) delete updated.metadata; else updated.metadata = body.metadata; }
  profiles.delete(id);
  profiles.set(next, updated);
  return updated;
});
on("DELETE", "/profiles/([^/]+)", (q, body, [id]) => {
  const record = profiles.get(id);
  if (!record) throw notFound("Profile");
  record.visibility = record.isDefault ? "hidden" : "deleted";
  return { success: true, message: record.isDefault ? "Profile hidden" : "Profile deleted", id };
});
on("PUT", "/profiles/([^/]+)/visibility", (q, body, [id]) => {
  const record = profiles.get(id);
  if (!record) throw notFound("Profile");
  if (!["visible", "hidden", "deleted"].includes(body?.visibility)) throw fail(400, "Invalid visibility");
  if (record.isDefault && body.visibility === "deleted") throw fail(400, "Cannot delete a default profile");
  record.visibility = body.visibility;
  return record;
});

// Decaid's key-value store (Streamline keeps its shared settings there): a missing key answers null.
on("GET", "/store/([^/]+)", (q, body, [ns]) => q.get("full") === "1" ? Object.fromEntries(kvSpace(ns)) : [...kvSpace(ns).keys()], true);
on("GET", "/store/([^/]+)/([^/]+)", (q, body, [ns, key]) => kvSpace(ns).get(key) ?? null);
on("POST", "/store/([^/]+)/([^/]+)", (q, body, [ns, key], raw) => { kvSpace(ns).set(key, body ?? raw); return {}; });
on("DELETE", "/store/([^/]+)/([^/]+)", (q, body, [ns, key]) => { kvSpace(ns).delete(key); return {}; });

on("GET", "/plugins", () => {
  const m = manifest();
  return [{ ...m, loaded: !!plugin, enabled: true }];
});
on("GET", `/plugins/${ID.replace(/\./g, "\\.")}/settings`, () => settingsView());
on("POST", `/plugins/${ID.replace(/\./g, "\\.")}/settings`, (q, body) => saveSettings(body));
on("GET", "/info", () => ({ version: "preview", localIp: "192.168.1.20" }));

// ── The machine: sleep and wake, and a simulated shot that is stored as Decaid stores shots ──
let machineState = "idle";
const machineSockets = new Set(), scaleSockets = new Set();
let shotSim = null;
const SHOT_S = 32;
function machineSnapshot() {
  const warm = machineState === "sleeping" ? 40 : 92;
  const snapshot = { timestamp: iso(Date.now()), state: { state: machineState, substate: "ready" }, flow: 0, pressure: 0, targetFlow: 0,
    targetPressure: 0, mixTemperature: warm, groupTemperature: warm, targetMixTemperature: 92, targetGroupTemperature: 92, profileFrame: 0,
    steamTemperature: machineState === "sleeping" ? 40 : 150 };
  return shotSim ? Object.assign(snapshot, shotFrame((Date.now() - shotSim.start) / 1000)) : snapshot;
}
const sendMachine = (only) => { const s = machineSnapshot(); for (const socket of only ? [only] : machineSockets) wsText(socket, s); };
// Fill (a flow step, 4 mL/s), bloom (flow 0), then a pour held at 6 bar that comes in low and fades: its pressure goes
// from off target to on target to drifting, as on a real puck.
function shotFrame(t) {
  if (t < 2) return { state: { state: "espresso", substate: "preparingForShot" } };
  const s = t - 2;
  const wobble = Math.sin(s * 2.7) * 0.06;
  let frame, substate, pressure, flow, targetPressure = 0, targetFlow = 0;
  if (s < 8) { frame = 0; substate = "preinfusion"; targetFlow = 4; flow = 4 * Math.min(1, s / 1.5) * (0.93 + wobble); pressure = Math.min(3.2, s * 0.45); }
  else if (s < 14) { frame = 1; substate = "preinfusion"; flow = Math.max(0.1, 1.2 - (s - 8) * 0.3); pressure = 3.2 - (s - 8) * 0.25; }
  else { const u = s - 14; frame = 2; substate = "pouring"; targetPressure = 6; pressure = Math.min(7.1, 1.7 + u * 1.6) - Math.max(0, u - 4) * 0.35 + wobble; flow = Math.min(2.6, 0.6 + u * 0.35) + wobble; }
  return { state: { state: "espresso", substate }, profileFrame: frame, pressure: +pressure.toFixed(2), flow: +Math.max(0, flow).toFixed(2),
    targetPressure, targetFlow, groupTemperature: +(91.6 + Math.sin(s / 4) * 0.5).toFixed(2), mixTemperature: 92.3, targetGroupTemperature: 92, targetMixTemperature: 92 };
}
const shotWeight = (t, target) => target * Math.pow(Math.min(1, Math.max(0, t - 12) / 20), 1.2);
function startShot() {
  if (shotSim) return;
  machineState = "espresso";
  const target = typeof workflow.context?.targetYield === "number" ? workflow.context.targetYield : 36;
  shotSim = { start: Date.now(), target, measurements: [], last: null };
  shotSim.timer = setInterval(() => {
    const t = (Date.now() - shotSim.start) / 1000;
    if (t >= SHOT_S) return endShot("targetWeight");
    if (t >= 2) {
      const weight = shotWeight(t, target), weightFlow = shotSim.last ? Math.max(0, (weight - shotSim.last.weight) / (t - shotSim.last.t)) : 0;
      shotSim.last = { t, weight };
      const machine = machineSnapshot(), scale = { timestamp: machine.timestamp, weight: +weight.toFixed(1), weightFlow: +weightFlow.toFixed(2), battery: 80 };
      shotSim.measurements.push({ machine, scale });
      for (const socket of scaleSockets) wsText(socket, scale);
    }
    sendMachine();
  }, 100);
}
/** The end of the simulated shot: stored (as Decaid does once the pour began) with the workflow it ran with. */
function endShot(stopReason) {
  const sim = shotSim;
  clearInterval(sim.timer);
  shotSim = null;
  machineState = "idle";
  sendMachine();
  const t = (Date.now() - sim.start) / 1000;
  // A shot stopped before the pour isn't stored at all.
  if (t < 16) return;
  const context = clone(workflow.context ?? {});
  const dose = typeof context.targetDoseWeight === "number" ? context.targetDoseWeight : 18;
  const at = iso(Date.now());
  const shot = { id: randomUUID(), timestamp: iso(sim.start), createdAt: at, updatedAt: at,
    workflow: clone({ id: workflow.id, name: workflow.name, profile: workflow.profile, context }),
    annotations: { actualDoseWeight: dose, actualYield: +shotWeight(t, sim.target).toFixed(1) }, measurements: sim.measurements, stopReason };
  shots.push(shot);
  // The bag's grams left go down by the dose.
  const batch = batchOf(context.beanBatchId);
  const left = batch ? batch.weightRemaining ?? batch.weight : undefined;
  if (batch && typeof left === "number") Object.assign(batch, { weightRemaining: Math.max(0, +(left - dose).toFixed(1)), updatedAt: at });
  console.log(`Shot stored: ${shot.id} (${context.coffeeName ?? "no coffee"}, ${shot.annotations.actualYield} g)`);
  pluginEvent("shotStored", { id: shot.id });
}
on("GET", "/machine/state", () => machineSnapshot());
on("PUT", "/machine/state/([A-Za-z]+)", (q, body, [wanted]) => {
  const state = wanted.toLowerCase();
  if (state === "espresso") { startShot(); return {}; }
  // Skip step: the simulated shot jumps to its next step (fill → bloom → pour), as the DE1 does.
  if (state === "skipstep") {
    if (shotSim) { const t = (Date.now() - shotSim.start) / 1000, next = [2, 10, 16].find((at) => at > t); if (next) shotSim.start -= (next - t) * 1000; }
    return {};
  }
  // Anything else during the simulated shot stops it, as the machine's Stop does.
  if (shotSim) endShot("appStop");
  machineState = state === "sleeping" ? "sleeping" : "idle";
  sendMachine();
  return {};
});

// A DiFluid R2 as Decaid's Sensors API shows it.
let r2Reads = 0;
const R2 = { id: "AA:BB:CC:DD:EE:01", info: { name: "DiFluid R2", vendor: "DiFluid",
  data: [{ key: "tds", type: "number", unit: "percent" }, { key: "temperatureC", type: "number", unit: "Celsius" }],
  commands: [{ id: "measure", name: "Measure TDS" }] } };
const withR2 = process.env.R2 !== "0";
on("GET", "/sensors", () => withR2 ? [R2] : []);
on("GET", "/sensors/([^/]+)", (q, body, [id]) => withR2 && id === R2.id ? R2 : Promise.reject(notFound("Sensor")));
on("POST", "/sensors/([^/]+)/execute", async (q, body, [id]) => {
  if (!withR2 || id !== R2.id) throw notFound("Sensor");
  await new Promise((r) => setTimeout(r, 1500));
  if (body?.commandId !== "measure" || process.env.R2 === "fail") throw fail(500, "Exception: R2 measurement failed");
  return { status: "ok", result: { reading: { timestamp: iso(Date.now()), tds: [9.32, 9.41, 9.37, 9.35, 9.39][(r2Reads++) % 5], temperatureC: 24.6 } } };
});
// The machine and the scale too: Streamline asks Decaid's devices whether a silent machine feed means a dead machine.
const devices = () => [
  { id: "DE1-preview", name: "DE1XL", type: "machine", state: "connected", available: true },
  ...(process.env.SCALE !== "0" ? [{ id: "scale-preview", name: "Decent Scale", type: "scale", state: "connected", available: true }] : []),
  ...(withR2 ? [{ id: R2.id, name: "DiFluid R2", type: "sensor", state: "connected", available: true }] : []),
];
on("GET", "/devices", devices);
on("GET", "/devices/scan", async () => { await new Promise((r) => setTimeout(r, 800)); return devices(); });

/** One REST call: { status, data, etag? }. `raw` is the request body as sent; `body` its JSON. */
async function route(method, path, query, raw, ifNoneMatch) {
  let body = null;
  if (raw) {
    try { body = JSON.parse(raw); } catch { return { status: 400, data: { error: "FormatException: Unexpected character in JSON body" } }; }
  }
  for (const r of routes) {
    const m = r.method === method && r.re.exec(path);
    if (!m) continue;
    try {
      const data = await r.fn(query, body, m.slice(1).map(decodeURIComponent), raw);
      const answer = data?.[CREATED] ? { status: 201, data: data.data } : { status: 200, data };
      if (r.conditional && answer.status === 200) {
        const etag = `"${hash(answer.data).slice(0, 16)}"`;
        if (ifNoneMatch && (ifNoneMatch === "*" || ifNoneMatch === etag)) return { status: 304, etag };
        return { ...answer, etag };
      }
      return answer;
    } catch (e) {
      return { status: e.status ?? 500, data: { error: e.message } };
    }
  }
  return null;
}

// ── The real plugin, run as Decaid runs it: its own JavaScript realm, no URL class, fetch to Decaid only ──
let plugin = null, innerJSON = JSON, requests = 0;
const pluginStorage = new Map();
/** Open sockets of the plugin's websocket endpoints (Decaid's `emit`): endpoint → sockets. */
const pluginSockets = new Map();
/** Values handed to the plugin are made in its own realm, as the host's are. */
const inside = (value) => value === undefined ? undefined : innerJSON.parse(JSON.stringify(value));
const report = (what, e) => console.error(`[plugin] ${what}: ${e?.stack ?? e}`);
function deliver(name, payload) {
  if (!plugin?.onEvent) return;
  try { Promise.resolve(plugin.onEvent(inside({ name, payload }))).catch((e) => report(name, e)); } catch (e) { report(name, e); }
}
const pluginEvent = (name, payload) => { const copy = clone(payload); setTimeout(() => deliver(name, copy)); };
const headerOf = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? headers[key] : undefined;
};
/** The plugin's fetch: Decaid's own REST API in-process; there is no internet in the preview. */
async function pluginFetch(input, init = {}) {
  const url = String(input);
  const m = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::8080)?(\/api\/v1\/[^?#]*)(?:\?([^#]*))?/.exec(url);
  if (!m) throw new TypeError(`fetch failed: the preview only answers Decaid's own API (${url})`);
  const method = String(init.method ?? "GET").toUpperCase();
  const raw = init.body == null ? "" : String(init.body);
  const answer = await route(method, m[1], new URLSearchParams(m[2] ?? ""), raw, headerOf(init.headers, "if-none-match"))
    ?? { status: 404, data: { error: "Not found" } };
  const text = answer.status === 304 || answer.data === undefined ? "" : JSON.stringify(answer.data);
  const headers = { "content-type": "application/json", ...(answer.etag ? { etag: answer.etag } : {}) };
  return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, statusText: http.STATUS_CODES[answer.status] ?? "", url,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null, has: (name) => String(name).toLowerCase() in headers },
    text: async () => text, json: async () => innerJSON.parse(text) };
}
function startPlugin() {
  try {
    const context = createContext({ console, setTimeout, clearTimeout, fetch: pluginFetch });
    innerJSON = runInContext("JSON", context);
    runInContext(readFileSync(PLUGIN_JS, "utf8"), context, { filename: PLUGIN_JS });
    plugin = context.createPlugin({
      log: (message) => console.log(`[plugin] ${message}`),
      // What the plugin emits goes to the sockets open on its websocket endpoint of that name.
      emit: (event, payload) => { for (const socket of pluginSockets.get(event) ?? []) wsText(socket, payload); },
      storage: (cmd) => {
        if (cmd?.type === "read") pluginEvent("storageRead", { key: cmd.key, value: pluginStorage.get(cmd.key) ?? null });
        else if (cmd?.type === "write") { pluginStorage.set(cmd.key, clone(cmd.data)); pluginEvent("storageWrite", { key: cmd.key, value: cmd.data }); }
      },
    });
    Promise.resolve(plugin.onLoad?.(inside({ ...settings }))).catch((e) => report("onLoad", e));
    // Decaid hands a plugin with events.workflow the current workflow when it loads.
    pluginEvent("workflowUpdated", workflow);
  } catch (e) {
    plugin = null;
    report("load", e);
  }
}
function reloadPlugin() {
  try { plugin?.onUnload?.(); } catch (e) { report("onUnload", e); }
  plugin = null;
  startPlugin();
}

// ── WebSockets (text frames only; enough for the skin, the page and the plugin's `changed`) ──
function wsText(socket, data) {
  const payload = Buffer.from(JSON.stringify(data));
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 0xff])
    : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff])]);
  if (!socket.destroyed) socket.write(Buffer.concat([head, payload]));
}
function acceptSocket(req, socket, onClose) {
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy(), false;
  const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.on("close", onClose);
  socket.on("error", onClose);
  // A close frame: closed. Pings and messages aren't needed by anyone here.
  socket.on("data", (frame) => { if ((frame[0] & 0x0f) === 0x8) socket.end(); });
  return true;
}

// ── Port 8080: the fake Decaid ──
const CORS_HEADERS = "Accept, Accept-Encoding, Authorization, Content-Type, DNT, Origin, User-Agent, If-None-Match";
const cors = (req) => ({ "access-control-allow-origin": req.headers.origin ?? "*", "access-control-expose-headers": "ETag", vary: "Origin" });
const send = (req, res, status, data, headers = {}) => {
  res.writeHead(status, { ...cors(req), ...(data === undefined ? {} : { "content-type": "application/json" }), ...headers });
  res.end(data === undefined ? undefined : JSON.stringify(data));
};
function readRaw(req, limit = 8 * 1024 * 1024) {
  return new Promise((done, failed) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => { size += c.length; if (size > limit) { failed(fail(413, "Request body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", failed);
  });
}
const pluginPath = new RegExp(`^/api/v1/plugins/${ID.replace(/\./g, "\\.")}/([^/]+)$`);
async function serveDecaid(req, res) {
  const url = new URL(req.url, `http://localhost:${DECAID_PORT}`);
  // Decaid's CORS answer: other sites can't send the plugin page's own header (x-bean-journal-ui).
  if (req.method === "OPTIONS") {
    res.writeHead(200, { ...cors(req), "access-control-allow-methods": "DELETE, GET, OPTIONS, PATCH, POST, PUT", "access-control-allow-headers": CORS_HEADERS, "access-control-max-age": "86400" });
    return res.end();
  }
  const raw = await readRaw(req);
  const endpoint = pluginPath.exec(url.pathname)?.[1];
  const api = manifest().api ?? [];
  if (endpoint && api.some((a) => a.id === endpoint && a.type === "http")) {
    const handler = plugin && (plugin.__httpRequestHandler ?? plugin.handleHttpRequest);
    if (!handler) return send(req, res, 503, { error: "The plugin isn't loaded (see the console)" });
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch { return send(req, res, 400, { error: "Invalid JSON body" }); } }
    const request = { requestId: String(++requests), endpoint, method: req.method, headers: req.headers, body, query: Object.fromEntries(url.searchParams) };
    let out;
    try { out = await handler.call(plugin, inside(request)); } catch (e) { report(`${endpoint} endpoint`, e); return send(req, res, 500, { error: String(e?.message ?? e) }); }
    const text = typeof out?.body === "string" ? out.body : out?.body == null ? "" : JSON.stringify(out.body);
    res.writeHead(out?.status ?? 200, { ...cors(req), ...(typeof out?.body === "string" || out?.body == null ? {} : { "content-type": "application/json" }), ...out?.headers });
    return res.end(text);
  }
  if (url.pathname.startsWith("/api/v1/")) {
    const answer = await route(req.method, url.pathname, url.searchParams, raw, req.headers["if-none-match"]);
    if (answer) return send(req, res, answer.status, answer.status === 304 ? undefined : answer.data, answer.etag ? { etag: answer.etag } : {});
    // The rest of Decaid (machine settings, devices, display…) that Streamline asks for: answered empty.
    return send(req, res, 200, url.pathname.endsWith("s") ? [] : {});
  }
  send(req, res, 404, { error: "Not found" });
}
const decaid = http.createServer((req, res) => serveDecaid(req, res).catch((e) => {
  console.error(e);
  if (!res.headersSent) send(req, res, e.status ?? 500, { error: String(e?.message ?? e) }); else res.end();
}));
decaid.on("upgrade", (req, socket) => {
  const path = new URL(req.url, "http://x").pathname;
  const channel = new RegExp(`^/ws/v1/plugins/${ID.replace(/\./g, "\\.")}/([^/]+)$`).exec(path)?.[1];
  if (channel && (manifest().api ?? []).some((a) => a.id === channel && a.type === "websocket")) {
    const open = pluginSockets.get(channel) ?? new Set();
    pluginSockets.set(channel, open);
    if (acceptSocket(req, socket, () => open.delete(socket))) open.add(socket);
    return;
  }
  // Decaid's machine feed: once a second when idle or asleep, ten times a second during a shot.
  if (path === "/ws/v1/machine/snapshot") {
    const timer = setInterval(() => { if (!shotSim) sendMachine(socket); }, 1000);
    if (acceptSocket(req, socket, () => { clearInterval(timer); machineSockets.delete(socket); })) { machineSockets.add(socket); sendMachine(socket); }
    return;
  }
  // Decaid's scale feed: an empty cup, beans weighed in up to 18.3 g, held, emptied; during a shot the cup fills.
  if (path === "/ws/v1/scale/snapshot" && process.env.SCALE !== "0") {
    const started = Date.now();
    const timer = setInterval(() => {
      if (shotSim) return;
      const t = ((Date.now() - started) / 1000) % 24;
      const weight = t < 4 ? 0 : t < 10 ? 18.3 * (t - 4) / 6 + Math.random() * 0.2 : t < 20 ? 18.3 : 0;
      wsText(socket, { timestamp: iso(Date.now()), weight: +weight.toFixed(1), weightFlow: 0, battery: 80 });
    }, 200);
    if (acceptSocket(req, socket, () => { clearInterval(timer); scaleSockets.delete(socket); })) scaleSockets.add(socket);
    return;
  }
  socket.destroy();
});

// ── Port 3000: the skin (SKIN=<a Streamline checkout>), or how to get one ──
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".csv": "text/csv", ".map": "application/json", ".txt": "text/plain; charset=utf-8" };
const PAGE = `http://localhost:${DECAID_PORT}/api/v1/plugins/${ID}/ui`;
// Preview only, never in the skin: a button that pulls the simulated shot to try the live numbers and the stored shot,
// and stops it while it pulls (as the machine's Stop does).
const SIMULATE_BUTTON = `<button id="preview-simulate-coffee" style="position:fixed;left:12px;bottom:12px;z-index:20000;padding:8px 14px;border:0;border-radius:18px;background:#17c29a;color:#fff;font:700 14px Inter,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);cursor:pointer">☕ Simulate coffee</button>
<script>(() => {
  const b = document.getElementById("preview-simulate-coffee");
  const machine = "http://" + location.hostname + ":${DECAID_PORT}/api/v1/machine/state";
  let tick = null;
  const idle = () => { clearInterval(tick); tick = null; b.textContent = "☕ Simulate coffee"; b.style.background = "#17c29a"; };
  b.onclick = async () => {
    if (tick) { await fetch(machine + "/idle", { method: "PUT" }); return idle(); }
    await fetch(machine + "/espresso", { method: "PUT" });
    const started = Date.now();
    const paint = () => { b.textContent = "■ Stop · " + Math.round((Date.now() - started) / 1000) + " s"; b.style.background = "#e94560"; };
    paint();
    // Until the fake machine is idle again (the shot's end, Stop, or Skip step past the last step).
    tick = setInterval(async () => {
      paint();
      const state = await fetch(machine).then((r) => r.json()).catch(() => null);
      if (tick && state?.state?.state !== "espresso") idle();
    }, 1000);
  };
})();</script>
`;
const HELP = `<!doctype html><meta charset="utf-8"><title>Bean Journal preview</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:3rem auto;padding:0 1rem;color:#222}code{background:#f1f1f1;padding:.1em .3em;border-radius:4px}li{margin:.3em 0}</style>
<h1>Bean Journal preview</h1>
<p>The fake Decaid runs on port ${DECAID_PORT} with the built plugin and sample coffees and shots. To see the plugin inside Streamline,
start the preview with <code>SKIN</code> set to a checkout of stock Streamline
(<a href="https://github.com/decentespresso/streamline-js">decentespresso/streamline-js</a>, branch <code>main</code>):</p>
<ul><li>PowerShell: <code>$env:SKIN = "C:\\path\\to\\streamline-js"; npm run preview</code></li>
<li>bash: <code>SKIN=~/streamline-js npm run preview</code></li></ul>
<p>Meanwhile, the plugin's own page: <a href="${PAGE}">Shot</a> · <a href="${PAGE}?view=coffees">Coffees</a> ·
<a href="${PAGE}?view=pick">Pick a coffee</a> · <a href="${PAGE}?view=next">Next shot gear card</a> · <a href="${PAGE}?view=settings">Settings</a> ·
<a href="${PAGE}?view=ai">AI</a> · <a href="${PAGE}?theme=dark">Dark</a></p>
<p>The skin's surfaces as the plugin answers them: <a href="http://localhost:${DECAID_PORT}/api/v1/plugins/${ID}/skin">skin</a>.</p>
<p><button onclick="fetch('http://'+location.hostname+':${DECAID_PORT}/api/v1/machine/state/espresso',{method:'PUT'})">☕ Simulate coffee</button>
pulls a 32 s shot that is stored like a real one.</p>`;
function serveSkin(req, res) {
  let rel;
  try { rel = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[\\/]+/, ""); } catch { res.writeHead(400); return res.end(); }
  if (!SKIN) {
    if (rel && rel !== "index.html") { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
    return res.end(HELP);
  }
  if (!rel) rel = "index.html";
  const file = join(SKIN, rel);
  // Inside the skin folder only (a sibling folder sharing its name's start is outside too).
  if (!file.startsWith(SKIN + sep) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
  if (rel === "index.html") return res.end(readFileSync(file, "utf8").replace("</body>", `${SIMULATE_BUTTON}</body>`));
  res.end(readFileSync(file));
}

// ── Start ──
startPlugin();
// A new build (npm run build in another terminal) is loaded again, as an update in Decaid would.
let rebuilt = null;
watchFile(PLUGIN_JS, { interval: 1000 }, (now, before) => {
  if (now.mtimeMs === before.mtimeMs) return;
  clearTimeout(rebuilt);
  rebuilt = setTimeout(() => { console.log("New build: plugin loaded again"); reloadPlugin(); }, 300);
});
const listening = (server, port, name) => new Promise((ready) => {
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${port} is in use (${name}): stop whatever runs there first.` : e);
    process.exit(1);
  });
  server.listen(port, ready);
});
await listening(decaid, DECAID_PORT, "fake Decaid");
await listening(http.createServer(serveSkin), SKIN_PORT, "skin");
console.log(`Fake Decaid with ${ID} ${manifest().version}: http://localhost:${DECAID_PORT}
  Plugin page:  ${PAGE}  (?view=coffees|pick|next|settings|ai, ?theme=dark)
  Surfaces:     http://localhost:${DECAID_PORT}/api/v1/plugins/${ID}/skin
  MCP:          http://localhost:${DECAID_PORT}/api/v1/plugins/${ID}/mcp  (turn it on in the AI tab)
${SKIN ? `Streamline (${SKIN}): http://localhost:${SKIN_PORT}/` : `Skin: none. Set SKIN to a Streamline checkout; http://localhost:${SKIN_PORT}/ says how.`}`);
