// Decaid's data read safely: anything that isn't the expected shape is refused with an `invalidData` / `invalidId`.
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

/** Accents and case aside ("Café" = "cafe"). */
export const unaccented = (s: unknown) => text(s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Accents, case, apostrophes and punctuation ignored: "Damian’s LRv3" = "damians lrv3". */
export const normTitle = (s: unknown) => unaccented(s)
  .replace(/['’‘`´]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** A plugin's own data on a shot, a workflow context or a profile: `extras[key]`, {} when there is none. */
export const tagIn = (holder: ObjectData, key: string) => optionalObject(optionalObject(holder.extras)[key]);
/** One of `values` kept under `field` of a plugin's tag: the value, null once cleared, undefined when never set. */
export function tagChoice(tag: ObjectData, field: string, values: readonly string[]): string | null | undefined {
  if (!(field in tag)) return undefined;
  return values.includes(text(tag[field])) ? text(tag[field]) : null;
}
