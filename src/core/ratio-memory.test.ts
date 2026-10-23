import { describe, expect, it, vi } from "vitest";
import {
  createRatioMemory, ratioProfileKey, object, optionalObject, text,
  type ObjectData, type RatioMemoryData, type RatioMemoryOptions,
} from "./index";

const classic = { title: "Classic", beverage_type: "espresso", target_weight: 36,
  steps: [{ name: "Pour", pressure: 9, temperature: 93, seconds: 30 }] };
const turbo = { ...classic, title: "Turbo", target_weight: 60 };
const copy = <T>(value: T): T => structuredClone(value);
function merge(before: ObjectData, patch: ObjectData): ObjectData {
  const result = { ...before };
  for (const [k, v] of Object.entries(patch)) result[k] = v && typeof v === "object" && !Array.isArray(v)
    ? merge(optionalObject(before[k]), object(v)) : v;
  return result;
}
function fixture() {
  let workflow: ObjectData = { profile: copy(classic),
    context: { coffee: "a", targetDoseWeight: 18, targetYield: 36, extras: { lockRatio: false, other: { untouched: 1 } } } };
  let memory: unknown = null;
  const writes: ObjectData[] = [];
  const options: RatioMemoryOptions = {
    readWorkflow: async () => copy(workflow),
    writeWorkflow: async (patch) => {
      writes.push(copy(patch));
      workflow = merge(workflow, patch);
      return copy(workflow);
    },
    readMemory: async () => copy(memory),
    writeMemory: vi.fn(async (data: RatioMemoryData) => { memory = copy(data); }),
    coffeeKey: (w) => text(optionalObject(w.context).coffee) || null,
  };
  let runtime = createRatioMemory(options);
  return {
    options, writes, get runtime() { return runtime; },
    workflow: () => workflow, context: () => object(workflow.context), memory: () => memory as RatioMemoryData,
    external: (patch: ObjectData) => { workflow = merge(workflow, patch); },
    restart: () => { runtime = createRatioMemory(options); },
  };
}

describe("persistent ratio memory", () => {
  it("restores a fixed 80 g drink and a locked 1:2.5 independently for two coffees", async () => {
    const t = fixture();
    await t.runtime.change({ context: { targetYield: 80 } }, { explicit: true });
    t.external({ context: { targetDoseWeight: 20 } });
    await t.runtime.follow();
    expect(t.context().targetYield).toBe(80);
    await t.runtime.change({ context: { coffee: "b", targetDoseWeight: 18 } });
    expect(t.context()).toMatchObject({ targetYield: 80, extras: { lockRatio: false } });
    await t.runtime.change({ context: { extras: { lockRatio: true } } }, { ratio: 2.5 });
    expect(t.context().targetYield).toBe(45);
    t.external({ context: { targetDoseWeight: 20 } });
    await t.runtime.follow();
    expect(t.context().targetYield).toBe(50);
    expect(object(t.workflow().profile).target_weight).toBe(50);
    await t.runtime.change({ context: { coffee: "a" } });
    expect(t.context()).toMatchObject({ targetYield: 80, extras: { lockRatio: false, other: { untouched: 1 } } });
    await t.runtime.change({ context: { coffee: "b" } });
    expect(t.context()).toMatchObject({ targetYield: 50, extras: { lockRatio: true } });
  });

  it("keys each profile separately, including same-named designs, and keeps unseen profile defaults", async () => {
    const t = fixture();
    await t.runtime.change({ context: { targetYield: 80 } }, { explicit: true });
    await t.runtime.change({ profile: turbo, context: { targetYield: 60 } });
    expect(t.context()).toMatchObject({ targetYield: 60, extras: { lockRatio: false } });
    await t.runtime.change({ context: { extras: { lockRatio: true } } }, { ratio: 2.5 });
    t.external({ profile: classic, context: { targetYield: 36 } });
    await t.runtime.follow();
    expect(t.context()).toMatchObject({ targetYield: 80, extras: { lockRatio: false } });
    t.external({ profile: turbo, context: { targetYield: 60 } });
    await t.runtime.follow();
    expect(t.context()).toMatchObject({ targetYield: 45, extras: { lockRatio: true } });
    const different = { ...turbo, steps: [{ ...turbo.steps[0], pressure: 6 }] };
    await t.runtime.change({ profile: different, context: { targetYield: 70 } });
    expect(t.context().targetYield).toBe(70);
    await t.runtime.change({ profile: turbo, context: { targetYield: 60 } });
    expect(t.context().targetYield).toBe(45);
    await t.runtime.change({ profile: turbo, context: { targetYield: 60 } });
    expect(t.context().targetYield).toBe(45);
  });

  it("lets explicit recipe/shot numbers and lock flags replace memory, including same-combination loads", async () => {
    const t = fixture();
    await t.runtime.change({ context: { extras: { lockRatio: true } } }, { ratio: 2.5 });
    await t.runtime.change({ context: { coffee: "b", targetYield: 80, extras: { lockRatio: false } } }, { explicit: true });
    await t.runtime.change({ context: { coffee: "a", targetDoseWeight: 20, targetYield: 72, extras: { lockRatio: false } } }, { explicit: true });
    expect(t.context()).toMatchObject({ targetDoseWeight: 20, targetYield: 72, extras: { lockRatio: false } });
    await t.runtime.change({ context: { targetDoseWeight: 18, targetYield: 45, extras: { lockRatio: true } } }, { explicit: true });
    expect(t.context().targetYield).toBe(45);
    t.external({ context: { targetDoseWeight: 20 } });
    await t.runtime.follow();
    expect(t.context().targetYield).toBe(50);
    await t.runtime.change({ context: { coffee: "b" } });
    expect(t.context()).toMatchObject({ targetYield: 80, extras: { lockRatio: false } });
    await t.runtime.change({ context: { coffee: "a" } });
    expect(t.context()).toMatchObject({ targetYield: 50, extras: { lockRatio: true } });
  });

  it("survives restarts and preserves the exact ratio through rounded dose steps and skin writes", async () => {
    const t = fixture();
    await t.runtime.change({ context: { targetDoseWeight: 18.1, extras: { lockRatio: true } } }, { ratio: 2.35 });
    expect(t.context().targetYield).toBe(42.5);
    for (const [dose, yieldG] of [[18.2, 42.8], [18.1, 42.5], [19, 44.7], [18, 42.3]]) {
      t.external({ context: { targetDoseWeight: dose } });
      await t.runtime.follow();
      expect(t.context().targetYield).toBe(yieldG);
      expect(t.runtime.kept?.ratio).toBe(2.35);
      t.restart();
      await t.runtime.follow();
      expect(t.runtime.kept?.ratio).toBe(2.35);
    }
    t.external({ context: { targetDoseWeight: 18.2, targetYield: 42.8 } });
    await t.runtime.follow();
    expect(t.runtime.kept?.ratio).toBe(2.35);
    expect(t.memory().entries[0].choice).toEqual({ locked: true, ratio: 2.35 });
  });

  it("honours a drink edited by the user while locked and ignores old skin yields for a moment", async () => {
    const t = fixture();
    await t.runtime.change({ context: { extras: { lockRatio: true } } }, { ratio: 2.5 });
    t.external({ context: { targetDoseWeight: 20 } });
    await t.runtime.follow();
    expect(t.context().targetYield).toBe(50);
    t.external({ context: { targetDoseWeight: 19, targetYield: 45 } });
    await t.runtime.follow();
    expect(t.context().targetYield).toBe(47.5);
    t.external({ context: { targetYield: 57 } });
    await t.runtime.follow();
    expect(t.runtime.kept?.ratio).toBe(3);
    t.external({ context: { targetDoseWeight: 20 } });
    await t.runtime.follow();
    expect(t.context().targetYield).toBe(60);
  });

  it("preserves exact precision on an unseen pair or flag-only edit, but derives explicit shot numbers anew", async () => {
    const t = fixture();
    await t.runtime.change({ context: { targetDoseWeight: 18.1, extras: { lockRatio: true } } }, { ratio: 2.35 });
    await t.runtime.change({ context: { coffee: "b" } });
    expect(t.runtime.kept?.ratio).toBe(2.35);
    await t.runtime.change({ context: { extras: { lockRatio: false } } }, { explicit: true });
    await t.runtime.change({ context: { extras: { lockRatio: true } } }, { explicit: true });
    expect(t.runtime.kept?.ratio).toBe(2.35);
    await t.runtime.change({ context: { targetDoseWeight: 18.1, targetYield: 42.5 } }, { explicit: true });
    expect(t.runtime.kept?.ratio).toBe(42.5 / 18.1);
    t.external({ context: { targetDoseWeight: 100 } });
    await t.runtime.follow();
    expect(t.context().targetYield).toBe(234.8);
  });

  it("does not contaminate coffees during clearing, shot clean-up or queued event echoes", async () => {
    const t = fixture();
    await t.runtime.change({ context: { targetYield: 80 } }, { explicit: true });
    await t.runtime.change({ context: { coffee: "b", extras: { lockRatio: true } } }, { ratio: 2.5 });
    t.external({ context: { coffee: null, targetYield: 90, extras: { lockRatio: false } } });
    await t.runtime.follow();
    expect(t.memory().entries).toHaveLength(2);
    t.external({ context: { coffee: "b" } });
    await Promise.all([t.runtime.follow(), t.runtime.follow(), t.runtime.follow()]);
    expect(t.context()).toMatchObject({ targetYield: 45, extras: { lockRatio: true } });
    await t.runtime.change({ context: { coffee: "a" } });
    expect(t.context()).toMatchObject({ targetYield: 80, extras: { lockRatio: false } });
    const count = t.writes.length;
    await Promise.all([t.runtime.follow(), t.runtime.follow(), t.runtime.follow()]);
    expect(t.writes).toHaveLength(count);
    t.external({ profile: { title: "Clean", beverage_type: "cleaning" } });
    await t.runtime.follow();
    expect(t.runtime.kept).toBeNull();
    expect(t.memory().entries).toHaveLength(2);
  });

  it("reads the current combination after a slow startup store read", async () => {
    const t = fixture();
    await t.runtime.change({ context: { targetYield: 80 } }, { explicit: true });
    await t.runtime.change({ context: { coffee: "b", extras: { lockRatio: true } } }, { ratio: 2.5 });
    const read = t.options.readMemory;
    let release!: () => void;
    t.options.readMemory = async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return read();
    };
    t.restart();
    const pending = t.runtime.follow();
    await vi.waitFor(() => expect(release).toBeDefined());
    t.external({ context: { coffee: "a", targetDoseWeight: 20 } });
    release();
    await pending;
    expect(t.context()).toMatchObject({ targetYield: 80, extras: { lockRatio: false } });
  });

  it("rechecks an asynchronous identity before restoring or explicitly writing targets", async () => {
    const t = fixture();
    await t.runtime.change({ context: { targetYield: 80 } }, { explicit: true });
    await t.runtime.change({ context: { coffee: "b", extras: { lockRatio: true } } }, { ratio: 2.5 });
    const key = t.options.coffeeKey;
    for (const explicit of [false, true]) {
      t.external({ context: { coffee: "a" } });
      let release!: () => void;
      let first = true;
      t.options.coffeeKey = async (w) => {
        if (first) {
          first = false;
          await new Promise<void>((resolve) => { release = resolve; });
        }
        return key(w);
      };
      const pending = explicit ? t.runtime.change({ context: { targetDoseWeight: 20 } }, { ratio: 3 }) : t.runtime.follow();
      await vi.waitFor(() => expect(release).toBeDefined());
      t.external({ context: { coffee: "b" } });
      release();
      await pending;
      expect(t.context()).toMatchObject({ coffee: "b", targetYield: explicit ? 60 : 45 });
      expect(t.memory().entries.find((row) => row.coffee === "a")?.choice).toEqual({ locked: false, yield: 80 });
    }
  });

  it("surfaces persistence failures, retries writes and refuses malformed or future store formats", async () => {
    const t = fixture();
    await t.runtime.follow();
    const write = t.options.writeMemory;
    t.options.writeMemory = vi.fn().mockRejectedValueOnce(new Error("storageFailed")).mockImplementation(write);
    await expect(t.runtime.change({ context: { targetYield: 80 } }, { explicit: true })).rejects.toThrow("storageFailed");
    await t.runtime.follow();
    expect(t.memory().entries[0].choice).toEqual({ locked: false, yield: 80 });
    t.options.readMemory = async () => ({ version: 2, entries: [] });
    t.restart();
    await expect(t.runtime.follow()).rejects.toThrow("invalidData");
    t.options.readMemory = async () => ({ version: 1, entries: [{ coffee: "a", profile: "p", choice: { locked: true, ratio: 0 } }] });
    t.restart();
    await expect(t.runtime.follow()).rejects.toThrow("invalidData");
    t.options.readMemory = async () => { throw new Error("network"); };
    t.restart();
    await expect(t.runtime.follow()).rejects.toThrow("network");
  });

  it("persists valid explicit weights even outside the ratio numpad's input range", async () => {
    const t = fixture();
    await t.runtime.change({ context: { targetDoseWeight: 1, targetYield: 80, extras: { lockRatio: true } } }, { explicit: true });
    t.restart();
    await t.runtime.follow();
    expect(t.runtime.kept?.ratio).toBe(80);
    await t.runtime.change({ context: { targetYield: 0.5, extras: { lockRatio: false } } }, { explicit: true });
    t.restart();
    await t.runtime.follow();
    expect(t.memory().entries[0].choice).toEqual({ locked: false, yield: 0.5 });
  });

  it("restores once valid startup numbers arrive and rejects a ratio with no usable dose", async () => {
    const t = fixture();
    await t.runtime.change({ context: { targetYield: 80 } }, { explicit: true });
    t.restart();
    t.external({ context: { targetDoseWeight: null } });
    await t.runtime.follow();
    await expect(t.runtime.change({}, { ratio: 2.5 })).rejects.toThrow("invalidArguments");
    t.external({ context: { targetDoseWeight: 18, targetYield: 36 } });
    await t.runtime.follow();
    expect(t.context().targetYield).toBe(80);
  });

  it("supports a consumer's stable profile identity and empty workflow write responses", async () => {
    const t = fixture();
    t.options.profileKey = () => "stable-profile";
    const write = t.options.writeWorkflow;
    t.options.writeWorkflow = async (patch) => { await write(patch); return null; };
    t.restart();
    await t.runtime.change({ context: { targetYield: 80 } }, { explicit: true });
    t.external({ profile: { title: "Renamed" } });
    await t.runtime.follow();
    expect(t.memory().entries).toHaveLength(1);
    expect(t.memory().entries[0].profile).toBe("stable-profile");
  });
});

describe("ratioProfileKey", () => {
  it("ignores stop weight, brew temperature, notes and field order but not name or design", () => {
    const key = ratioProfileKey({ profile: classic });
    expect(ratioProfileKey({ profile: { steps: [{ ...classic.steps[0], temperature: 96 }], notes: "Changed",
      target_weight: 80, beverage_type: "espresso", title: "Classic" } })).toBe(key);
    expect(ratioProfileKey({ profile: turbo })).not.toBe(key);
    expect(ratioProfileKey({ profile: { ...classic, steps: [{ ...classic.steps[0], pressure: 6 }] } })).not.toBe(key);
    expect(ratioProfileKey({ profile: { ...classic, beverage_type: "cleaning" } })).toBeNull();
    expect(ratioProfileKey({})).toBeNull();
  });
});
