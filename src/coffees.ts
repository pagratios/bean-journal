// Coffees as the page and the assistants see them: one card per bag (a Decaid bean batch), with its bean's details.
import { httpsUrl, localId, normTitle, number, optionalObject, text, type ObjectData } from "./protocol";

export type Coffee = {
  /** The batch id; "bean:<beanId>" for a bean with no batch at all. */
  id: string;
  beanId: string; batchId: string | null;
  roaster: string; name: string;
  country: string; region: string; producer: string; farm: string;
  varieties: string[]; altitude: number[]; process: string; decaf: boolean;
  tastingNotes: string; link: string;
  /** The photo's ISO stamp (the page's cache key), or null when there is none. */
  photo: string | null;
  roastDate: string | null;
  roastLevel: string;
  weight: number | null; remaining: number | null;
  frozen: boolean; freezeDate: string | null; thawDate: string | null;
  openDate: string | null; bestBefore: string | null;
  bagNotes: string;
  finished: boolean;
  createdAt: string;
};

export const BEAN_PREFIX = "bean:";
export const BEAN_FIELDS = ["roaster", "name", "country", "region", "producer", "farm", "varieties", "altitude", "process", "decaf", "tastingNotes", "link"] as const;
export const BAG_FIELDS = ["roastDate", "roastLevel", "weight", "remaining", "frozen", "freezeDate", "thawDate", "openDate", "bestBefore", "bagNotes", "finished"] as const;
type BeanField = typeof BEAN_FIELDS[number];
type BagField = typeof BAG_FIELDS[number];
/** What the add/edit form or an assistant sends: absent = unchanged, null = cleared. */
export type CoffeeInput = Partial<Record<BeanField | BagField, unknown>>;

/** A coffee id as given: a batch, or a bean with no batch ("bean:<id>"). */
export function coffeeRef(value: unknown): { beanId: string } | { batchId: string } {
  const id = text(value);
  return id.startsWith(BEAN_PREFIX) ? { beanId: localId(id.slice(BEAN_PREFIX.length)) } : { batchId: localId(id) };
}

/** "YYYY-MM-DD" from Decaid's "YYYY-MM-DDT00:00:00" (or any ISO stamp), else null. */
export function day(value: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(text(value));
  return m ? m[1] : null;
}
/** A day as Decaid stores it; refused unless it is a real date. */
export function decaidDay(value: unknown): string {
  const d = text(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) throw new Error("invalidArguments");
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (date.getUTCFullYear() !== Number(m[1]) || date.getUTCMonth() !== Number(m[2]) - 1 || date.getUTCDate() !== Number(m[3])) throw new Error("invalidArguments");
  return `${d}T00:00:00`;
}
/** Today on the tablet's clock, as the form's dates. */
export function today(now = new Date()) {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim()) : [];
const tag = (record: ObjectData) => optionalObject(optionalObject(record.extras).beanJournal);

export function coffeeOf(bean: ObjectData, batch: ObjectData | null): Coffee {
  const beanId = localId(bean.id), own = tag(bean);
  return {
    id: batch ? localId(batch.id) : `${BEAN_PREFIX}${beanId}`,
    beanId, batchId: batch ? localId(batch.id) : null,
    roaster: text(bean.roaster), name: text(bean.name),
    country: text(bean.country), region: text(bean.region), producer: text(bean.producer), farm: text(own.farm),
    varieties: strings(bean.variety),
    altitude: Array.isArray(bean.altitude) ? bean.altitude.filter((a): a is number => number(a) !== undefined) : [],
    process: text(bean.processing), decaf: bean.decaf === true,
    tastingNotes: text(bean.notes), link: httpsUrl(own.link) ?? "",
    photo: text(own.photo) || null,
    roastDate: day(batch?.roastDate), roastLevel: text(batch?.roastLevel),
    weight: number(batch?.weight) ?? null, remaining: number(batch?.weightRemaining) ?? null,
    frozen: batch?.frozen === true, freezeDate: day(batch?.freezeDate), thawDate: day(batch?.unfreezeDate),
    openDate: day(batch?.openDate), bestBefore: day(batch?.bestBeforeDate),
    bagNotes: text(batch?.notes),
    finished: batch?.archived === true || bean.archived === true,
    createdAt: text(batch?.createdAt) || text(bean.createdAt),
  };
}

/** Bags still in use first (the newest roast, then the newest added), finished ones after in the same order. */
export function compareCoffees(a: Coffee, b: Coffee) {
  return Number(a.finished) - Number(b.finished)
    || (b.roastDate ?? "").localeCompare(a.roastDate ?? "")
    || b.createdAt.localeCompare(a.createdAt);
}

/** Every bag as a card, and a card for each bean that has no batch at all (an imported one, say). */
export function coffeesOf(beans: ObjectData[], batches: ObjectData[]): Coffee[] {
  const byId = new Map(beans.map((b) => [text(b.id), b]));
  const bagged = new Set<string>();
  const cards: Coffee[] = [];
  for (const batch of batches) {
    const bean = byId.get(text(batch.beanId));
    if (!bean) continue;
    bagged.add(text(bean.id));
    try { cards.push(coffeeOf(bean, batch)); } catch { /* an id Decaid would never make: left out */ }
  }
  for (const bean of beans) {
    if (bagged.has(text(bean.id))) continue;
    try { cards.push(coffeeOf(bean, null)); } catch { /* as above */ }
  }
  return cards.sort(compareCoffees);
}

/** The card that stands for a bean: its newest bag in use, else its newest bag, else the bean itself. */
export function beanCard(coffees: Coffee[], beanId: string) {
  return coffees.find((c) => c.beanId === beanId) ?? null;
}

const fold = (s: unknown) => normTitle(s);
/** Beans that are already this coffee: the same roaster and name, accents, case and punctuation aside. */
export function sameCoffee(beans: ObjectData[], roaster: unknown, name: unknown) {
  const r = fold(roaster), n = fold(name);
  return n ? beans.filter((b) => fold(b.roaster) === r && fold(b.name) === n) : [];
}

/** Every word of the search is somewhere in the coffee's words. */
export function matchesSearch(coffee: Coffee, query: unknown) {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = ` ${fold([coffee.roaster, coffee.name, coffee.country, coffee.region, coffee.producer, coffee.farm, coffee.process,
    coffee.tastingNotes, coffee.roastLevel, ...coffee.varieties].join(" "))} `;
  return words.every((w) => hay.includes(w));
}

/** The form's values checked: absent stays absent, null clears, anything out of shape is refused. */
export function coffeeInput(value: unknown): CoffeeInput {
  const raw = optionalObject(value), out: CoffeeInput = {};
  for (const [key, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    const k = key as BeanField | BagField;
    const line = (max: number) => {
      if (v !== null && typeof v !== "string") throw new Error("invalidArguments");
      return text(v).replace(/[\r\n\t]+/g, " ").trim().slice(0, max) || null;
    };
    const long = (max: number) => {
      if (v !== null && typeof v !== "string") throw new Error("invalidArguments");
      return text(v).trim().slice(0, max) || null;
    };
    const flag = () => {
      if (v !== null && typeof v !== "boolean") throw new Error("invalidArguments");
      return v === true;
    };
    const date = () => v === null || v === "" ? null : day(decaidDay(v));
    const grams = (min: number) => {
      if (v === null) return null;
      const n = number(v);
      if (n === undefined || n < min || n > 100000) throw new Error("invalidArguments");
      return Math.round(n * 10) / 10;
    };
    switch (k) {
      case "roaster": case "name": out[k] = line(120); break;
      case "country": case "region": case "producer": case "farm": case "process": case "roastLevel": out[k] = line(80); break;
      case "tastingNotes": case "bagNotes": out[k] = long(2000); break;
      case "decaf": case "frozen": case "finished": out[k] = flag(); break;
      case "varieties": {
        if (v !== null && (!Array.isArray(v) || v.length > 20 || v.some((x) => typeof x !== "string" || x.length > 60))) throw new Error("invalidArguments");
        out[k] = v === null ? null : strings(v);
        break;
      }
      case "altitude": {
        if (v !== null && (!Array.isArray(v) || v.length > 2 || v.some((x) => !Number.isInteger(x) || Number(x) < 0 || Number(x) > 9000))) throw new Error("invalidArguments");
        out[k] = v === null || !(v as unknown[]).length ? null : [...(v as number[])];
        break;
      }
      case "link": {
        const link = line(1000);
        if (link && !httpsUrl(link)) throw new Error("invalidArguments");
        out[k] = link;
        break;
      }
      case "roastDate": case "freezeDate": case "thawDate": case "openDate": case "bestBefore": out[k] = date(); break;
      case "weight": out[k] = grams(0.1); break;
      case "remaining": out[k] = grams(0); break;
      default: throw new Error("invalidArguments");
    }
  }
  return out;
}

export const hasBeanFields = (input: CoffeeInput) => BEAN_FIELDS.some((k) => k in input);
export const hasBagFields = (input: CoffeeInput) => BAG_FIELDS.some((k) => k in input && k !== "finished");

/** The bean's `extras` with Bean Journal's part changed; Decaid replaces `extras` whole, so other apps' keys go back too. */
export function mergedExtras(record: ObjectData, own: ObjectData): ObjectData {
  const extras = optionalObject(record.extras);
  const mine: ObjectData = { ...tag(record), ...own };
  for (const [k, v] of Object.entries(mine)) if (v === null || v === undefined) delete mine[k];
  const out: ObjectData = { ...extras };
  if (Object.keys(mine).length) out.beanJournal = mine; else delete out.beanJournal;
  return out;
}

/**
 * The bean's fields to write (POST for a new one, PUT for `existing`). A coffee needs a roaster and a name; Decaid
 * refuses a null for either.
 */
export function beanBody(input: CoffeeInput, existing: ObjectData | null): ObjectData {
  const body: ObjectData = {};
  for (const [from, to] of [["roaster", "roaster"], ["name", "name"]] as const) {
    if (from in input || !existing) {
      const v = text(input[from]);
      if (!v) throw new Error("missingName");
      body[to] = v;
    }
  }
  for (const [from, to] of [["country", "country"], ["region", "region"], ["producer", "producer"], ["process", "processing"],
    ["tastingNotes", "notes"], ["varieties", "variety"], ["altitude", "altitude"]] as const) {
    if (from in input) body[to] = input[from] ?? null;
  }
  if ("decaf" in input) body.decaf = input.decaf === true;
  const own: ObjectData = {};
  if ("farm" in input) own.farm = input.farm ?? null;
  if ("link" in input) own.link = input.link ?? null;
  if (Object.keys(own).length || !existing) body.extras = mergedExtras(existing ?? {}, own);
  return body;
}

/**
 * The bag's fields to write. Freezing or thawing without a date is dated today. `archived` and `weightRemaining` are
 * in `after`: Decaid's POST of a batch ignores them, so they follow in a PUT.
 */
export function batchBody(input: CoffeeInput, existing: ObjectData | null, now: string): { body: ObjectData; after: ObjectData } {
  const body: ObjectData = {}, after: ObjectData = {};
  const at = (v: unknown) => v == null ? null : decaidDay(v);
  for (const [from, to] of [["roastDate", "roastDate"], ["freezeDate", "freezeDate"], ["thawDate", "unfreezeDate"],
    ["openDate", "openDate"], ["bestBefore", "bestBeforeDate"]] as const) {
    if (from in input) body[to] = at(input[from]);
  }
  if ("roastLevel" in input) body.roastLevel = input.roastLevel ?? null;
  if ("bagNotes" in input) body.notes = input.bagNotes ?? null;
  if ("weight" in input) body.weight = input.weight ?? null;
  if ("frozen" in input) {
    body.frozen = input.frozen === true;
    const was = existing?.frozen === true;
    if (body.frozen && !was && !("freezeDate" in input)) body.freezeDate = decaidDay(now);
    if (!body.frozen && was && !("thawDate" in input)) body.unfreezeDate = decaidDay(now);
  }
  if ("remaining" in input) {
    const remaining = input.remaining as number | null;
    const weight = "weight" in input ? input.weight as number | null : number(existing?.weight) ?? null;
    if (remaining !== null && weight !== null && remaining > weight) throw new Error("invalidArguments");
    after.weightRemaining = remaining;
  }
  if ("finished" in input) after.archived = input.finished === true;
  if (existing) return { body: { ...body, ...after }, after: {} };
  return { body, after };
}
