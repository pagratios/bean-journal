import {
  BALANCES, BODIES, editedProfile, designedProfile, httpsUrl, isBrew, items, localId, normTitle, notesBlockPatch, notesWithBlock, number, object,
  optionalObject, originHost, profileAt, profileExecution, profileId as profileIdOf, shotKind, shotLine, shotRpm, shotSummary, shotText,
  shotWater, tagOf, text, unaccented, waterName, type ObjectData, type ShotLine,
} from "./protocol";
import {
  beanBody, beanCard, batchBody, bagLastDate, coffeeInput, coffeeOf, coffeeRef, coffeesOf, BAG_FIELDS, hasBagFields, hasBeanFields, matchesSearch,
  mergedExtras, oldBags, sameCoffee, today, type Coffee, type CoffeeInput, type RecentShot,
} from "./coffees";
import { round1, skinSurfaces } from "./skin";
import { decaid } from "./core/decaid";
import { createRatioMemory, type RatioChange } from "./core/ratio-memory";
import { createCoffeeHistory, sortCoffees } from "./core/coffee-order";
import { copy, page } from "./ui";
import { MCP_CONFIRMS, MCP_LEVELS, MCP_TOKEN, mcpMessage, rateLimit, type McpConfirm, type McpLevel } from "./mcp";

export const PLUGIN_ID = "bean-journal.reaplugin";
export const VERSION = "0.1.6";
// How long the newest shot is taken as known without a shot event (a deletion sends none).
const LATEST_MS = 15000;
// The beans and batches (hundreds of each on a real tablet) are read in one go and kept this long; writes forget them.
const SHELF_MS = 5000;
// A missed workflow event (Streamline's clean-up while the plugin was busy) is caught this often.
const LOOK_MS = 60000;
// The page resizes a photo to ≤ 800 px (JPEG ~0.8), well under this.
const PHOTO_MAX = 600000;
const WATERS_MAX = 20;
const PHOTOS = "/store/beanJournal-photos";
const WATERS = "/store/beanJournal/waters";
const RATIOS = "/store/beanJournal/ratioMemory";
const COFFEE_HISTORY = "/store/beanJournal/coffeeHistory";
// Old bags are offered for finishing once: this says it was.
const OLD_BAGS = "/store/beanJournal/oldBags";
const OLD_DAYS = 91;
// Fewer than this and the list is short enough as it is: nothing is offered (and it may be later).
const OLD_MIN = 10;
type Host = {
  log(message: string): void;
  storage(command: { type: "read" | "write"; key: string; namespace: string; data?: unknown }): void;
  emit?(event: string, payload: unknown): void;
};
type HttpRequest = { endpoint: string; method: string; headers: Record<string, string>; body: unknown; query?: Record<string, string> };
type HttpResponse = { status: number; headers: Record<string, string>; body: string };
type Next = { grinderId: string | null; grinderModel: string; grind: string; rpm: number | null; water: string; lockRatio: boolean };
/** The next shot's coffee and gear as last seen, put back after Streamline clears them (`extras.beanJournal.gear`). */
type Gear = { beanBatchId: string | null; coffeeName: string | null; coffeeRoaster: string | null; grinderId: string | null; grinderModel: string | null; rpm: number | null };
const COFFEE_KEYS = ["beanBatchId", "coffeeName", "coffeeRoaster"] as const;
const GEAR_KEYS = [...COFFEE_KEYS, "grinderId", "grinderModel"] as const;

export function createPlugin(host: Host) {
  let config: ObjectData = {};
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sticky: ReturnType<typeof setTimeout> | undefined;
  let work = Promise.resolve();
  // The page's HTML is the same for every request: built once.
  let pageHtml: string | null = null;
  // The page asks for the newest shot every few seconds: answered from here until a shot is stored or changed.
  const latestMemo = new Map<string, { at: number; id: string | null; timestamp: string | null }>();
  /**
   * What AI assistants may do (the page's AI tab), each token with its own level: off until a level is chosen
   * and its token saved. The public token is the one in the phone apps' connector URL (through Tailscale Funnel).
   */
  const levelOf = (v: unknown): McpLevel => (MCP_LEVELS as readonly unknown[]).includes(v) ? v as McpLevel : "off";
  const mcpLevel = () => MCP_TOKEN.test(text(config.McpToken)) ? levelOf(config.McpAccess) : "off";
  const mcpPublicLevel = () => MCP_TOKEN.test(text(config.McpPublicToken)) ? levelOf(config.McpPublicAccess) : "off";
  const mcpConfirm = (): McpConfirm => (MCP_CONFIRMS as readonly unknown[]).includes(config.McpConfirm) ? config.McpConfirm as McpConfirm : "changes";
  // Per token, so a busy connector can't use up the other's changes.
  const homeChanges = rateLimit(60, 60000), publicChanges = rateLimit(60, 60000);
  const onCoffeeChoice = () => ["last", "best"].includes(text(config.OnCoffeeChoice)) ? text(config.OnCoffeeChoice) : "keep";
  const visualizerNotes = () => config.VisualizerNotes === true;

  const message = (e: unknown) => {
    const code = e instanceof Error ? e.message : "failed";
    const said = copy().errors[code as keyof ReturnType<typeof copy>["errors"]] ?? copy().failed;
    const detail = e instanceof Error ? text((e as Error & { detail?: unknown }).detail) : "";
    return code === "sensorFailed" ? said.replace("{why}", detail || copy().failed) : said;
  };
  const log = (what: string) => (e: unknown) => {
    if (stopped) return;
    const detail = e instanceof Error ? text((e as Error & { detail?: unknown }).detail) : "";
    host.log(`[bean-journal] ${what}: ${message(e)}${detail ? ` (${detail})` : ""}`);
  };
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = work.then(() => { if (stopped) throw new Error("stopped"); return task(); });
    work = next.then(() => undefined, () => undefined);
    return next;
  }

  /** The workflow as last read for keepBrewTemp, and when the plugin itself last changed its temperatures. */
  let seenWorkflow: ObjectData | null = null;
  let ownTempsAt = 0;
  const stepTemps = (profile: ObjectData) => items(profile.steps ?? []).map((step) => number(step.temperature) ?? null);
  async function local(path: string, method = "GET", body?: unknown) {
    if (stopped) throw new Error("stopped");
    // The plugin's own change of the profile's temperatures (a shot's or a profile loaded) is never taken for
    // Streamline undoing the Brew tile (keepBrewTemp).
    if (method === "PUT" && path === "/workflow") {
      const sent = optionalObject(optionalObject(body).profile);
      if (Array.isArray(sent.steps) && stepTemps(sent).join() !== stepTemps(optionalObject(seenWorkflow?.profile)).join()) ownTempsAt = Date.now();
    }
    const writesShelf = method !== "GET" && /^\/(?:beans|bean-batches)(?:[/?]|$)/.test(path);
    try {
      const answer = await decaid(path, method, body);
      if (stopped) throw new Error("stopped");
      // Decaid pushes no workflow changes to skins: the skin listens on the plugin's `changed` socket and repaints at
      // once what the plugin wrote (from its page or an AI assistant), instead of on its slow re-read.
      if (method === "PUT" && path === "/workflow") {
        try { host.emit?.("changed", { what: "workflow" }); } catch { /* a Decaid without emit: the skin's re-read */ }
      }
      return answer;
    } finally {
      if (writesShelf) forgetShelf();
      if (method !== "GET" && /^\/shots(?:[/?]|$)/.test(path)) {
        const id = /^\/shots\/([^/?]+)$/.exec(path)?.[1];
        coffeeHistory.invalidate(id ? decodeURIComponent(id) : undefined);
      }
    }
  }
  const enc = encodeURIComponent;

  // ── Coffees: Decaid's beans and their batches ──
  type Shelf = { at: number; beans: ObjectData[]; batches: ObjectData[]; coffees: Coffee[] };
  let shelf: Shelf | null = null;
  let shelfRead: { generation: number; promise: Promise<Shelf> } | null = null;
  let shelfGeneration = 0;
  // A batch's bean never changes (Decaid's PUT keeps beanId): known once, kept.
  const beanOfBatch = new Map<string, string>();
  function forgetShelf() { shelf = null; shelfGeneration++; }
  async function readShelf(fresh = false) {
    if (!fresh && shelf && Date.now() - shelf.at < SHELF_MS) return shelf;
    const generation = shelfGeneration;
    if (shelfRead?.generation === generation) return shelfRead.promise;
    const promise = (async () => {
      const [beans, batches] = await Promise.all([local("/beans?includeArchived=true"), local("/bean-batches?includeArchived=true")]);
      const read = { at: Date.now(), beans: items(beans), batches: items(batches), coffees: coffeesOf(items(beans), items(batches)) };
      for (const b of read.batches) if (text(b.id) && text(b.beanId)) beanOfBatch.set(text(b.id), text(b.beanId));
      // A write while this was read: its answer may be from before the write, so it isn't kept.
      if (generation === shelfGeneration) shelf = read;
      return read;
    })();
    shelfRead = { generation, promise };
    try { return await promise; } finally { if (shelfRead?.promise === promise) shelfRead = null; }
  }
  /** A coffee by its id; read afresh once when the kept list doesn't have it (another app's new bag). */
  async function coffeeById(id: unknown): Promise<Coffee> {
    const ref = coffeeRef(id);
    for (const fresh of [false, true]) {
      const s = await readShelf(fresh);
      if ("batchId" in ref) {
        const found = s.coffees.find((c) => c.batchId === ref.batchId);
        if (found) return found;
      } else {
        const bean = s.beans.find((b) => text(b.id) === ref.beanId);
        if (bean) return coffeeOf(bean, null);
      }
    }
    throw new Error("notFound");
  }
  /** The coffee of a batch, from the kept list when fresh, else from two small reads (status runs often). */
  async function coffeeOfBatch(batchId: string): Promise<Coffee | null> {
    if (shelf && Date.now() - shelf.at < SHELF_MS) return shelf.coffees.find((c) => c.batchId === batchId) ?? null;
    try {
      const batch = object(await local(`/bean-batches/${enc(batchId)}`));
      const bean = object(await local(`/beans/${enc(localId(batch.beanId))}`));
      beanOfBatch.set(batchId, text(bean.id));
      return coffeeOf(bean, batch);
    } catch (e) {
      if (e instanceof Error && e.message === "notFound") return null;
      throw e;
    }
  }
  async function beanIdOf(batchId: string | null) {
    if (!batchId) return null;
    if (!beanOfBatch.has(batchId)) {
      try { beanOfBatch.set(batchId, localId(object(await local(`/bean-batches/${enc(batchId)}`)).beanId)); } catch { return null; }
    }
    return beanOfBatch.get(batchId) ?? null;
  }
  /** The card that stands for a bean now (its newest bag in use, …). */
  async function cardOfBean(beanId: string) {
    const s = await readShelf(true);
    const card = beanCard(s.coffees, beanId);
    if (!card) throw new Error("notFound");
    return card;
  }
  /**
   * A coffee as a bag the next shot (or a shot) can name: a bean without a batch gets an empty one first, unless
   * another app gave it one meanwhile.
   */
  async function bagged(coffee: Coffee): Promise<Coffee> {
    if (coffee.batchId) return coffee;
    const s = await readShelf(true);
    const open = s.coffees.find((c) => c.beanId === coffee.beanId && c.batchId && !c.finished);
    if (open) return open;
    const made = object(await local(`/beans/${enc(coffee.beanId)}/batches`, "POST", {}));
    return coffeeById(localId(made.id));
  }
  const coffeeContext = (c: Coffee | null) => ({
    beanBatchId: c?.batchId ?? null, coffeeName: c ? c.name.slice(0, 120) : null, coffeeRoaster: c ? c.roaster.slice(0, 120) : null,
  });
  /** A new bag of a bean; Decaid's POST ignores the grams left and finished, so they follow in a PUT. */
  async function newBag(beanId: string, input: CoffeeInput) {
    const { body, after } = batchBody(input, null, today());
    const made = object(await local(`/beans/${enc(beanId)}/batches`, "POST", body));
    const id = localId(made.id);
    if (Object.keys(after).length) await local(`/bean-batches/${enc(id)}`, "PUT", after);
    if (input.finished !== true) await unarchiveBean(beanId);
    return coffeeById(id);
  }
  /** A coffee bought again (or chosen again) whose bean was put away: its new bag would show as finished otherwise. */
  async function unarchiveBean(beanId: string) {
    const bean = object(await local(`/beans/${enc(beanId)}`));
    if (bean.archived === true) await local(`/beans/${enc(beanId)}`, "PUT", { archived: false });
  }
  const bagOnly = (input: CoffeeInput): CoffeeInput => Object.fromEntries(Object.entries(input).filter(([k]) => (BAG_FIELDS as readonly string[]).includes(k)));
  /**
   * The add/edit form. A new coffee whose roaster and name are a bean's already is answered as `duplicates` (the page
   * asks: a bag of that one, or a new coffee anyway), and nothing is written. `photo` (an assistant's; the page sets it
   * apart) is checked before anything is written and set on the saved coffee.
   */
  async function saveCoffee(b: ObjectData) {
    const withPhoto = b.photo !== undefined;
    if (withPhoto) photoValue(b.photo);
    const saved = await saveCoffeeFields(b);
    if (!withPhoto || !("coffee" in saved)) return saved;
    await setPhoto(saved.coffee.beanId, b.photo);
    return { coffee: await coffeeById(saved.coffee.id) };
  }
  async function saveCoffeeFields(b: ObjectData): Promise<{ coffee: Coffee } | { duplicates: Coffee[] }> {
    const input = coffeeInput(b.fields);
    if (b.id == null) {
      if (b.addToBeanId != null) return { coffee: await newBag(localId(b.addToBeanId), bagOnly(input)) };
      const body = beanBody(input, null);
      if (b.saveNew !== true) {
        const s = await readShelf(true);
        const same = sameCoffee(s.beans, body.roaster, body.name);
        if (same.length) return { duplicates: same.map((bean) => beanCard(s.coffees, text(bean.id)) ?? coffeeOf(bean, null)) };
      }
      const bean = object(await local("/beans", "POST", body));
      return { coffee: await newBag(localId(bean.id), bagOnly(input)) };
    }
    const card = await coffeeById(b.id);
    // Read afresh, not from the kept list: the bean's extras are written back whole.
    const bean = object(await local(`/beans/${enc(card.beanId)}`));
    const beanPatch = hasBeanFields(input) ? beanBody(input, bean) : {};
    let result = card;
    if (card.batchId) {
      if (hasBagFields(input) || "finished" in input) {
        const batch = object(await local(`/bean-batches/${enc(card.batchId)}`));
        await local(`/bean-batches/${enc(card.batchId)}`, "PUT", batchBody(input, batch, today()).body);
      }
      // A bag taken back into use whose bean was put away: the bean comes back too.
      if (input.finished === false && bean.archived === true) beanPatch.archived = false;
    } else if (hasBagFields(input)) {
      result = await newBag(card.beanId, bagOnly(input));
    } else if ("finished" in input) {
      beanPatch.archived = input.finished === true;
    }
    if (Object.keys(beanPatch).length) await local(`/beans/${enc(card.beanId)}`, "PUT", beanPatch);
    return { coffee: await coffeeById(result.id) };
  }
  /**
   * What goes in the photo's store slot: a data URL as the page makes it, or an https address kept as it is and shown
   * from the web (Decaid's engine can't download an image to keep). Null: no photo.
   */
  function photoValue(photo: unknown): string | null {
    if (photo === null) return null;
    if (typeof photo !== "string") throw new Error("invalidArguments");
    if (photo.startsWith("https://")) {
      const url = httpsUrl(photo);
      if (!url) throw new Error("invalidArguments");
      return url;
    }
    if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo)) throw new Error("invalidArguments");
    if (photo.length > PHOTO_MAX) throw new Error("photoTooLarge");
    return photo;
  }
  async function setPhoto(beanId: unknown, photo: unknown) {
    const id = localId(beanId);
    const value = photoValue(photo);
    const bean = object(await local(`/beans/${enc(id)}`));
    let stamp: string | null = null;
    if (value === null) {
      try { await local(`${PHOTOS}/${enc(id)}`, "DELETE"); } catch (e) { if (!(e instanceof Error) || e.message !== "notFound") throw e; }
    } else {
      await local(`${PHOTOS}/${enc(id)}`, "POST", value);
      stamp = new Date().toISOString();
    }
    await local(`/beans/${enc(id)}`, "PUT", { extras: mergedExtras(bean, { photo: stamp }) });
    return { coffee: await cardOfBean(id) };
  }

  // ── Old bags: a long imported list (years of bags, all "in use") is offered for finishing, once. ──
  let oldMemo: { at: number; bags: ObjectData[] } | null = null;
  async function oldBagsAsked() {
    try { return !!(await local(OLD_BAGS)); } catch (e) {
      if (e instanceof Error && e.message === "notFound") return false;
      throw e;
    }
  }
  async function findOldBags() {
    if (await oldBagsAsked()) return { asked: true, bags: [] };
    // The page asks each time it lists coffees until the user answers: the shots aren't read every time.
    if (oldMemo && Date.now() - oldMemo.at < 600000) return { asked: false, bags: oldMemo.bags };
    const since = today(new Date(Date.now() - OLD_DAYS * 86400000));
    // Reuse the complete brew index; opening Coffees must not launch a second history scan for this offer.
    const history = await coffeeHistory.lastBrewed();
    const recent: RecentShot[] = [...history].filter(([, at]) => new Date(at).toISOString().slice(0, 10) >= since)
      .map(([batchId]) => ({ batchId, roaster: "", name: "" }));
    // The next shot's coffee is in use, whatever its dates say.
    let next = "";
    try { next = text(optionalObject(object(await local("/workflow")).context).beanBatchId); } catch { /* no workflow yet */ }
    const found = oldBags((await readShelf(true)).coffees, recent, since).filter((c) => !next || c.batchId !== next);
    const bags = found.length >= OLD_MIN ? found.map((c) => ({ ...c, lastDate: bagLastDate(c) })) : [];
    oldMemo = { at: Date.now(), bags };
    return { asked: false, bags };
  }
  /** The user's answer: the bags chosen are archived (never deleted), and it isn't asked again. */
  async function finishOldBags(b: ObjectData) {
    const ids = b.ids;
    if (!Array.isArray(ids) || ids.length > 5000 || ids.some((x) => typeof x !== "string")) throw new Error("invalidArguments");
    if (ids.length && b.confirmed !== true) throw new Error("confirmation");
    const s = await readShelf(true);
    let finished = 0;
    for (const id of ids) {
      const c = s.coffees.find((x) => x.id === id);
      if (!c || c.finished) continue;
      // One write each, without the edit's re-reads: hundreds of bags in a few seconds.
      if (c.batchId) await local(`/bean-batches/${enc(c.batchId)}`, "PUT", { archived: true });
      else await local(`/beans/${enc(c.beanId)}`, "PUT", { archived: true });
      finished++;
    }
    await local(OLD_BAGS, "POST", { askedAt: new Date().toISOString(), finished });
    oldMemo = null;
    return { finished };
  }

  // ── Waters typed before (newest first), for the page's list ──
  let watersKnown: string[] | null = null;
  async function waters() {
    if (watersKnown) return watersKnown;
    try {
      const saved = await local(WATERS);
      watersKnown = Array.isArray(saved) ? saved.map(waterName).filter(Boolean).slice(0, WATERS_MAX) : [];
    } catch (e) {
      if (!(e instanceof Error) || e.message !== "notFound") throw e;
      watersKnown = [];
    }
    return watersKnown;
  }
  /** A water set on a shot or the next shot goes to the front of the list. Not saved is only a shorter list: logged. */
  async function rememberWater(water: string | null | undefined) {
    if (!water) return;
    try {
      const list = await waters();
      const same = (x: string) => unaccented(x) === unaccented(water);
      if (list[0] && same(list[0]) && list[0] === water) return;
      const next = [water, ...list.filter((x) => !same(x))].slice(0, WATERS_MAX);
      await local(WATERS, "POST", next);
      watersKnown = next;
    } catch (e) { log("waters")(e); }
  }
  async function grinderList(includeArchived = false) {
    return items(await local(includeArchived ? "/grinders?includeArchived=true" : "/grinders"));
  }
  const grinderView = (g: ObjectData) => ({
    id: text(g.id), model: text(g.model), settingType: text(g.settingType) || "numeric",
    settingValues: Array.isArray(g.settingValues) ? g.settingValues.filter((v) => typeof v === "string") : [],
    settingSmallStep: number(g.settingSmallStep) ?? null, rpmSmallStep: number(g.rpmSmallStep) ?? null,
  });
  // Settings lists put-away grinders too, and edits their burrs.
  const grinderRow = (g: ObjectData) => ({ ...grinderView(g), burrs: text(g.burrs), archived: g.archived === true });

  // ── Grinders and waters, kept from Settings ──
  /**
   * A new grinder in Decaid, or one of Decaid's edited (`id`): its model, burrs and the steps of its grind and speed.
   * Two grinders with one name couldn't be told apart in the lists, so a taken name (a put-away one's too) is refused.
   */
  async function saveGrinder(b: ObjectData) {
    const all = await grinderList(true);
    const id = b.id == null ? null : text(b.id);
    if (id !== null && !all.some((g) => text(g.id) === id)) throw new Error("grinderNotFound");
    const body: ObjectData = {};
    if (id === null || "model" in b) {
      const model = typeof b.model === "string" ? b.model.replace(/\s+/g, " ").trim() : "";
      if (!model || model.length > 80) throw new Error("invalidArguments");
      if (all.some((g) => text(g.id) !== id && unaccented(text(g.model).trim()) === unaccented(model))) throw new Error("grinderExists");
      body.model = model;
    }
    if ("burrs" in b) {
      if (b.burrs !== null && typeof b.burrs !== "string") throw new Error("invalidArguments");
      body.burrs = text(b.burrs).trim().slice(0, 80) || null;
    }
    // RPM is whole numbers, so its step is one too.
    for (const [field, max, whole] of [["settingSmallStep", 100, false], ["rpmSmallStep", 1000, true]] as const) {
      if (!(field in b)) continue;
      const value = b[field] === null ? null : number(b[field]);
      if (value === undefined || (value !== null && (value <= 0 || value > max || (whole && !Number.isInteger(value))))) throw new Error("invalidArguments");
      body[field] = value;
    }
    if (id !== null && !Object.keys(body).length) throw new Error("invalidArguments");
    const saved = id === null ? object(await local("/grinders", "POST", { settingType: "numeric", ...body }))
      : object(await local(`/grinders/${enc(id)}`, "PUT", body));
    return { grinder: grinderRow(saved) };
  }
  /** A grinder put away (Decaid's `archived`: out of the lists, old shots keep it) or back. Never deleted. */
  async function archiveGrinder(b: ObjectData) {
    const id = text(b.id);
    if (typeof b.archived !== "boolean") throw new Error("invalidArguments");
    if (!(await grinderList(true)).some((g) => text(g.id) === id)) throw new Error("grinderNotFound");
    return { grinder: grinderRow(object(await local(`/grinders/${enc(id)}`, "PUT", { archived: b.archived }))) };
  }
  /**
   * A water added to the list (at its top), or one renamed in place (`previous`). Only the list changes: shots keep
   * the water they were made with.
   */
  async function saveWater(b: ObjectData) {
    const name = waterName(b.name);
    if (!name || (b.previous != null && typeof b.previous !== "string")) throw new Error("invalidArguments");
    const same = (x: string, y: string) => unaccented(x) === unaccented(y);
    const list = await waters();
    const previous = waterName(b.previous);
    const at = previous ? list.findIndex((x) => same(x, previous)) : -1;
    if (previous && at < 0) throw new Error("notFound");
    if (list.some((x, i) => i !== at && same(x, name))) throw new Error("waterExists");
    const next = at >= 0 ? list.map((x, i) => i === at ? name : x) : [name, ...list].slice(0, WATERS_MAX);
    await local(WATERS, "POST", next);
    watersKnown = next;
    return { waters: next };
  }
  /** A water off the list; shots made with it keep it. */
  async function removeWater(b: ObjectData) {
    const name = waterName(b.name);
    if (!name) throw new Error("invalidArguments");
    const list = await waters();
    const next = list.filter((x) => unaccented(x) !== unaccented(name));
    if (next.length === list.length) throw new Error("notFound");
    await local(WATERS, "POST", next);
    watersKnown = next;
    return { waters: next };
  }

  // ── The next shot ──
  const nextOf = (context: ObjectData): Next => ({
    grinderId: text(context.grinderId) || null, grinderModel: text(context.grinderModel), grind: text(context.grinderSetting),
    rpm: shotRpm(context) ?? null, water: waterName(tagOf(context).water),
    lockRatio: optionalObject(context.extras).lockRatio === true,
  });
  /**
   * The workflow written by the plugin: whatever it sets of the coffee, grinder and speed also goes in the kept gear,
   * so Streamline's clean-up after the next shot puts back what the user chose here.
   */
  async function putNext(context: ObjectData, profile?: ObjectData, ratioChange: RatioChange = {}) {
    const gear: ObjectData = {};
    for (const k of GEAR_KEYS) if (k in context) gear[k] = context[k] ?? null;
    const extras = optionalObject(context.extras);
    if ("rpm" in extras) gear.rpm = extras.rpm ?? null;
    const tag = optionalObject(extras.beanJournal);
    const sent = Object.keys(gear).length ? { ...context, extras: { ...extras, beanJournal: { ...tag, gear: { ...optionalObject(tag.gear), ...gear } } } } : context;
    return ratioMemory.change({ ...(profile ? { profile } : {}), context: sent }, ratioChange);
  }
  async function current(workflow?: ObjectData) {
    workflow ??= object(await local("/workflow"));
    const context = optionalObject(workflow.context);
    const batchId = text(context.beanBatchId);
    let coffee: Coffee | null = null;
    try { coffee = batchId ? await coffeeOfBatch(localId(batchId)) : null; } catch { /* Decaid busy: the names still say it */ }
    return { coffee, coffeeName: text(context.coffeeName), coffeeRoaster: text(context.coffeeRoaster) };
  }
  async function status() {
    let workflow: ObjectData | null = null;
    try { workflow = object(await local("/workflow")); } catch { /* Decaid busy; the page retries */ }
    const context = optionalObject(workflow?.context);
    const now = workflow ? await current(workflow) : { coffee: null, coffeeName: "", coffeeRoaster: "" };
    return {
      version: VERSION, ...now, next: workflow ? nextOf(context) : null,
      dose: number(context.targetDoseWeight) ?? null, yield: number(context.targetYield) ?? null,
      onCoffeeChoice: onCoffeeChoice(), mcp: mcpLevel(), mcpPublic: mcpPublicLevel(),
    };
  }
  async function notBrewing() {
    let phase: unknown;
    try { phase = optionalObject(object(await local("/machine/state")).state).state; } catch { return; /* no machine connected */ }
    if (phase === "espresso") throw new Error("machineBusy");
  }
  async function idle() {
    let snapshot: ObjectData;
    try { snapshot = object(await local("/machine/state")); } catch (e) {
      // No machine connected: nothing can be brewing.
      if (e instanceof Error && ["notFound", "requestFailed"].includes(e.message)) return;
      throw e;
    }
    const phase = optionalObject(snapshot.state).state;
    if (phase !== "idle" && phase !== "schedIdle" && phase !== "sleeping") throw new Error("machineBusy");
  }
  /** The next shot's coffee; a known coffee/profile pair restores its ratio choice. */
  async function selectCoffee(coffeeId: unknown) {
    await notBrewing();
    const coffee = coffeeId == null ? null : await bagged(await coffeeById(coffeeId));
    await putNext(coffeeContext(coffee));
    return coffee;
  }

  // Streamline (DYE2 on) clears the coffee, the grinder and its speed after each shot; the next shot's choice stays
  // until the user changes it. The last seen is kept in `extras.beanJournal.gear`, which Streamline leaves alone, and
  // put back; the shot's own gear is the fallback.
  const gearOf = (context: ObjectData): Gear => ({
    beanBatchId: text(context.beanBatchId) || null, coffeeName: text(context.coffeeName) || null, coffeeRoaster: text(context.coffeeRoaster) || null,
    grinderId: text(context.grinderId) || null, grinderModel: text(context.grinderModel) || null, rpm: shotRpm(context) ?? null,
  });
  const keptGear = (context: ObjectData) => optionalObject(tagOf(context).gear);
  /** What of `from` the context lacks: the coffee when it has none, the grinder and speed each when missing. */
  async function restore(context: ObjectData, from: ObjectData) {
    const put: ObjectData = {};
    if (!text(context.coffeeName) && !context.beanBatchId && (text(from.coffeeName) || text(from.beanBatchId))) {
      for (const k of COFFEE_KEYS) put[k] = text(from[k]) || null;
    }
    if (!text(context.grinderId) && !text(context.grinderModel) && (text(from.grinderId) || text(from.grinderModel))) {
      Object.assign(put, { grinderId: text(from.grinderId) || null, grinderModel: text(from.grinderModel) || null });
    }
    const rpm = shotRpm({ extras: { rpm: from.rpm } });
    if (shotRpm(context) === undefined && rpm !== undefined) put.extras = { rpm };
    if (Object.keys(put).length) await local("/workflow", "PUT", { context: put });
  }
  async function keepCoffee(shotId?: string) {
    const context = optionalObject(object(await local("/workflow")).context);
    let from: ObjectData = keptGear(context);
    const noGear = !text(from.grinderId) && !text(from.grinderModel) && number(from.rpm) === undefined;
    if (noGear && shotId) {
      try {
        const was = optionalObject(optionalObject(object(await local(`/shots/${enc(shotId)}`)).workflow).context);
        from = { ...from, grinderId: was.grinderId, grinderModel: was.grinderModel, rpm: shotRpm(was) ?? null };
      } catch { /* gone: nothing to keep */ }
    }
    await restore(context, from);
    await ratioMemory.follow();
  }
  /**
   * Streamline's clean-up is undone: within a while after a shot (and after the plugin starts) whatever went missing
   * comes back, and at any time the coffee, grinder and speed all gone together (its clean-up when the skin starts).
   * Any other change of coffee, grinder or speed (the page, DYE2, Decaid, the user clearing one in Streamline) becomes
   * what is kept. Read from Decaid a moment after the change rather than from the event.
   */
  let gearTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanUpUntil = 0;
  const CLEAN_UP_MS = 30000;
  function followGearSoon() {
    clearTimeout(gearTimer);
    gearTimer = setTimeout(() => { serial(followGear).catch(log("gear")); }, 700);
  }
  async function followGear() {
    if (stopped) return;
    const context = optionalObject(object(await local("/workflow")).context);
    const backup = keptGear(context), now = gearOf(context);
    const coffeeGone = !now.coffeeName && !now.beanBatchId;
    const none = !now.grinderId && !now.grinderModel && now.rpm === null;
    const hadCoffee = !!(text(backup.coffeeName) || text(backup.beanBatchId));
    const hadGear = !!(text(backup.grinderId) || text(backup.grinderModel) || number(backup.rpm) !== undefined);
    const cleanUp = Date.now() < cleanUpUntil || (coffeeGone && none && hadCoffee && hadGear);
    const kept: Gear = !cleanUp ? now : {
      ...(coffeeGone ? { beanBatchId: text(backup.beanBatchId) || null, coffeeName: text(backup.coffeeName) || null, coffeeRoaster: text(backup.coffeeRoaster) || null }
        : { beanBatchId: now.beanBatchId, coffeeName: now.coffeeName, coffeeRoaster: now.coffeeRoaster }),
      ...(none ? { grinderId: text(backup.grinderId) || null, grinderModel: text(backup.grinderModel) || null, rpm: number(backup.rpm) ?? null }
        : { grinderId: now.grinderId, grinderModel: now.grinderModel, rpm: now.rpm }),
    };
    const same = (Object.keys(kept) as (keyof Gear)[]).every((k) => (k === "rpm" ? number(backup.rpm) ?? null : text(backup[k]) || null) === kept[k]);
    if (!same) await local("/workflow", "PUT", { context: { extras: { beanJournal: { gear: kept } } } });
    if (cleanUp) await restore(context, kept);
    await ratioMemory.follow();
  }
  /**
   * Stock Streamline sends its cached copy of the profile with every dose or drink change (− / +, the numpad, the
   * scale, keep ratio), with the profile's own temperatures: a Brew change is undone by the next dose. Seen as the
   * same profile and steps with only the temperatures back, together with a new dose or drink and nothing else, the
   * temperatures from before are put back (the new drink weight stays).
   */
  let brewTimer: ReturnType<typeof setTimeout> | undefined;
  function keepBrewTempSoon() {
    clearTimeout(brewTimer);
    brewTimer = setTimeout(() => { keepBrewTemp().catch(log("brew temperature")); }, 250);
  }
  async function keepBrewTemp() {
    if (stopped) return;
    const now = object(await local("/workflow"));
    const before = seenWorkflow;
    seenWorkflow = now;
    if (!before || Date.now() - ownTempsAt < 3000) return;
    const was = optionalObject(before.profile), is = optionalObject(now.profile);
    if (!text(is.title) || text(is.title) !== text(was.title)) return;
    const wasTemps = stepTemps(was), isTemps = stepTemps(is);
    if (!wasTemps.length || wasTemps.length !== isTemps.length || wasTemps.join() === isTemps.join() || wasTemps.includes(null)) return;
    const shape = (p: ObjectData) => JSON.stringify(items(p.steps).map((step) => ({ ...step, temperature: null })));
    if (shape(was) !== shape(is)) return;
    const a = optionalObject(before.context), b = optionalObject(now.context);
    const moved = number(a.targetDoseWeight) !== number(b.targetDoseWeight) || number(a.targetYield) !== number(b.targetYield);
    const rest = (c: ObjectData) => JSON.stringify({ ...c, targetDoseWeight: null, targetYield: null, extras: null });
    if (!moved || rest(a) !== rest(b)) return;
    const profile = { ...is, steps: items(is.steps).map((step, i) => ({ ...step, temperature: wasTemps[i] })) };
    const saved = optionalObject(await local("/workflow", "PUT", { profile }));
    seenWorkflow = saved.profile ? saved : { ...now, profile };
  }

  const ratioMemory = createRatioMemory({
    readWorkflow: async () => object(await local("/workflow")),
    writeWorkflow: async (patch) => {
      const saved = optionalObject(await local("/workflow", "PUT", patch));
      return saved.context ? saved : null;
    },
    readMemory: async () => {
      try { return await local(RATIOS); } catch (e) {
        if (e instanceof Error && e.message === "notFound") return null;
        throw e;
      }
    },
    writeMemory: async (data) => { await local(RATIOS, "POST", data); },
    coffeeKey: async (workflow) => {
      const id = text(optionalObject(workflow.context).beanBatchId);
      if (!id) return null;
      if (!beanOfBatch.has(id)) {
        const batch = object(await local(`/bean-batches/${enc(localId(id))}`));
        beanOfBatch.set(id, localId(batch.beanId));
      }
      return beanOfBatch.get(id)!;
    },
  });
  /** The skin's Ratio mode and Keep ratio pill (stock Streamline's `call`): `{ratio}` sets the drink weight, `{lock}` the lock. */
  async function ratioCall(b: ObjectData) {
    if ("lock" in b) {
      if (b.lock !== 0 && b.lock !== 1) throw new Error("invalidArguments");
      await notBrewing();
      await ratioMemory.change({ context: { extras: { lockRatio: b.lock === 1 } } }, { explicit: true });
      return { lock: b.lock };
    }
    const ratio = number(b.ratio);
    if (ratio === undefined || ratio < 1 || ratio > 20) throw new Error("invalidArguments");
    await notBrewing();
    const saved = await ratioMemory.change((workflow) => {
      const dose = number(optionalObject(workflow.context).targetDoseWeight);
      if (!dose || dose <= 0) throw new Error("invalidArguments");
      const yieldG = round1(dose * ratio);
      if (yieldG < 1 || yieldG > 2000) throw new Error("invalidArguments");
      return { context: { targetYield: yieldG } };
    }, { ratio });
    const context = object(saved.context);
    return { ratio: round1(Number(context.targetYield) / Number(context.targetDoseWeight)), yield: context.targetYield };
  }

  // ── Streamline's surfaces ──
  /** The grind of the newest shot of a coffee, kept a minute (and until the next shot). */
  let lastGrind: { at: number; coffee: string; grind: string } | null = null;
  async function lastGrindOf(coffee: string) {
    if (lastGrind?.coffee === coffee && Date.now() - lastGrind.at < 60000) return lastGrind.grind;
    const top = items(object(await local(`/shots?limit=1&offset=0&order=desc&coffeeName=${enc(coffee)}`)).items)[0];
    const grind = text(optionalObject(optionalObject(top?.workflow).context).grinderSetting).trim();
    lastGrind = { at: Date.now(), coffee, grind };
    return grind;
  }
  /** The skin waits 2 s at most, so this reads only the workflow and (kept a minute) the coffee's last grind. */
  async function skinAnswer() {
    const workflow = await ratioMemory.follow();
    const context = optionalObject(workflow.context);
    const name = text(context.coffeeName) || (!context.beanBatchId ? text(keptGear(context).coffeeName) : "");
    let grind = "";
    if (name) try { grind = await lastGrindOf(name); } catch { /* Decaid busy: no hint this time */ }
    const answer = skinSurfaces({ s: copy().skin, workflow, kept: ratioMemory.kept, lastGrind: grind, now: Date.now() });
    lastSkin = answer;
    return answer;
  }
  /**
   * A skin that just started reads `skin` while Decaid is busy; a read that misses draws no button until its next
   * look. A fresh answer that takes more than a second is replaced by the last one, and the fresh one is pushed
   * (`live`) when it's in.
   */
  let lastSkin: ObjectData | null = null;
  let skinRead: Promise<ObjectData> | null = null;
  async function skinQuick() {
    const fresh = skinRead ??= skinAnswer().finally(() => { skinRead = null; });
    if (!lastSkin) return fresh;
    const before = lastSkin;
    let wait: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => { wait = setTimeout(() => resolve(null), 1000); });
    const first = await Promise.race([fresh.then((a) => a, () => null), late]);
    clearTimeout(wait);
    if (first) return first;
    void fresh.then(() => { try { host.emit?.("changed", { what: "skin" }); } catch { /* the next look */ } }, () => { /* the next look */ });
    return before;
  }

  // ── Shots ──
  /** The shot as the page shows it, with the bean of its batch. */
  async function described(raw: ObjectData) {
    const summary = shotSummary(raw);
    return { ...summary, beanId: await beanIdOf(summary.coffeeId) };
  }
  async function shotAt(id: string) {
    return described(object(await local(`/shots/${enc(id)}`)));
  }
  /** Which shots the page walks through: all, or those of one coffee and/or one profile (Decaid's own filters). */
  function shotFilter(f: unknown) {
    const o = optionalObject(f), q: string[] = [];
    for (const key of ["coffeeName", "coffeeRoaster", "profileTitle"] as const) {
      const v = text(o[key]).trim().slice(0, 120);
      if (v) q.push(`${key}=${enc(v)}`);
    }
    if (o.beanId != null) q.push(`beanId=${enc(localId(o.beanId))}`);
    return q.length ? `&${q.join("&")}` : "";
  }
  async function shot(offset: unknown, filter?: unknown, shotId?: unknown) {
    let n = Number.isInteger(offset) && Number(offset) >= 0 && Number(offset) < 100000 ? Number(offset) : 0;
    // A given shot (Streamline's history menu): its place among the set, newest first, found a page at a time. The
    // tablet may hold thousands; a shot not found in the set is still the one shown, never the newest instead.
    const wanted = text(shotId) ? localId(shotId) : "";
    if (wanted) {
      let found = false;
      for (let pageAt = 0; pageAt < 1000 && !found; pageAt++) {
        const ids = items(object(await local(`/shots?limit=100&offset=${pageAt * 100}&order=desc${shotFilter(filter)}`)).items).map((x) => text(x.id));
        const at = ids.indexOf(wanted);
        if (at >= 0) { n = pageAt * 100 + at; found = true; }
        if (ids.length < 100) break;
      }
      if (!found) return { offset: n, older: false, shot: await shotAt(wanted) };
    }
    const list = items(object(await local(`/shots?limit=2&offset=${n}&order=desc${shotFilter(filter)}`)).items);
    if (!list.length) return { offset: n, older: false, shot: null };
    return { offset: n, older: list.length > 1, shot: await shotAt(localId(list[0].id)) };
  }
  /** Shots to compare with or to load: the newest of the same set, short (no curves), the one on screen left out. */
  async function shotList(filter: unknown, except?: unknown, limit = 30): Promise<ShotLine[]> {
    const skip = text(except);
    const list = items(object(await local(`/shots?limit=${limit + 1}&offset=0&order=desc${shotFilter(filter)}`)).items);
    return list.filter((s) => text(s.id) !== skip).slice(0, limit).map(shotLine);
  }
  const coffeeHistory = createCoffeeHistory<ObjectData>({
    readShots: async (offset, limit) => items(object(await local(`/shots?limit=${limit}&offset=${offset}&order=desc`)).items),
    readShotIds: async () => {
      const ids = await local("/shots/ids");
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)) throw new Error("invalidData");
      return ids;
    },
    readShot: async (id) => {
      try { return object(await local(`/shots/${enc(id)}`)); }
      catch (error) {
        if (error instanceof Error && error.message === "notFound") return null;
        throw error;
      }
    },
    shotId: (shot) => text(shot.id),
    coffeeId: (shot) => text(optionalObject(optionalObject(shot.workflow).context).beanBatchId) || null,
    brewedAt: (shot) => isBrew(shotKind(optionalObject(optionalObject(shot.workflow).profile))) ? Date.parse(text(shot.timestamp)) : null,
    readMemory: async () => {
      try { return await local(COFFEE_HISTORY); }
      catch (error) {
        if (error instanceof Error && error.message === "notFound") return null;
        throw error;
      }
    },
    writeMemory: async (data) => { await local(COFFEE_HISTORY, "POST", data); },
    onError: log("coffee history"),
  });
  async function orderedCoffees(retry: boolean) {
    const [s, history] = await Promise.all([readShelf(), coffeeHistory.snapshot({ retry })]);
    const workflow = object(await local("/workflow"));
    return { history: history.status, selectedId: text(optionalObject(workflow.context).beanBatchId) || null, coffees: sortCoffees(s.coffees, {
      coffeeId: (coffee) => coffee.id, isFinished: (coffee) => coffee.finished,
      selectedId: text(optionalObject(workflow.context).beanBatchId) || null, lastBrewed: history.lastBrewed,
    }) };
  }
  /** A coffee's newest brew and its best rated one (the newest of equals). */
  function lastAndBest(shots: ShotLine[]) {
    const brews = shots.filter((s) => isBrew(s.kind));
    const best = brews.filter((s) => s.score !== null).reduce<ShotLine | null>((a, s) => !a || s.score! > a.score! ? s : a, null);
    return { last: brews[0] ?? null, best };
  }
  async function coffeeDetail(id: unknown) {
    const coffee = await coffeeById(id);
    const s = await readShelf();
    const bags = s.coffees.filter((c) => c.beanId === coffee.beanId);
    const shots = await shotList({ beanId: coffee.beanId });
    const { last, best } = lastAndBest(shots);
    return { coffee, bags: bags.length ? bags : [coffee], shots, last: last?.id ?? null, best: best?.id ?? null };
  }
  async function deleteShot(b: ObjectData) {
    if (b.confirmed !== true) throw new Error("confirmation");
    const id = localId(b.shotId);
    try { await local(`/shots/${enc(id)}`, "DELETE"); } catch (e) { if (!(e instanceof Error) || e.message !== "notFound") throw e; }
    latestMemo.clear();
    lastGrind = null;
    return { deleted: true };
  }
  /**
   * The shot's taste, body, water and RPM in its notes' block, when the user asked for it (Settings): Decaid's own
   * Visualizer plugin sends the notes, which is how they reach Visualizer.
   */
  async function writeNotesBlock(id: string) {
    if (!visualizerNotes()) return;
    const raw = object(await local(`/shots/${enc(id)}`));
    if (!isBrew(shotKind(optionalObject(optionalObject(raw.workflow).profile)))) return;
    const patch = notesBlockPatch(raw);
    if (patch) await local(`/shots/${enc(id)}`, "PUT", { annotations: patch });
  }
  async function rateShot(b: ObjectData) {
    const id = localId(b.shotId);
    const annotations: ObjectData = {}, tag: ObjectData = {}, context: ObjectData = {};
    if ("score" in b) {
      if (b.score !== null && (!Number.isInteger(b.score) || Number(b.score) < 0 || Number(b.score) > 100)) throw new Error("invalidArguments");
      annotations.enjoyment = b.score === null ? null : Number(b.score) / 10;
    }
    if ("balance" in b) {
      if (b.balance !== null && !(BALANCES as readonly unknown[]).includes(b.balance)) throw new Error("invalidArguments");
      tag.balance = b.balance;
    }
    if ("body" in b) {
      if (b.body !== null && !(BODIES as readonly unknown[]).includes(b.body)) throw new Error("invalidArguments");
      tag.body = b.body;
    }
    if ("water" in b) {
      if (b.water !== null && typeof b.water !== "string") throw new Error("invalidArguments");
      tag.water = waterName(b.water) || null;
    }
    if (Object.keys(tag).length) annotations.extras = { beanJournal: tag };
    // The grinder, its setting and speed are the shot's workflow context, as DYE2 writes them.
    if ("rpm" in b) {
      if (b.rpm !== null && (!Number.isInteger(b.rpm) || Number(b.rpm) < 1 || Number(b.rpm) > 5000)) throw new Error("invalidArguments");
      context.extras = { rpm: b.rpm };
    }
    for (const [field, key, max] of [["grinderModel", "grinderModel", 80], ["grind", "grinderSetting", 60]] as const) {
      if (!(field in b)) continue;
      if (b[field] !== null && typeof b[field] !== "string") throw new Error("invalidArguments");
      context[key] = text(b[field]).trim().slice(0, max) || null;
    }
    if ("grinderId" in b) {
      if (b.grinderId === null) context.grinderId = null;
      else {
        // One of Decaid's grinders (a put-away one too: an old shot may have used it); its model unless one is given.
        const grinder = (await grinderList(true)).find((g) => text(g.id) === b.grinderId);
        if (typeof b.grinderId !== "string" || !grinder) throw new Error("grinderNotFound");
        context.grinderId = text(grinder.id);
        if (!("grinderModel" in b)) context.grinderModel = text(grinder.model).slice(0, 80) || null;
      }
    }
    // A reading of 0 or none is no reading: it clears the field.
    for (const [field, key, max] of [["tds", "drinkTds", 30], ["ey", "drinkEy", 100]] as const) {
      if (!(field in b)) continue;
      const value = b[field] === null ? null : number(b[field]);
      if (value === undefined || (value !== null && (value < 0 || value > max))) throw new Error("invalidArguments");
      annotations[key] = value && value > 0 ? value : null;
    }
    for (const [field, key, max] of [["dose", "actualDoseWeight", 200], ["yield", "actualYield", 2000]] as const) {
      if (!(field in b)) continue;
      const value = b[field] === null ? null : number(b[field]);
      if (value === undefined || (value !== null && (value <= 0 || value > max))) throw new Error("invalidArguments");
      annotations[key] = value;
    }
    if ("notes" in b) {
      if (b.notes !== null && (typeof b.notes !== "string" || b.notes.length > 10000)) throw new Error("invalidArguments");
      // The user edits their own notes: the block stays after them.
      const raw = object(await local(`/shots/${enc(id)}`));
      const kept = notesWithBlock(optionalObject(raw.annotations), text(b.notes));
      annotations.espressoNotes = kept.espressoNotes;
      if (kept.extras) annotations.extras = { beanJournal: { ...tag, ...optionalObject(optionalObject(kept.extras).beanJournal) } };
    }
    const hasAnnotations = Object.keys(annotations).length > 0, hasContext = Object.keys(context).length > 0;
    if (!hasAnnotations && !hasContext) throw new Error("invalidArguments");
    await local(`/shots/${enc(id)}`, "PUT", {
      ...(hasAnnotations ? { annotations } : {}), ...(hasContext ? { workflow: { context } } : {}),
    });
    if (["balance", "body", "water", "rpm", "notes"].some((k) => k in b)) await writeNotesBlock(id);
    if (typeof tag.water === "string") await rememberWater(tag.water);
    return { shot: await shotAt(id) };
  }
  async function assignCoffee(shotId: unknown, coffeeId: unknown) {
    const id = localId(shotId);
    const coffee = coffeeId == null ? null : await bagged(await coffeeById(coffeeId));
    await local(`/shots/${enc(id)}`, "PUT", { workflow: { context: coffeeContext(coffee) } });
    return { shot: await shotAt(id) };
  }
  /**
   * The grinder, its speed, the water and the ratio lock for the next shot, when named (`grinderId`: one of Decaid's
   * grinders, null: none; `grinderModel` alone: a grinder Decaid doesn't know; `rpm`: 1–5000; `water`: text).
   */
  async function nextGrinder(b: ObjectData): Promise<{ context: ObjectData; extras: ObjectData; tag: ObjectData }> {
    const context: ObjectData = {}, extras: ObjectData = {}, tag: ObjectData = {};
    if (b.lockRatio !== undefined) {
      if (typeof b.lockRatio !== "boolean") throw new Error("invalidArguments");
      extras.lockRatio = b.lockRatio;
    }
    if (b.grinderId === null) Object.assign(context, { grinderId: null, grinderModel: null });
    else if (b.grinderId !== undefined) {
      if (typeof b.grinderId !== "string") throw new Error("invalidArguments");
      const grinder = (await grinderList()).find((g) => text(g.id) === b.grinderId);
      if (!grinder) throw new Error("grinderNotFound");
      Object.assign(context, { grinderId: text(grinder.id), grinderModel: text(grinder.model).slice(0, 80) || null });
    } else if (b.grinderModel !== undefined) {
      if (b.grinderModel !== null && typeof b.grinderModel !== "string") throw new Error("invalidArguments");
      Object.assign(context, { grinderId: null, grinderModel: text(b.grinderModel).trim().slice(0, 80) || null });
    }
    if (b.rpm !== undefined) {
      if (b.rpm !== null && (!Number.isInteger(b.rpm) || Number(b.rpm) < 1 || Number(b.rpm) > 5000)) throw new Error("invalidArguments");
      extras.rpm = b.rpm;
    }
    if (b.water !== undefined) {
      if (b.water !== null && typeof b.water !== "string") throw new Error("invalidArguments");
      tag.water = waterName(b.water) || null;
    }
    return { context, extras, tag };
  }
  const withTag = (extras: ObjectData, tag: ObjectData) => Object.keys(tag).length ? { ...extras, beanJournal: { ...optionalObject(extras.beanJournal), ...tag } } : extras;
  /** The next shot's coffee and gear, in one write so an explicit lock wins over the coffee's memory. */
  async function nextSettings(b: ObjectData) {
    if (b.grind != null && typeof b.grind !== "string") throw new Error("invalidArguments");
    const grinder = await nextGrinder(b);
    if (!Object.keys(grinder.context).length && !Object.keys(grinder.extras).length && !Object.keys(grinder.tag).length
      && b.grind === undefined && b.coffeeId === undefined) {
      throw new Error("invalidArguments");
    }
    await notBrewing();
    const coffee = b.coffeeId == null ? null : await bagged(await coffeeById(b.coffeeId));
    const saved = await putNext({
      ...(b.coffeeId !== undefined ? coffeeContext(coffee) : {}),
      ...grinder.context, extras: withTag(grinder.extras, grinder.tag),
      ...(b.grind !== undefined ? { grinderSetting: text(b.grind).trim().slice(0, 60) || null } : {}),
    }, undefined, { explicit: b.lockRatio !== undefined });
    await rememberWater(text(grinder.tag.water));
    return { next: nextOf(optionalObject(saved.context)), ...(b.coffeeId !== undefined ? { coffee } : {}) };
  }
  /**
   * A shot's settings for the next one: its profile as it ran, its dose, the weight it stopped at, its grinder, its
   * speed, grind and water, and the coffee when one is named. It never starts a shot.
   */
  async function loadShot(shotId: unknown, coffeeId: unknown) {
    const raw = object(await local(`/shots/${enc(localId(shotId))}`));
    const workflow = object(raw.workflow), profile = object(workflow.profile);
    if (!isBrew(shotKind(profile))) throw new Error("notABrew");
    const was = optionalObject(workflow.context), annotations = optionalObject(raw.annotations);
    const dose = number(annotations.actualDoseWeight) ?? number(was.targetDoseWeight);
    const target = number(was.targetYield);
    const yieldG = target && target > 0 ? target : number(annotations.actualYield);
    if (!dose || dose <= 0 || dose > 200 || !yieldG || yieldG <= 0 || yieldG > 2000) throw new Error("invalidData");
    const coffee = coffeeId != null ? await bagged(await coffeeById(coffeeId)) : null;
    await idle();
    // The shot's water when it named one (null: cleared on it); so too its grinder, speed and grind (a shot made after
    // Streamline cleared them has none, and loading it mustn't clear the kept ones).
    const water = shotWater(annotations, was);
    const rpm = shotRpm(was);
    const grinder = text(was.grinderId) || text(was.grinderModel) ? { grinderModel: text(was.grinderModel) || null, grinderId: text(was.grinderId) || null } : {};
    const saved = await putNext({
      ...(coffee ? coffeeContext(coffee) : {}),
      extras: withTag({ ...(rpm !== undefined ? { rpm } : {}),
        ...(typeof optionalObject(was.extras).lockRatio === "boolean" ? { lockRatio: optionalObject(was.extras).lockRatio } : {}) }, water !== undefined ? { water } : {}),
      targetDoseWeight: Math.round(dose * 10) / 10, targetYield: Math.round(yieldG * 10) / 10,
      ...(text(was.grinderSetting) ? { grinderSetting: text(was.grinderSetting) } : {}), ...grinder,
    }, { ...profile, target_weight: round1(yieldG) }, { explicit: true });
    return { next: nextOf(optionalObject(saved.context)), coffee: (await current(saved)).coffee };
  }
  /** The coffee for the next shot, and with "last" or "best" that coffee's newest or best rated brew's settings. */
  async function chooseCoffee(b: ObjectData) {
    const how = b.settings === undefined || b.settings === null ? onCoffeeChoice() : text(b.settings);
    if (!["keep", "last", "best"].includes(how)) throw new Error("invalidArguments");
    const coffee = await bagged(await coffeeById(b.coffeeId));
    const shots = how === "keep" ? [] : await shotList({ beanId: coffee.beanId });
    const { last, best } = lastAndBest(shots);
    const chosen = how === "best" ? best ?? last : last;
    if (chosen) await loadShot(chosen.id, coffee.id);
    else await selectCoffee(coffee.id);
    return { coffee: await coffeeById(coffee.id), loaded: chosen?.id ?? null };
  }

  // ── For AI assistants (MCP) ──
  /** A coffee's dial-in in one answer: the coffee (the next shot's by default), its recent shots, the next shot. */
  async function dialIn(coffeeId: unknown) {
    const workflow = object(await local("/workflow"));
    const coffee = coffeeId != null ? await coffeeById(coffeeId) : (await current(workflow)).coffee;
    const shots = coffee ? await shotList({ beanId: coffee.beanId }, null, 10) : await shotList({}, null, 5);
    return { coffee, shots, next: nextOf(optionalObject(workflow.context)) };
  }
  /** The grinders and waters in one answer; a part that fails says so alone. */
  async function equipment() {
    const soft = async <T>(task: () => Promise<T>): Promise<T | { error: string }> => { try { return await task(); } catch (e) { return { error: message(e) }; } };
    const [grinders, waterList] = await Promise.all([soft(async () => (await grinderList()).map(grinderView)), soft(waters)]);
    return { grinders, waters: waterList };
  }
  const madeBy = (p: ObjectData) => optionalObject(optionalObject(p.metadata).beanJournal).madeBy === "assistant" ? "assistant" : null;
  const brief = (p: ObjectData) => {
    const profile = optionalObject(p.profile);
    return { id: text(p.id), title: text(profile.title), author: text(profile.author), kind: shotKind(profile), beverageType: text(profile.beverage_type),
      visibility: text(p.visibility) || "visible", madeBy: madeBy(p) };
  };
  async function profileList() {
    return { profiles: items(await local("/profiles")).map(brief) };
  }
  async function profileOne(profileId: unknown) {
    const p = object(await local(`/profiles/${enc(profileIdOf(profileId))}`));
    return { ...brief(p), isDefault: p.isDefault === true, updatedAt: p.updatedAt, parentId: p.parentId ?? null,
      profile: p.profile, beanJournal: optionalObject(optionalObject(p.metadata).beanJournal) };
  }
  /**
   * An assistant's own profile design, saved on the tablet. A title in use is answered as `duplicates` (the assistant
   * asks the user); only a profile an assistant made may be replaced. Decaid answers an identical design with the
   * record it has (the user's, maybe): that one is left as it is.
   */
  async function createProfile(b: ObjectData) {
    const payload = designedProfile(b);
    const title = text(payload.profile.title);
    const all = items(await local("/profiles?includeHidden=true"));
    if (b.replaceProfileId != null) {
      const pid = profileIdOf(b.replaceProfileId);
      const old = all.find((p) => p.id === pid);
      if (!old) throw new Error("notFound");
      if (madeBy(old) !== "assistant") throw new Error("notAssistantProfile");
      const updated = await updateProfile({ ...b, profileId: pid, expectedUpdatedAt: old.updatedAt, title,
        author: payload.profile.author, notes: payload.profile.notes, beverageType: payload.profile.beverage_type });
      return updated.updated ? { ...updated, replaced: pid } : updated;
    }
    const named = all.filter((p) => p.visibility !== "deleted" && normTitle(optionalObject(p.profile).title) === normTitle(title));
    if (named.length && b.saveNew !== true) return { duplicates: named.map(brief) };
    const matching = all.find((p) => profileExecution(object(p.profile)) === profileExecution(payload.profile));
    if (matching) return { existing: true, profile: brief(matching) };
    const record = object(await local("/profiles", "POST", payload));
    if (all.some((p) => p.id === record.id) || madeBy(record) !== "assistant" || text(optionalObject(record.profile).title) !== title) return { existing: true, profile: brief(record) };
    const pid = profileIdOf(record.id);
    if (text(record.visibility) && record.visibility !== "visible") await local(`/profiles/${enc(pid)}/visibility`, "PUT", { visibility: "visible" });
    return { made: true, profile: { ...brief(record), visibility: "visible" } };
  }
  async function updateProfile(b: ObjectData): Promise<ObjectData> {
    const pid = profileIdOf(b.profileId);
    const saved = object(await local(`/profiles/${enc(pid)}`));
    if (typeof b.expectedUpdatedAt !== "string" || !b.expectedUpdatedAt) throw new Error("invalidArguments");
    if (saved.updatedAt !== b.expectedUpdatedAt) throw new Error("profileChanged");
    if (saved.visibility === "deleted") throw new Error("notFound");
    const original = object(saved.profile);
    const profile = editedProfile(b, original);
    if (Object.keys(b).every((k) => ["action", "profileId", "expectedUpdatedAt", "saveNew", "confirmed"].includes(k))) throw new Error("invalidArguments");
    if ("dose" in b && b.dose !== null && (number(b.dose) === undefined || Number(b.dose) < 1 || Number(b.dose) > 100)) throw new Error("invalidArguments");
    const executionChanged = profileExecution(profile) !== profileExecution(original);
    const metadata = optionalObject(saved.metadata), oldTag = optionalObject(metadata.beanJournal);
    const tag = { ...oldTag, ...("dose" in b ? { dose: b.dose } : {}) };
    const payload = { profile, metadata: { ...metadata, beanJournal: tag } };
    const all = items(await local("/profiles?includeHidden=true"));
    const named = all.filter((p) => p.id !== pid && p.visibility !== "deleted" && normTitle(optionalObject(p.profile).title) === normTitle(profile.title));
    if (named.length && b.saveNew !== true) return { duplicates: named.map(brief) };
    if (!executionChanged) {
      const profileChanged = JSON.stringify(profile) !== JSON.stringify(original);
      const metadataChanged = JSON.stringify(tag) !== JSON.stringify(oldTag);
      if (!profileChanged && !metadataChanged) return { unchanged: true, profile: brief(saved) };
      if (saved.isDefault === true && profileChanged) throw new Error("defaultProfile");
      const result = object(await local(`/profiles/${enc(pid)}`, "PUT", {
        ...(profileChanged ? { profile } : {}), ...(metadataChanged ? { metadata: payload.metadata } : {}),
      }));
      return { updated: true, profile: brief(result) };
    }
    // PUT can discard the prior hash. POST + parentId keeps that design as a restorable revision, as the skin does.
    const matching = all.find((p) => profileExecution(object(p.profile)) === profileExecution(profile));
    if (matching) return { existing: true, profile: brief(matching) };
    const result = object(await local("/profiles", "POST", { ...payload, parentId: pid }));
    if (all.some((p) => p.id === result.id)) return { existing: true, profile: brief(result) };
    const nextId = profileIdOf(result.id);
    if (result.visibility !== "visible") await local(`/profiles/${enc(nextId)}/visibility`, "PUT", { visibility: "visible" });
    if (saved.isDefault !== true) await local(`/profiles/${enc(pid)}/visibility`, "PUT", { visibility: "hidden" });
    return { updated: true, previous: pid, profile: { ...brief(result), visibility: "visible" } };
  }
  /**
   * Any profile for the next shot, with a dose and yield (given, else the profile's, else the current ones), and a
   * coffee, grinder, speed and water when named. `ratio` gives the yield from the dose; `temperature` brews the loaded
   * copy at that (its first step; the others move as much), the saved profile untouched. It never starts a shot.
   */
  async function loadProfile(b: ObjectData) {
    const pid = profileIdOf(b.profileId);
    const saved = object(await local(`/profiles/${enc(pid)}`));
    const meta = optionalObject(optionalObject(saved.metadata).beanJournal);
    const temp = b.temperature == null ? undefined : number(b.temperature);
    const ratio = b.ratio == null ? undefined : number(b.ratio);
    if ((b.temperature != null && (temp === undefined || temp < 70 || temp > 100))
      || (b.ratio != null && (ratio === undefined || ratio < 0.5 || ratio > 20)) || (ratio !== undefined && b.yield != null)) {
      throw new Error("invalidArguments");
    }
    let profile = object(saved.profile);
    if (b.grind != null && typeof b.grind !== "string") throw new Error("invalidArguments");
    if (temp !== undefined) {
      const warmer = profileAt(profile, temp);
      if (!warmer) throw new Error("loadTemperature");
      profile = warmer;
    }
    const now = optionalObject(object(await local("/workflow")).context);
    const target = number(profile.target_weight);
    const dose = number(b.dose) ?? number(meta.dose) ?? number(now.targetDoseWeight);
    const yieldG = ratio !== undefined && dose ? dose * ratio
      : number(b.yield) ?? (target && target > 0 ? target : undefined) ?? number(now.targetYield);
    const brew = isBrew(shotKind(profile));
    if (brew && (!dose || dose <= 0 || dose > 100 || !yieldG || yieldG <= 0 || yieldG > 2000)) throw new Error("loadNumbers");
    if (!brew && ["dose", "yield", "ratio", "coffeeId", "grind", "grinderId", "grinderModel", "rpm", "water", "lockRatio"].some((k) => k in b)) throw new Error("invalidArguments");
    const coffee = b.coffeeId != null ? await bagged(await coffeeById(b.coffeeId)) : null;
    const grinder = await nextGrinder(b);
    await idle();
    const answer = await putNext({
      ...(coffee ? coffeeContext(coffee) : {}), ...grinder.context, extras: withTag(grinder.extras, grinder.tag),
      ...(brew ? { targetDoseWeight: Math.round(dose! * 10) / 10, targetYield: Math.round(yieldG! * 10) / 10 } : {}),
      ...(typeof b.grind === "string" ? { grinderSetting: b.grind.trim().slice(0, 60) || null } : {}),
    }, profile, { explicit: ["dose", "yield", "ratio", "lockRatio"].some((key) => b[key] != null), ...(ratio !== undefined ? { ratio } : {}) });
    await rememberWater(text(grinder.tag.water));
    return answer;
  }
  const preferences = () => ({ onCoffeeChoice: onCoffeeChoice(), visualizerNotes: visualizerNotes() });
  async function updatePreferences(b: ObjectData) {
    const names = { onCoffeeChoice: "OnCoffeeChoice", visualizerNotes: "VisualizerNotes" } as const;
    if (Object.keys(b).some((k) => !["action", "confirmed", ...Object.keys(names)].includes(k))) throw new Error("invalidArguments");
    const patch: ObjectData = {};
    if ("onCoffeeChoice" in b) {
      if (!["keep", "last", "best"].includes(text(b.onCoffeeChoice))) throw new Error("invalidArguments");
      patch[names.onCoffeeChoice] = b.onCoffeeChoice;
    }
    if ("visualizerNotes" in b) {
      if (typeof b.visualizerNotes !== "boolean") throw new Error("invalidArguments");
      patch[names.visualizerNotes] = b.visualizerNotes;
    }
    if (!Object.keys(patch).length) throw new Error("invalidArguments");
    // This write reloads the plugin, so local()'s stopped check would misreport a successful save as a failure.
    try { await decaid(`/plugins/${PLUGIN_ID}/settings`, "POST", patch); } catch (e) {
      if (e instanceof Error && e.message === "network") throw e;
      throw new Error("settingsFailed");
    }
    config = { ...config, ...patch };
    return { preferences: preferences(), reloaded: true };
  }
  async function refractometers() {
    return items(await local("/sensors")).filter((s) => {
      const info = optionalObject(s.info);
      const channels = [...items(info.dataChannels ?? []), ...items(info.data ?? [])];
      return items(info.commands ?? []).some((c) => c.id === "measure") && channels.some((c) => c.key === "tds");
    }).map((s) => {
      if (!text(s.id)) throw new Error("invalidData");
      return { id: text(s.id), name: text(optionalObject(s.info).name) };
    }).sort((a, b) => Number(/\bR2\b/i.test(b.name)) - Number(/\bR2\b/i.test(a.name)));
  }
  async function searchRefractometer() {
    await idle();
    await local("/devices/scan?connect=false");
    let sensors = await refractometers();
    for (const wait of [1500, 3000, 4000]) {
      if (sensors.length) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
      sensors = await refractometers();
    }
    return { sensors, preferred: sensors[0]?.id ?? null };
  }
  async function measureTds(b: ObjectData) {
    const id = b.shotId == null ? null : localId(b.shotId);
    if (id) await local(`/shots/${enc(id)}`);
    const sensors = await refractometers();
    const sensor = b.sensorId == null ? sensors[0] : sensors.find((s) => s.id === b.sensorId);
    if (!sensor) throw new Error("sensorNotFound");
    const result = object(await local(`/sensors/${enc(sensor.id)}/execute`, "POST", { commandId: "measure", params: { timeout: 30 } }));
    if (result.status === "error") throw Object.assign(new Error("sensorFailed"), { detail: text(result.message ?? result.error) });
    const reading = object(object(result.result).reading);
    const tds = number(reading.tds);
    if (!tds || tds <= 0 || tds > 30) throw new Error("invalidData");
    const shot = id ? (await serial(() => rateShot({ shotId: id, tds }))).shot : null;
    return { sensor: sensor.id, tds, ...(shot ? { shot } : {}) };
  }
  /** The address an assistant on the home network uses: Decaid's own idea of the tablet's IP, when it has one. */
  async function lanUrl(path: string) {
    try {
      const ip = text(object(await local("/info")).localIp);
      return /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !ip.startsWith("127.") ? `http://${ip}:8080${path}` : null;
    } catch { return null; }
  }
  function response(data: unknown, status = 200) {
    return { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, body: JSON.stringify(data) };
  }
  /** One of the page's actions; the MCP tools run the same ones. Every write goes through the one queue. */
  async function act(b: ObjectData): Promise<unknown> {
    switch (b.action) {
      case "status": return status();
      case "coffees": {
        const value = await orderedCoffees(b.retryHistory === true);
        const search = text(b.search).slice(0, 120);
        return { ...value, coffees: value.coffees.filter((c) => (b.includeFinished === true || !c.finished) && matchesSearch(c, search)) };
      }
      case "coffee": return coffeeDetail(b.id);
      case "save-coffee": return serial(() => saveCoffee(b));
      case "add-bag": return serial(async () => ({ coffee: await newBag(localId(b.beanId), bagOnly(coffeeInput(b.fields))) }));
      case "set-photo": return serial(() => setPhoto(b.beanId, b.photo));
      case "old-bags": return findOldBags();
      case "finish-old-bags": return serial(() => finishOldBags(b));
      case "select": return serial(async () => ({ coffee: await selectCoffee(b.coffeeId ?? null) }));
      case "choose-coffee": return serial(() => chooseCoffee(b));
      case "shot": return shot(b.offset, b.filter, b.shotId);
      case "shots": return { shots: await shotList(b.filter, b.except) };
      case "shot-by-id": return { shot: await shotAt(localId(b.shotId)) };
      // The newest shot's id (of a set), for the page to notice a shot saved after it opened.
      case "latest": {
        const query = shotFilter(b.filter);
        const known = latestMemo.get(query);
        // A shot deleted elsewhere sends no event: the memo is trusted for a short while only.
        if (known && Date.now() - known.at < LATEST_MS) return { id: known.id, timestamp: known.timestamp };
        const top = items(object(await local(`/shots?limit=1&offset=0&order=desc${query}`)).items)[0];
        const found = { at: Date.now(), id: top ? localId(top.id) : null, timestamp: top ? text(top.timestamp) : null };
        if (latestMemo.size > 20) latestMemo.clear();
        latestMemo.set(query, found);
        return { id: found.id, timestamp: found.timestamp };
      }
      case "rate-shot": return serial(() => rateShot(b));
      case "assign-coffee": return serial(() => assignCoffee(b.shotId, b.coffeeId ?? null));
      case "delete-shot": return serial(() => deleteShot(b));
      case "load-shot": return serial(() => loadShot(b.shotId, b.coffeeId));
      case "next-settings": return serial(() => nextSettings(b));
      case "grinders": return b.includeArchived === true ? { grinders: (await grinderList(true)).map(grinderRow) }
        : { grinders: (await grinderList()).map(grinderView) };
      case "save-grinder": return serial(() => saveGrinder(b));
      case "archive-grinder": return serial(() => archiveGrinder(b));
      case "waters": return { waters: await waters() };
      case "save-water": return serial(() => saveWater(b));
      case "remove-water": return serial(() => removeWater(b));
      case "preferences": return { preferences: preferences() };
      case "update-preferences": return updatePreferences(b);
      case "refractometer": {
        const sensors = await refractometers();
        return { sensors, preferred: sensors[0]?.id ?? null };
      }
      case "search-refractometer": return searchRefractometer();
      case "measure-tds": return measureTds(b);
      case "dial-in": return dialIn(b.coffeeId);
      case "equipment": return equipment();
      case "profiles": return profileList();
      case "profile": return profileOne(b.profileId);
      case "create-profile": return serial(() => createProfile(b));
      case "update-profile": return serial(() => updateProfile(b));
      case "load-profile":
        if (b.confirmed !== true) throw new Error("confirmation");
        return serial(() => loadProfile(b));
      // "Copy for AI": the shot as text; the page gives its own words for when it was.
      case "shot-text": return { text: shotText(await shotAt(localId(b.shotId)), text(b.when).slice(0, 60)) };
      // The AI tab: the page shows the tokens to copy; status says only the levels.
      case "mcp": {
        const path = `/api/v1/plugins/${PLUGIN_ID}/mcp`;
        return {
          access: levelOf(config.McpAccess), token: text(config.McpToken), publicAccess: levelOf(config.McpPublicAccess),
          publicToken: text(config.McpPublicToken), publicUrl: text(config.McpPublicUrl), confirm: mcpConfirm(), path, lanUrl: await lanUrl(path),
        };
      }
      default: throw new Error("invalidArguments");
    }
  }
  /** A failure in the page's words, with the status that says whose it was. */
  function explain(e: unknown) {
    const code = e instanceof Error ? e.message : "failed";
    const status = code === "notFound" ? 404 : code === "rateLimit" ? 429 : ["stopped", "notReady"].includes(code) ? 503
      : ["network", "requestFailed", "invalidData", "storageFailed", "settingsFailed", "sensorFailed"].includes(code) ? 502 : 400;
    if (status >= 500) log("request")(e);
    return { status, body: { error: message(e), code } };
  }
  /** Compares in constant time, so the answer's timing doesn't tell how much of a token was right. */
  function sameSecret(given: string, wanted: string) {
    if (!wanted || given.length !== wanted.length) return false;
    let diff = 0;
    for (let i = 0; i < wanted.length; i++) diff |= given.charCodeAt(i) ^ wanted.charCodeAt(i);
    return diff === 0;
  }
  /**
   * AI assistants (MCP, Streamable HTTP answered with JSON, no streams). The token goes in Authorization: Bearer, or
   * as `?token=` for the phone apps' connectors, which can't set headers. Which token decides the level: the home one,
   * or the public one (with at least "ask before changes", since its URL sits with the connector's vendor). Off, or a
   * wrong token, is a bare 404: on a public address it doesn't even say a server is there.
   */
  async function mcp(req: HttpRequest, headers: Record<string, string>): Promise<HttpResponse> {
    const given = /^Bearer\s+(\S+)$/i.exec(headers.authorization ?? "")?.[1] ?? text(req.query?.token);
    const home = mcpLevel(), away = mcpPublicLevel();
    const viaPublic = home === "off" || !sameSecret(given, text(config.McpToken));
    const level = !viaPublic ? home : away !== "off" && sameSecret(given, text(config.McpPublicToken)) ? away : "off";
    if (level === "off") return { status: 404, headers: { "Cache-Control": "no-store" }, body: "" };
    // No server-sent stream to open (GET) and no session to end (DELETE).
    if (req.method !== "POST") return { ...response({}, 405), headers: { ...response({}).headers, Allow: "POST" } };
    const confirm = mcpConfirm();
    const answer = await mcpMessage(req.body, {
      level, version: VERSION, instructions: copy().mcpInstructions,
      confirm: viaPublic && confirm === "none" ? "changes" : confirm,
      allowChange: viaPublic ? publicChanges : homeChanges,
      says: { notAllowed: copy().errors.mcpLevel, tooMany: copy().errors.mcpTooMany, confirm: copy().mcpConfirmSays },
      act: (_action, body) => act(body), explain: (e) => explain(e).body.error,
    });
    if (!answer) return { status: 202, headers: { "Cache-Control": "no-store" }, body: "" };
    return response(answer);
  }
  async function handle(req: HttpRequest): Promise<HttpResponse> {
    const headers = Object.fromEntries(Object.entries(req.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (req.endpoint === "ui" && req.method === "GET") {
      // Skins embed plugin pages from the same tablet on a different port.
      const hostname = /^(localhost|[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])(?::\d{1,5})?$/.exec(headers.host ?? "")?.[1];
      const ancestors = hostname ? `'self' http://${hostname}:* https://${hostname}:*` : "'self'";
      // ws: the embedded page closes itself when a shot starts (Decaid's machine snapshot); older webviews don't
      // count ws: as 'self'.
      const sockets = hostname ? ` ws://${hostname}:* wss://${hostname}:*` : "";
      return { status: 200, headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        // blob: and data: for the photos the page shows, resizes and reads from Decaid's store.
        "Content-Security-Policy": `default-src 'none'; img-src https: data: blob:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'${sockets}; base-uri 'none'; form-action 'none'; frame-ancestors ${ancestors}`,
      }, body: pageHtml ??= page() };
    }
    if (!["control", "mcp", "skin", "ratio"].includes(req.endpoint)) return response({}, 404);
    // Browsers send Origin on writes. Only pages on this tablet's own network may drive the plugin: Decaid does not
    // always pass the Host it was reached by, so a local or private address is enough. Other websites can't send
    // x-bean-journal-ui at all (Decaid's CORS answer doesn't allow it). Under no-referrer a same-origin POST says "null".
    const origin = headers.origin;
    const hostName = /^([^:]+|\[[^\]]+\])(?::\d+)?$/.exec(headers.host ?? "")?.[1]?.replace(/^\[|\]$/g, "");
    const site = headers["sec-fetch-site"];
    const isLocal = (name: string) => name === "localhost" || name === hostName || name.endsWith(".local") || name === "::1" ||
      /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(name) || /^\[?f[cd][0-9a-f]{2}:/i.test(name);
    let sameHost = !origin || (origin === "null" && (site === undefined || site === "same-origin"));
    if (origin && origin !== "null") {
      const named = originHost(origin);
      sameHost = !!named && isLocal(named);
    }
    if (!sameHost || site === "cross-site") return response({ error: copy().errors.localOnly, code: "localOnly" }, 403);
    if (req.endpoint === "mcp") return mcp(req, headers);
    // Stock Streamline's plugin surfaces: it reads `skin` and calls `ratio` from its own origin, without x-bean-journal-ui.
    if (req.endpoint === "skin") {
      if (req.method !== "GET") return { ...response({}, 405), headers: { ...response({}).headers, Allow: "GET" } };
      try { return response(await skinQuick()); } catch { return response({ version: 1, surfaces: [], live: { endpoint: "changed" } }); }
    }
    if (req.method !== "POST") return { ...response({}, 405), headers: { ...response({}).headers, Allow: "POST" } };
    if (!(headers["content-type"] || "").toLowerCase().startsWith("application/json")) return response({}, 415);
    if (req.endpoint === "ratio") {
      try { return response(await serial(() => ratioCall(object(req.body)))); } catch (e) { const x = explain(e); return response(x.body, x.status); }
    }
    // Not authentication: a non-simple header blocks cross-site forms; Origin guards fetch.
    if (headers["x-bean-journal-ui"] !== "1") return response({ error: copy().errors.localOnly, code: "localOnly" }, 403);
    try {
      return response(await act(object(req.body)));
    } catch (e) {
      const x = explain(e);
      return response(x.body, x.status);
    }
  }

  function look() {
    if (stopped) return;
    timer = setTimeout(() => { followGearSoon(); look(); }, LOOK_MS);
  }
  return {
    id: PLUGIN_ID, version: VERSION,
    onLoad(settings: ObjectData) {
      config = settings ?? {};
      stopped = false;
      latestMemo.clear();
      forgetShelf();
      coffeeHistory.invalidate();
      coffeeHistory.snapshot().catch(log("coffee history"));
      // keepBrewTemp compares with the workflow as it was; a clean-up from before the start is undone.
      local("/workflow").then((w) => { seenWorkflow ??= object(w); }).catch(log("workflow"));
      ratioMemory.follow().catch(log("ratio memory"));
      cleanUpUntil = Date.now() + CLEAN_UP_MS;
      followGearSoon();
      look();
    },
    onUnload() {
      stopped = true;
      coffeeHistory.invalidate();
      clearTimeout(timer);
      clearTimeout(sticky);
      clearTimeout(gearTimer);
      clearTimeout(brewTimer);
    },
    onEvent(event: { name: string; payload?: unknown }) {
      if (stopped) return;
      try {
        if (event.name === "workflowUpdated") {
          ratioMemory.follow().catch(log("ratio memory"));
          followGearSoon();
          keepBrewTempSoon();
        } else if (event.name === "shotStored" || event.name === "shotUpdated") {
          latestMemo.clear();
          const payload = optionalObject(event.payload);
          const changedId = text(payload.id ?? payload.shotId);
          coffeeHistory.invalidate(changedId || undefined);
          if (event.name === "shotStored") {
            const p = optionalObject(event.payload);
            const id = localId(p.id ?? p.shotId);
            lastGrind = null;
            cleanUpUntil = Date.now() + CLEAN_UP_MS;
            // Decaid took the dose off the bag's grams.
            forgetShelf();
            clearTimeout(sticky);
            // After Streamline's clean-up, then the shot's notes block (it reads the shot as stored).
            sticky = setTimeout(() => {
              serial(() => keepCoffee(id)).catch(log("keep coffee"))
                .then(() => serial(() => writeNotesBlock(id))).catch(log("notes"));
            }, 4000);
          }
        }
        // storageRead / storageWrite: everything is in Decaid's own data (workflow, shots, beans, store), none here.
      } catch (e) { log("event")(e); }
    },
    __httpRequestHandler: handle,
  };
}
