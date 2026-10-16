import { describe, expect, it } from "vitest";
import {
  BEVERAGES, designedProfile, editedProfile, notesBlockPatch, notesWithBlock, object, profileAt, profileExecution, shotLine, shotNotes, shotRpm,
  shotSummary, shotText, shotWater, visualizerId, type ObjectData,
} from "./protocol";

const start = Date.parse("2026-10-08T09:00:00Z");
function shot(annotations: ObjectData = {}, context: ObjectData = {}): ObjectData {
  return {
    id: "s1", timestamp: new Date(start).toISOString(),
    workflow: { profile: { title: "Classic", beverage_type: "espresso", steps: [{ name: "Pour" }] }, context: { targetDoseWeight: 18, ...context } },
    annotations,
    measurements: [0, 15, 30].map((t) => ({
      machine: { timestamp: new Date(start + t * 1000).toISOString(), state: { state: "espresso", substate: "pouring" }, pressure: 9, flow: 2, profileFrame: 0 },
      scale: { weight: t * 1.2 },
    })),
  };
}

describe("Shot page summary", () => {
  it("marks where each profile step starts and works out the weight flow from the weight", () => {
    const at = (t: number, frame: number, weight: number) => ({
      machine: { timestamp: new Date(start + t * 1000).toISOString(), state: { state: "espresso", substate: "pouring" }, pressure: 9, flow: 2,
        profileFrame: frame, targetPressure: 9, targetFlow: 0, groupTemperature: 92, targetGroupTemperature: 93 },
      scale: { weight },
    });
    const value = {
      id: "x1", timestamp: new Date(start).toISOString(),
      workflow: { profile: { title: "P", beverage_type: "espresso", steps: [{ name: "Fill" }, { name: "Bloom" }, { name: "Pour" }] }, context: {} },
      annotations: {},
      measurements: [at(0, 0, 0), at(1, 0, 0), at(2, 1, 1), at(3, 1, 3), at(4, 2, 5), at(5, 2, 7), at(6, 1, 9)],
    };
    const summary = shotSummary(value);
    expect(summary.steps).toEqual([{ t: 0, frame: 0, name: "Fill" }, { t: 2, frame: 1, name: "Bloom" }, { t: 4, frame: 2, name: "Pour" }, { t: 6, frame: 1, name: "Bloom" }]);
    expect(summary.series.weightFlow).toEqual([null, 0, 1, 2, 2, 2, 2]);
    expect(summary.series.targetTemp[0]).toBe(93);
  });

  it("reads the steps of an imported shot (every sample on frame 0) from its targets", () => {
    // de1app's Baseline LC as Decaid imports it: −1 for the target a step doesn't control, the flow goal eased down.
    const goals: [number, number][] = [[-1, -1], [-1, 12], [-1, 12], [-1, 12], [-1, 6.8], [-1, 2.9], [-1, 0.6], [2.6, -1], [3.6, -1], [4, -1], [4, -1]];
    const value = {
      id: "de1app-1", timestamp: new Date(start).toISOString(),
      workflow: { profile: { title: "Baseline LC", beverage_type: "espresso", steps: [
        { name: "Fill (fast)", pump: "flow", flow: 12 }, { name: "Soak (zero flow)", pump: "flow", flow: 0 }, { name: "Percolation (flat)", pump: "pressure", pressure: 4 },
      ] }, context: {} },
      annotations: {},
      measurements: goals.map(([p, f], i) => ({
        machine: { timestamp: new Date(start + i * 1000).toISOString(), state: { state: "espresso", substate: "pouring" }, pressure: 2, flow: 2,
          profileFrame: 0, targetPressure: p, targetFlow: f },
        scale: { weight: i },
      })),
    };
    const summary = shotSummary(value);
    expect(summary.steps.map((s) => [s.t, s.name])).toEqual([[1, "Fill (fast)"], [4, "Soak (zero flow)"], [7, "Percolation (flat)"]]);
    // −1 is "not this step's target", never a 0 on the chart.
    expect(summary.series.targetPressure.slice(0, 3)).toEqual([null, null, null]);
    const same = { ...value, workflow: { ...value.workflow, profile: { ...value.workflow.profile, steps: [{ name: "A", pump: "flow", flow: 12 }, { name: "B", pump: "flow", flow: 12 }] } } };
    expect(shotSummary(same).steps).toEqual([]);
  });

  it("reads Bean Journal's own taste, body and water, never Beanbox's, and the coffee as the batch", () => {
    const value = shot({
      enjoyment: 8.5, drinkTds: 9.2, drinkEy: 0, espressoNotes: "Sweet",
      extras: { beanJournal: { balance: "sour", body: "heavy", water: "Lotus Light" }, beanbox: { balance: "bitter", body: "thin", waterId: "x" }, visualizerId: "abc-123" },
    }, { beanBatchId: "batch-1", coffeeName: "Kiambu", coffeeRoaster: "Roastery", grinderId: "g1", grinderModel: "Lagom", grinderSetting: "12", targetYield: 36, extras: { rpm: 900 } });
    const s = shotSummary(value);
    expect(s).toMatchObject({
      coffeeId: "batch-1", beanId: null, coffeeName: "Kiambu", coffeeRoaster: "Roastery", score: 85, balance: "sour", body: "heavy", water: "Lotus Light",
      tds: 9.2, ey: null, dose: 18, yield: 36, targetYield: 36, grind: "12", grinderId: "g1", grinderModel: "Lagom", rpm: 900, notes: "Sweet",
      visualizerId: "abc-123", kind: "espresso", brew: true, duration: 30,
    });
    for (const gone of ["upload", "brewId", "imageUrl", "machineId", "stamp", "waterId"]) expect(s).not.toHaveProperty(gone);
    const beanboxOnly = shotSummary(shot({ extras: { beanbox: { balance: "bitter", body: "thin" } } }));
    expect([beanboxOnly.balance, beanboxOnly.body, beanboxOnly.water, beanboxOnly.visualizerId]).toEqual([null, null, null, null]);
    expect(shotLine(value)).toMatchObject({ id: "s1", coffeeId: "batch-1", score: 85, balance: "sour", grind: "12", grinder: "Lagom", dose: 18 });
    expect(shotText(s)).toContain("Water: Lotus Light");
  });

  it("takes the next shot's water and RPM from the workflow, and a water cleared on the shot as none", () => {
    expect(shotWater({}, { extras: { beanJournal: { water: " Volvic\n1:3 " } } })).toBe("Volvic 1:3");
    expect(shotWater({ extras: { beanJournal: { water: null } } }, { extras: { beanJournal: { water: "Volvic" } } })).toBeNull();
    expect(shotWater({})).toBeUndefined();
    expect(shotRpm({ extras: { rpm: 1200 } })).toBe(1200);
    expect(shotRpm({ extras: { rpm: 0, grinderRpm: 800 } })).toBe(800);
    expect(shotRpm({ extras: { rpm: 12.5 } })).toBeUndefined();
    expect(visualizerId({ extras: { visualizer: { shot_id: "v-1" } } })).toBe("v-1");
    expect(visualizerId({ extras: { visualizerId: "../x" } })).toBeNull();
  });
});

describe("The notes block for Visualizer", () => {
  const merged = (value: ObjectData, patch: ObjectData) => {
    const a = object(value.annotations);
    return { ...value, annotations: { ...a, ...patch, extras: { ...object(a.extras ?? {}), beanJournal: { ...object(object(a.extras ?? {}).beanJournal ?? {}), ...object(object(patch.extras ?? {}).beanJournal ?? {}) } } } };
  };
  it("adds the taste, body, water and RPM after the user's notes, which stay exactly as written", () => {
    const original = "  Sweet\r\nOrange\r\n\n";
    const value = shot({ espressoNotes: original, extras: { beanJournal: { balance: "balanced", body: "medium", water: "Lotus" } } }, { extras: { rpm: 1200 } });
    const patch = notesBlockPatch(value)!;
    expect(patch.espressoNotes).toBe(`${original}\n\n[Bean Journal]\nTaste: Balanced · Body: Medium\nWater: Lotus\nGrinder: 1200 RPM\n[/Bean Journal]`);
    const after = merged(value, patch);
    expect(shotNotes(object(after.annotations))).toBe(original);
    expect(shotSummary(after).notes).toBe(original);
    expect(notesBlockPatch(after)).toBeNull();
  });
  it("replaces its own block, removes it when nothing is left, and writes none for a shot with nothing to say", () => {
    expect(notesBlockPatch(shot({ espressoNotes: "Hi" }))).toBeNull();
    const value = shot({ espressoNotes: "", extras: { beanJournal: { body: "thin" } } });
    const first = merged(value, notesBlockPatch(value)!);
    expect(object(first.annotations).espressoNotes).toBe("[Bean Journal]\nBody: Thin\n[/Bean Journal]");
    const sour = merged(first, { extras: { beanJournal: { balance: "sour" } } });
    const second = merged(sour, notesBlockPatch(sour)!);
    expect(String(object(second.annotations).espressoNotes).match(/\[Bean Journal\]/g)).toHaveLength(1);
    expect(object(second.annotations).espressoNotes).toContain("Taste: Sour · Body: Thin");
    const cleared = merged(second, { extras: { beanJournal: { balance: null, body: null } } });
    const third = notesBlockPatch(cleared)!;
    expect(third).toEqual({ espressoNotes: "", extras: { beanJournal: { notesBlock: null } } });
  });
  it("leaves a block edited elsewhere alone, and keeps the block when the user edits their notes", () => {
    const value = shot({ espressoNotes: "Sweet", extras: { beanJournal: { balance: "bitter" } } });
    const first = merged(value, notesBlockPatch(value)!);
    const edited = merged(first, { espressoNotes: String(object(first.annotations).espressoNotes).replace("Bitter", "Very bitter") });
    expect(notesBlockPatch(merged(edited, { extras: { beanJournal: { balance: "sour" } } }))).toBeNull();
    expect(shotNotes(object(edited.annotations))).toBe(object(edited.annotations).espressoNotes);
    const rewritten = notesWithBlock(object(first.annotations), "Juicy");
    expect(rewritten.espressoNotes).toBe("Juicy\n\n[Bean Journal]\nTaste: Bitter\n[/Bean Journal]");
    expect(shotNotes(object(merged(first, rewritten).annotations))).toBe("Juicy");
    expect(notesWithBlock(object(first.annotations), "").espressoNotes).toBe("[Bean Journal]\nTaste: Bitter\n[/Bean Journal]");
    expect(notesWithBlock({ espressoNotes: "Plain" }, "New")).toEqual({ espressoNotes: "New" });
  });
});

describe("Editable profiles", () => {
  const profile = { title: "Base", author: "Decent", notes: "", beverage_type: "espresso", version: "2", steps: [{ name: "Pour", pump: "pressure", pressure: 9, temperature: 93, seconds: 30 }] };
  const step = { name: "Pour", pump: "flow", flow: 12, temperature: 60, seconds: 10 };
  it.each(BEVERAGES)("creates and edits the %s beverage category", (beverageType) => {
    expect(designedProfile({ title: "Test", beverageType, steps: [step] }).profile.beverage_type).toBe(beverageType);
    expect(editedProfile({ beverageType }, profile)).toEqual({ ...profile, beverage_type: beverageType });
  });
  it("groups an assistant's design under AI / and tags it as the assistant's", () => {
    const made = designedProfile({ title: " Bloom ", steps: [step], dose: 18 });
    expect(made.profile).toMatchObject({ title: "AI / Bloom", author: "AI assistant" });
    expect(made.metadata).toEqual({ beanJournal: { madeBy: "assistant", dose: 18 } });
    expect(JSON.stringify(made)).not.toMatch(/beanbox/i);
  });
  it("validates supplied values and nested fields", () => {
    for (const patch of [
      { beverageType: "turbo" }, { title: "" }, { notes: null }, { targetVolume: -1 }, { tankTemperature: 111 }, { volumeCountStart: 3 },
      { steps: [] }, { steps: [{ ...step, temperature: 106 }] }, { steps: [{ ...step, flow: 16 }] }, { steps: [{ ...step, pause: 1 }] },
      { steps: [{ ...step, exit: { type: "weight", condition: "over", value: 1 } }] }, { steps: [{ ...step, limiter: { value: 13 } }] }, { steps: [null] },
    ]) expect(() => editedProfile(patch, profile), JSON.stringify(patch)).toThrow("invalidArguments");
  });
  it("compares execution independently of presentation and the unused pump target", () => {
    const saved = designedProfile({ title: "Test", steps: [step] }).profile;
    const same = { ...saved, title: "Renamed", notes: "Different", steps: [{ ...step, pressure: 10 }] };
    expect(profileExecution(same)).toBe(profileExecution(saved));
    expect(profileExecution({ ...same, beverage_type: "tea" })).not.toBe(profileExecution(saved));
  });
  it("brews a profile at another temperature, its steps' differences kept", () => {
    const bloom = { title: "Bloom", steps: [{ name: "Fill", temperature: 93 }, { name: "Pour", temperature: 90.5 }] };
    expect(profileAt(bloom, 91.5)).toEqual({ title: "Bloom", steps: [{ name: "Fill", temperature: 91.5 }, { name: "Pour", temperature: 89 }] });
    expect(profileAt({ steps: [{ temperature: 92 }, { temperature: 98 }] }, 95)).toBeNull();
    expect(profileAt({ steps: [] }, 92)).toBeNull();
  });
});
