import { describe, expect, it } from "vitest";
import { coffeeFreezerDays, coffeeRestingDays, type CoffeeAgeInput } from "./index";

const bag: CoffeeAgeInput = { roastDate: "2026-10-01", frozen: false };

describe("resting age", () => {
  it("counts calendar days, including a zero-day roast and leap days", () => {
    expect(coffeeRestingDays(bag, "2026-10-06")).toBe(5);
    expect(coffeeRestingDays(bag, "2026-10-01")).toBe(0);
    expect(coffeeRestingDays({ ...bag, roastDate: "2024-02-28" }, "2024-03-01")).toBe(2);
    expect(coffeeRestingDays({ ...bag, roastDate: "2026-03-28" }, "2026-03-30")).toBe(2);
  });

  it("pauses while frozen and subtracts earlier cycles only once", () => {
    const cold = { ...bag, frozen: true, freezeDate: "2026-10-06" };
    expect(coffeeRestingDays(cold, "2026-10-20")).toBe(5);
    expect(coffeeRestingDays({ ...cold, thawDate: "2026-09-01" }, "2026-10-20")).toBe(5);
    const thawed = { ...cold, frozen: false, thawDate: "2026-10-16" };
    expect(coffeeFreezerDays(thawed, "2026-10-20")).toBe(10);
    expect(coffeeRestingDays(thawed, "2026-10-20")).toBe(9);
    expect(coffeeRestingDays({ ...cold, freezeDate: "2026-10-18", pastFrozenDays: 10 }, "2026-10-20")).toBe(7);
    expect(coffeeRestingDays({ ...bag, pastFrozenDays: 10 }, "2026-10-20")).toBe(9);
  });

  it("supports fractional elapsed freezer totals and returns whole resting days", () => {
    expect(coffeeRestingDays({ ...bag, pastFrozenDays: 2.5 }, "2026-10-06")).toBe(2);
    expect(coffeeRestingDays({ ...bag, pastFrozenDays: 20 }, "2026-10-06")).toBe(0);
  });

  it("does not invent an age from unknown, invalid or inconsistent dates/totals", () => {
    for (const roastDate of [undefined, null, "", "unknown", "2026-02-30", "2026-13-01", "2026-10-22"]) {
      expect(coffeeRestingDays({ ...bag, roastDate }, "2026-10-20"), String(roastDate)).toBeNull();
    }
    for (const extra of [
      { frozen: true }, { frozen: true, freezeDate: "bad" }, { frozen: true, freezeDate: "2026-10-21" },
      { freezeDate: "2026-10-03" }, { thawDate: "2026-10-05" },
      { freezeDate: "2026-10-05", thawDate: "2026-10-03" },
      { freezeDate: "2026-09-30", thawDate: "2026-10-03" },
      { freezeDate: "2026-10-03", thawDate: "2026-10-21" },
      { pastFrozenDays: null }, { pastFrozenDays: -1 }, { pastFrozenDays: Infinity }, { pastFrozenDays: NaN },
    ]) expect(coffeeRestingDays({ ...bag, ...extra }, "2026-10-20"), JSON.stringify(extra)).toBeNull();
    expect(coffeeFreezerDays(bag, "2026-02-30")).toBeNull();
    expect(coffeeRestingDays(bag, "invalid")).toBeNull();
  });
});
