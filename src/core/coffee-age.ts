export type CoffeeAgeInput = {
  roastDate?: string | null;
  frozen: boolean;
  freezeDate?: string | null;
  thawDate?: string | null;
  /** Completed cycles before the interval described by freezeDate/thawDate. */
  pastFrozenDays?: number | null;
};

const DAY_MS = 86400000;

/** A real calendar day, independent of timezone offsets and daylight saving. */
function dayNumber(value: string | null | undefined): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return date.getTime() / DAY_MS;
}

/** Days in the latest freezer interval; null means the interval cannot be counted reliably. */
export function coffeeFreezerDays(input: CoffeeAgeInput, asOf: string): number | null {
  const now = dayNumber(asOf);
  if (now === null) return null;
  if (!input.frozen && !input.freezeDate && !input.thawDate) return 0;
  const start = dayNumber(input.freezeDate);
  const end = input.frozen ? now : dayNumber(input.thawDate);
  if (start === null || end === null || start > end || end > now) return null;
  return end - start;
}

/** Whole resting days since roasting, excluding the latest interval and all earlier freezer cycles. */
export function coffeeRestingDays(input: CoffeeAgeInput, asOf: string): number | null {
  const now = dayNumber(asOf), roast = dayNumber(input.roastDate);
  const past = input.pastFrozenDays === undefined ? 0 : input.pastFrozenDays;
  if (now === null || roast === null || roast > now || past === null || !Number.isFinite(past) || past < 0) return null;
  const frozen = coffeeFreezerDays(input, asOf);
  const start = dayNumber(input.freezeDate);
  if (frozen === null || (start !== null && start < roast)) return null;
  const resting = now - roast - past - frozen;
  return Math.max(0, Math.floor(resting));
}
