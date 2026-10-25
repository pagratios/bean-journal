import { describe, expect, it } from "vitest";
import { bagLastDate, batchBody, beanBody, coffeeInput, coffeeOf, coffeeRef, coffeesOf, day, decaidDay, matchesSearch, mergedExtras, oldBags, sameCoffee, today } from "./coffees";

const bean = (id: string, more: Record<string, unknown> = {}) => ({ id, roaster: "Square Mile", name: "Red Brick", decaf: false, archived: false, createdAt: "2026-01-01T10:00:00", ...more });
const batch = (id: string, beanId: string, more: Record<string, unknown> = {}) => ({ id, beanId, frozen: false, archived: false, createdAt: "2026-02-01T10:00:00", ...more });

describe("Coffees from Decaid's beans and batches", () => {
  it("makes one card per bag, with the bean's details and Decaid's dates as days", () => {
    const b = bean("b1", { country: "Ethiopia", region: "Guji", producer: "Coop", variety: ["74110", 7], altitude: [1900, 2100], processing: "washed", species: "Arabica",
      notes: "Peach", extras: { beanJournal: { farm: "Hambela", link: "https://shop.example/rb", photo: "2026-10-01T10:00:00.000Z" }, beanbox: { bag_id: "x" } } });
    const card = coffeeOf(b, batch("t1", "b1", { roastDate: "2026-10-01T00:00:00", roastLevel: "light", weight: 250, weightRemaining: 180, frozen: true,
      freezeDate: "2026-10-03T00:00:00", unfreezeDate: null, openDate: "2026-10-04T00:00:00", bestBeforeDate: "2027-01-01T00:00:00", notes: "Bag 1",
      harvestDate: "2025", qualityScore: 86.5, price: 21, currency: "GBP", buyDate: "2026-10-02T00:00:00" }), "2026-10-20");
    expect(card).toEqual({
      id: "t1", beanId: "b1", batchId: "t1", roaster: "Square Mile", name: "Red Brick", country: "Ethiopia", region: "Guji", producer: "Coop", farm: "Hambela",
      varieties: ["74110"], altitude: [1900, 2100], process: "washed", decaf: false, tastingNotes: "Peach", link: "https://shop.example/rb",
      photo: "2026-10-01T10:00:00.000Z", roastDate: "2026-10-01", roastLevel: "light", weight: 250, remaining: 180, frozen: true, freezeDate: "2026-10-03",
      thawDate: null, openDate: "2026-10-04", bestBefore: "2027-01-01", bagNotes: "Bag 1", finished: false, createdAt: "2026-02-01T10:00:00",
      species: "Arabica", decafProcess: "", harvestDate: "2025", qualityScore: 86.5, price: 21, currency: "GBP", buyDate: "2026-10-02",
      pastFrozenDays: 0, restingDays: 2,
    });
    expect(coffeeOf(bean("b2", { extras: { beanJournal: { link: "http://insecure.example" } } }), null)).toMatchObject({ id: "bean:b2", batchId: null, link: "", photo: null, weight: null });
  });

  it("lists bags in use first (newest roast, then newest added), finished ones after, and beans without any batch as their own card", () => {
    const beans = [bean("b1"), bean("b2", { name: "Kiambu" }), bean("b3", { name: "Old", archived: true }), bean("b4", { name: "Imported" })];
    const batches = [
      batch("t1", "b1", { roastDate: "2026-09-01T00:00:00" }),
      batch("t2", "b2", { roastDate: "2026-10-01T00:00:00" }),
      batch("t3", "b1", { roastDate: "2026-10-05T00:00:00", archived: true }),
      batch("t4", "b3", { roastDate: "2026-10-09T00:00:00" }),
      batch("t5", "b2", { createdAt: "2026-03-01T00:00:00" }),
      batch("t6", "gone"),
    ];
    const list = coffeesOf(beans, batches);
    expect(list.map((c) => c.id)).toEqual(["t2", "t1", "t5", "bean:b4", "t4", "t3"]);
    expect(list.filter((c) => c.finished).map((c) => c.id)).toEqual(["t4", "t3"]);
  });

  it("knows a coffee that is already there, accents, case and punctuation aside, and finds by any word", () => {
    const beans = [bean("b1", { roaster: "Café Señor", name: "Red-Brick" }), bean("b2", { name: "Other" })];
    expect(sameCoffee(beans, "cafe senor", "red brick").map((b) => b.id)).toEqual(["b1"]);
    expect(sameCoffee(beans, "Cafe", "Red Brick")).toEqual([]);
    const card = coffeeOf(bean("b1", { country: "Ethiopia", variety: ["Heirloom"] }), batch("t1", "b1", { roastLevel: "Light" }));
    expect(matchesSearch(card, "ethiopia heirloom")).toBe(true);
    expect(matchesSearch(card, "  ")).toBe(true);
    expect(matchesSearch(card, "kenya")).toBe(false);
    expect(coffeeRef("bean:b1")).toEqual({ beanId: "b1" });
    expect(coffeeRef("t1")).toEqual({ batchId: "t1" });
    expect(() => coffeeRef("bean:../x")).toThrow("invalidId");
  });

  it("finds old bags: in use, not frozen, no recent shot (by bag, else by name) and no recent date of their own", () => {
    const beans = [bean("b1", { name: "Used" }), bean("b2", { name: "Named" }), bean("b3", { name: "Old" }), bean("b4", { name: "Fresh" }), bean("b5", { name: "Cold" }), bean("b6", { name: "Bare" })];
    const list = coffeesOf(beans, [
      batch("t1", "b1", { roastDate: "2026-01-01T00:00:00" }), batch("t2", "b2"), batch("t3", "b3", { roastDate: "2026-06-01T00:00:00", openDate: "2026-06-20T00:00:00" }),
      batch("t4", "b4", { buyDate: "2026-09-01T00:00:00" }), batch("t5", "b5", { frozen: true }), batch("t6", "b3", { archived: true }),
    ]);
    const recent = [{ batchId: "t1", roaster: "", name: "" }, { batchId: null, roaster: "square mile", name: "NAMED" }, { batchId: null, roaster: "", name: "" }];
    expect(oldBags(list, recent, "2026-07-17").map((c) => c.id).sort()).toEqual(["bean:b6", "t3"]);
    expect(bagLastDate(list.find((c) => c.id === "t3")!)).toBe("2026-06-20");
    expect(bagLastDate(list.find((c) => c.id === "t2")!)).toBeNull();
  });

  it("checks the form and converts dates both ways", () => {
    expect(day("2026-10-01T00:00:00")).toBe("2026-10-01");
    expect(day("")).toBeNull();
    expect(day("2026-02-30T00:00:00")).toBeNull();
    expect(day("2026-10-01Tbad")).toBeNull();
    expect(decaidDay("2026-02-28")).toBe("2026-02-28T00:00:00");
    expect(() => decaidDay("2026-02-30")).toThrow("invalidArguments");
    expect(today(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
    expect(coffeeInput({ roaster: " A ", name: "B\nC", varieties: [" X ", ""], altitude: [], link: "", roastDate: "2026-10-01", weight: 250, tastingNotes: null }))
      .toEqual({ roaster: "A", name: "B C", varieties: ["X"], altitude: null, link: null, roastDate: "2026-10-01", weight: 250, tastingNotes: null });
    for (const bad of [{ link: "http://x.example" }, { weight: 0 }, { remaining: -1 }, { altitude: [1, 2, 3] }, { altitude: [1.5] }, { roastDate: "yesterday" },
      { decaf: "yes" }, { varieties: "x" }, { colour: "red" }, { name: 3 }, { qualityScore: 101 }, { price: -1 }, { price: "12" }, { buyDate: "soon" }]) {
      expect(() => coffeeInput(bad), JSON.stringify(bad)).toThrow("invalidArguments");
    }
  });
});

describe("Writing coffees to Decaid", () => {
  it("needs a roaster and a name, maps the fields and merges the extras other apps keep", () => {
    expect(() => beanBody(coffeeInput({ name: "X" }), null)).toThrow("missingName");
    expect(() => beanBody(coffeeInput({ roaster: null }), bean("b1"))).toThrow("missingName");
    expect(beanBody(coffeeInput({ roaster: "R", name: "N", process: "natural", tastingNotes: "Jam", varieties: ["Gesha"], altitude: [1800], farm: "F", decaf: true }), null)).toEqual({
      roaster: "R", name: "N", processing: "natural", notes: "Jam", variety: ["Gesha"], altitude: [1800], decaf: true, extras: { beanJournal: { farm: "F" } },
    });
    const existing = bean("b1", { extras: { beanbox: { bag_id: "x" }, beanJournal: { farm: "F", photo: "p" } } });
    expect(beanBody(coffeeInput({ link: "https://a.example", farm: null }), existing)).toEqual({
      extras: { beanbox: { bag_id: "x" }, beanJournal: { photo: "p", link: "https://a.example" } },
    });
    expect(beanBody(coffeeInput({ country: "Kenya" }), existing)).toEqual({ country: "Kenya" });
    expect(beanBody(coffeeInput({ species: " Arabica ", decafProcess: null }), existing)).toEqual({ species: "Arabica", decafProcess: null });
    expect(mergedExtras(existing, { photo: null, farm: null })).toEqual({ beanbox: { bag_id: "x" } });
  });

  it("dates freezing and thawing today unless given, and sends the grams left and finished after a new bag's POST", () => {
    const fresh = batchBody(coffeeInput({ roastDate: "2026-10-01", weight: 250, remaining: 200, frozen: true, finished: false, bagNotes: "n" }), null, "2026-10-16");
    expect(fresh).toEqual({
      body: { roastDate: "2026-10-01T00:00:00", weight: 250, frozen: true, freezeDate: "2026-10-16T00:00:00", unfreezeDate: null, notes: "n" },
      after: { weightRemaining: 200, archived: false },
    });
    const frozen = batch("t1", "b1", { frozen: true, weight: 250 });
    expect(batchBody(coffeeInput({ frozen: false }), frozen, "2026-10-16").body).toEqual({ frozen: false, unfreezeDate: "2026-10-16T00:00:00" });
    expect(batchBody(coffeeInput({ frozen: false, thawDate: "2026-10-10" }), frozen, "2026-10-16").body).toEqual({ frozen: false, unfreezeDate: "2026-10-10T00:00:00" });
    expect(batchBody(coffeeInput({ frozen: true }), frozen, "2026-10-16").body).toEqual({ frozen: true });
    expect(batchBody(coffeeInput({ remaining: 100, finished: true }), frozen, "2026-10-16")).toEqual({ body: { weightRemaining: 100, archived: true }, after: {} });
    expect(() => batchBody(coffeeInput({ remaining: 300 }), frozen, "2026-10-16")).toThrow("invalidArguments");
    expect(batchBody(coffeeInput({ openDate: null }), frozen, "2026-10-16").body).toEqual({ openDate: null });
    expect(batchBody(coffeeInput({ harvestDate: "2025", qualityScore: 86.556, price: 18.499, currency: "EUR", buyDate: "2026-10-01" }), null, "2026-10-16").body)
      .toEqual({ harvestDate: "2025", qualityScore: 86.56, price: 18.5, currency: "EUR", buyDate: "2026-10-01T00:00:00" });
    expect(batchBody(coffeeInput({ price: null, currency: "", buyDate: null }), frozen, "2026-10-16").body).toEqual({ price: null, currency: null, buyDate: null });
  });

  it("keeps earlier freezer cycles when refrozen, preserving other batch extras", () => {
    let saved: Record<string, unknown> = batch("t1", "b1", {
      roastDate: "2026-10-01T00:00:00", freezeDate: "2026-10-04T00:00:00", unfreezeDate: "2026-10-09T00:00:00",
      extras: { other: { keep: true }, beanJournal: { note: "keep" } },
    });
    const save = (fields: Record<string, unknown>, now: string) => {
      saved = { ...saved, ...batchBody(coffeeInput(fields), saved, now).body };
      return coffeeOf(bean("b1"), saved, now);
    };
    expect(save({ frozen: true }, "2026-10-12")).toMatchObject({ frozen: true, freezeDate: "2026-10-12", thawDate: null, pastFrozenDays: 5, restingDays: 6 });
    expect(saved.extras).toEqual({ other: { keep: true }, beanJournal: { note: "keep", pastFrozenDays: 5 } });
    expect(save({ frozen: true }, "2026-10-13").pastFrozenDays).toBe(5);
    expect(save({ frozen: false }, "2026-10-16")).toMatchObject({ pastFrozenDays: 5, restingDays: 6, thawDate: "2026-10-16" });
    expect(save({ thawDate: "2026-10-15" }, "2026-10-17").restingDays).toBe(8);
    expect(save({ frozen: true, freezeDate: "2026-10-18", thawDate: null }, "2026-10-18"))
      .toMatchObject({ pastFrozenDays: 8, restingDays: 9, thawDate: null });
    expect(save({ frozen: false }, "2026-10-20").restingDays).toBe(9);
    expect(save({ freezeDate: null }, "2026-10-21").restingDays).toBeNull();
    expect(save({ thawDate: null }, "2026-10-21")).toMatchObject({ pastFrozenDays: 8, restingDays: 12 });
    expect(save({ roastDate: null }, "2026-10-21").restingDays).toBeNull();
    expect(save({ roastDate: "2026-10-02" }, "2026-10-21").restingDays).toBe(11);
  });

  it("counts same-day cycles as zero and lets cleared freezer dates remain unknown while frozen", () => {
    const saved = batch("t1", "b1", { roastDate: "2026-10-01", freezeDate: "2026-10-10", unfreezeDate: "2026-10-10" });
    const cold = { ...saved, ...batchBody(coffeeInput({ frozen: true, freezeDate: null }), saved, "2026-10-20").body };
    expect(coffeeOf(bean("b1"), cold, "2026-10-20")).toMatchObject({ pastFrozenDays: 0, restingDays: null, thawDate: null });
    const dated = { ...cold, ...batchBody(coffeeInput({ freezeDate: "2026-10-20" }), cold, "2026-10-20").body };
    expect(coffeeOf(bean("b1"), dated, "2026-10-20")).toMatchObject({ pastFrozenDays: 0, restingDays: 19 });
  });

  it("does not lose an incomplete previous cycle on refreezing or invent ages for bad imports", () => {
    for (const dates of [
      { freezeDate: "2026-10-03T00:00:00" },
      { freezeDate: "2026-02-30T00:00:00", unfreezeDate: "2026-03-02T00:00:00" },
      { freezeDate: "2026-10-10T00:00:00", unfreezeDate: "2026-10-03T00:00:00" },
    ]) {
      const saved = batch("t1", "b1", { roastDate: "2026-10-01", ...dates });
      expect(coffeeOf(bean("b1"), saved, "2026-10-20").restingDays).toBeNull();
      expect(() => batchBody(coffeeInput({ frozen: true }), saved, "2026-10-20")).toThrow("invalidFreezerDates");
    }
    expect(coffeeOf(bean("b1"), batch("t1", "b1", { roastDate: "2026-02-30" }), "2026-10-20").restingDays).toBeNull();
  });

  it("refuses reversed, overlapping and future freezer edits", () => {
    const saved = batch("t1", "b1", { freezeDate: "2026-10-03T00:00:00", unfreezeDate: "2026-10-10T00:00:00" });
    for (const fields of [
      { frozen: true, freezeDate: "2026-10-09" }, { frozen: true, thawDate: "2026-10-10" },
      { freezeDate: "2026-10-11" }, { thawDate: "2026-10-02" }, { thawDate: "2026-10-21" },
    ]) expect(() => batchBody(coffeeInput(fields), saved, "2026-10-20"), JSON.stringify(fields)).toThrow("invalidFreezerDates");
    for (const pastFrozenDays of [null, "5", -1]) {
      const bad = { ...saved, extras: { beanJournal: { pastFrozenDays } } };
      expect(coffeeOf(bean("b1"), { ...bad, roastDate: "2026-10-01" }, "2026-10-20").restingDays).toBeNull();
      expect(() => batchBody(coffeeInput({ frozen: true }), bad, "2026-10-20")).toThrow("invalidFreezerDates");
    }
  });
});
