import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoffeeHistory, sortCoffees, type CoffeeHistoryData, type CoffeeHistoryOptions } from "./index";

type Bag = { id: string; finished: boolean };
type Shot = { id: string; bag: string | null; timestamp: number | null };
const bags: Bag[] = ["unseen", "older", "equal", "newer", "finished", "finished-old"].map((id) => ({
  id, finished: id.startsWith("finished"),
}));
const ids = (values: Bag[]) => values.map((bag) => bag.id);
const coffeeId = (bag: Bag) => bag.id, isFinished = (bag: Bag) => bag.finished;
function setup(shots: Shot[], extra: Partial<CoffeeHistoryOptions<Shot>> = {}) {
  const readShots = vi.fn(async (offset: number, limit: number) => shots.slice(offset, offset + limit));
  const readShotIds = vi.fn(async () => shots.map((s) => s.id));
  const readShot = vi.fn(async (id: string) => shots.find((s) => s.id === id) ?? null);
  const history = createCoffeeHistory({
    readShots, readShotIds, readShot, shotId: (shot: Shot) => shot.id,
    coffeeId: (shot: Shot) => shot.bag, brewedAt: (shot: Shot) => shot.timestamp, ...extra,
  });
  return { history, readShots, readShotIds, readShot };
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
afterEach(() => vi.useRealTimers());

describe("stable coffee ordering", () => {
  const lastBrewed = new Map([["older", 10], ["equal", 10], ["newer", 20], ["finished", 50]]);
  it("promotes the selected unfinished bag, then uses brew time within both groups without changing the input", () => {
    const input = [...bags];
    expect(ids(sortCoffees(input, { coffeeId, isFinished, selectedId: "older", lastBrewed })))
      .toEqual(["older", "newer", "equal", "unseen", "finished", "finished-old"]);
    expect(input).toEqual(bags);
    expect(ids(sortCoffees(input, { coffeeId, isFinished, selectedId: null, lastBrewed })))
      .toEqual(["newer", "older", "equal", "unseen", "finished", "finished-old"]);
  });
  it("never promotes a finished selection, including over another finished bag", () => {
    expect(ids(sortCoffees(bags, { coffeeId, isFinished, selectedId: "finished-old", lastBrewed })))
      .toEqual(["newer", "older", "equal", "unseen", "finished", "finished-old"]);
  });
  it("preserves ties and absent/invalid history, including pre-epoch brew times", () => {
    const lastBrewed = new Map([["older", -10], ["equal", -10], ["newer", NaN], ["unseen", Infinity]]);
    expect(ids(sortCoffees(bags, { coffeeId, isFinished, selectedId: "gone", lastBrewed })))
      .toEqual(["older", "equal", "unseen", "newer", "finished", "finished-old"]);
    expect(ids(sortCoffees(bags, { coffeeId, isFinished, selectedId: null, lastBrewed: new Map() }))).toEqual(ids(bags));
  });
});

describe("coffee brew history", () => {
  it("scans every page, keeps the newest original time and supports asynchronous identity adapters", async () => {
    const shots: Shot[] = Array.from({ length: 205 }, (_, i) => ({ id: `s${i}`, bag: `bag-${i}`, timestamp: i }));
    shots.push({ id: "winner", bag: "bag-0", timestamp: 999 }, { id: "unlinked", bag: null, timestamp: 1000 },
      { id: "invalid", bag: "invalid", timestamp: NaN }, { id: "cleaning", bag: "cleaning", timestamp: null },
      { id: "infinite", bag: "infinite", timestamp: Infinity });
    const { history, readShots } = setup(shots, { coffeeId: async (shot) => shot.bag });
    const result = await history.lastBrewed();
    expect(result.size).toBe(205);
    expect(result.get("bag-0")).toBe(999);
    expect(readShots.mock.calls).toEqual([[0, 100], [100, 100], [200, 100]]);
    (result as Map<string, number>).set("bag-0", 1);
    expect((await history.lastBrewed()).get("bag-0")).toBe(999);
    expect(readShots).toHaveBeenCalledTimes(3);
  });

  describe("saved coffee history snapshots", () => {
    const saved = { version: 1, savedAt: 123, entries: [
      { shotId: "s", coffeeId: "old", brewedAt: 1 }, { shotId: "clean", coffeeId: null, brewedAt: null },
    ] };
    it("returns saved ordering without waiting for validation and never calls it current before the full scan completes", async () => {
      const gate = deferred<Shot[]>();
      const writeMemory = vi.fn(async () => {});
      const shots = [{ id: "s", bag: "new", timestamp: 2 }, { id: "clean", bag: null, timestamp: null }];
      const { history, readShots } = setup(shots, { readMemory: async () => saved, writeMemory, readShots: () => gate.promise });
      const snapshot = await history.snapshot();
      expect([...snapshot.lastBrewed]).toEqual([["old", 1]]);
      expect(snapshot.status).toMatchObject({ source: "saved", stale: true, refreshing: true, savedAt: 123, error: null });
      expect(writeMemory).not.toHaveBeenCalled();
      gate.resolve(shots);
      expect([...await history.lastBrewed()]).toEqual([["new", 2]]);
      expect((await history.snapshot()).status).toMatchObject({ source: "current", stale: false, refreshing: false });
      expect(writeMemory).toHaveBeenCalledWith(expect.objectContaining({ version: 1, entries: [
        { shotId: "s", coffeeId: "new", brewedAt: 2 }, { shotId: "clean", coffeeId: null, brewedAt: null },
      ] }));
      expect(readShots).not.toHaveBeenCalled();
    });
    it.each([null, { version: 99 }, { ...saved, entries: [saved.entries[0], saved.entries[0]] },
      { ...saved, entries: [null] }])("marks missing or corrupt state explicitly and rebuilds it (%j)", async (memory) => {
      const shots = [{ id: "s", bag: "new", timestamp: 2 }];
      const onError = vi.fn(), writeMemory = vi.fn(async () => {});
      const { history } = setup(shots, { readMemory: async () => memory, writeMemory, onError });
      const snapshot = await history.snapshot();
      expect(snapshot.lastBrewed.size).toBe(0);
      expect(snapshot.status).toMatchObject({ source: "none", stale: true, refreshing: true,
        cache: memory === null ? "missing" : "invalid", error: memory === null ? null : "invalidData" });
      expect([...await history.lastBrewed()]).toEqual([["new", 2]]);
      expect((await history.snapshot()).status.cache).toBe(null);
      expect(onError).toHaveBeenCalledTimes(memory === null ? 0 : 1);
    });
    it("retains saved ordering on background failure, reports the error, and supports explicit retry without waiting for a TTL", async () => {
      const onError = vi.fn();
      const shots = [{ id: "s", bag: "new", timestamp: 2 }, { id: "clean", bag: null, timestamp: null }];
      const readShots = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(shots);
      const { history } = setup(shots, { readMemory: async () => saved, writeMemory: async () => {}, readShots, onError });
      await history.snapshot();
      await expect(history.lastBrewed()).rejects.toThrow("offline");
      const failed = await history.snapshot();
      expect([...failed.lastBrewed]).toEqual([["old", 1]]);
      expect(failed.status).toMatchObject({ source: "saved", stale: true, refreshing: false, error: "offline" });
      expect(readShots).toHaveBeenCalledTimes(1);
      expect((await history.snapshot({ retry: true })).status.refreshing).toBe(true);
      await history.lastBrewed();
      expect((await history.snapshot()).status.error).toBe(null);
      expect(onError).toHaveBeenCalledTimes(1);
    });
    it("surfaces memory read and write failures rather than claiming a saved/current success", async () => {
      const shots = [{ id: "s", bag: "a", timestamp: 1 }];
      const writeMemory = vi.fn().mockRejectedValueOnce(new Error("storageFailed")).mockResolvedValue(undefined);
      const { history } = setup(shots, {
        readMemory: async () => { throw new Error("network"); }, writeMemory,
      });
      const failedRead = await history.snapshot();
      expect(failedRead.status).toMatchObject({ source: "none", stale: true, refreshing: false, error: "network" });
      await expect(history.lastBrewed()).rejects.toThrow("storageFailed");
      expect((await history.snapshot()).status).toMatchObject({ source: "none", stale: true, error: "storageFailed" });
      await history.lastBrewed();
      expect((await history.snapshot()).status).toMatchObject({ source: "current", stale: false, error: null });
    });
    it("does not persist unrelated edits and keeps invalidations that arrive during a save", async () => {
      const shots = [{ id: "s", bag: "a", timestamp: 1 }];
      const writeMemory = vi.fn(async () => {});
      const { history } = setup(shots, { readMemory: async () => null, writeMemory });
      await history.lastBrewed();
      history.invalidate("s");
      await history.lastBrewed();
      expect(writeMemory).toHaveBeenCalledTimes(1);
      const save = deferred<void>();
      writeMemory.mockReturnValueOnce(save.promise);
      shots[0].bag = "b";
      history.invalidate("s");
      const reading = history.lastBrewed();
      await vi.waitFor(() => expect(writeMemory).toHaveBeenCalledTimes(2));
      shots[0].bag = "c";
      history.invalidate("s");
      save.resolve();
      expect([...await reading]).toEqual([["c", 1]]);
      expect(writeMemory).toHaveBeenCalledTimes(3);
    });
    it("requires both persistence adapters together", () => {
      expect(() => setup([], { readMemory: async () => null })).toThrow("invalidArguments");
      expect(() => setup([], { writeMemory: async () => {} })).toThrow("invalidArguments");
    });
    it("keeps independent host stores and histories isolated even when their shot IDs overlap", async () => {
      let memoryA: unknown = { ...saved, entries: [{ shotId: "s", coffeeId: "bag-a", brewedAt: 1 }] };
      let memoryB: unknown = { ...saved, entries: [{ shotId: "s", coffeeId: "bag-b", brewedAt: 2 }] };
      const a = setup([{ id: "s", bag: "bag-a", timestamp: 1 }], {
        readMemory: async () => memoryA, writeMemory: async (data) => { memoryA = data; },
      });
      const b = setup([{ id: "s", bag: "bag-b", timestamp: 2 }], {
        readMemory: async () => memoryB, writeMemory: async (data) => { memoryB = data; },
      });
      expect([...await a.history.snapshot().then((s) => s.lastBrewed)]).toEqual([["bag-a", 1]]);
      expect([...await b.history.snapshot().then((s) => s.lastBrewed)]).toEqual([["bag-b", 2]]);
      await Promise.all([a.history.lastBrewed(), b.history.lastBrewed()]);
      expect(memoryA).toMatchObject({ entries: [{ shotId: "s", coffeeId: "bag-a", brewedAt: 1 }] });
      expect(memoryB).toMatchObject({ entries: [{ shotId: "s", coffeeId: "bag-b", brewedAt: 2 }] });
    });
    it("fits 4,205 UUID shots in the real 1 MiB store limit and surfaces oversized writes without truncation", async () => {
      const uuid = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
      const shots = (count: number) => Array.from({ length: count }, (_, i) => ({
        id: uuid(i), bag: uuid(20000 + i % 40), timestamp: 1700000000000 + i * 1000,
      }));
      let bytes = 0;
      const writeMemory = vi.fn(async (data: CoffeeHistoryData) => {
        bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
        if (bytes > 1048576) throw Object.assign(new Error("requestFailed"), { status: 413 });
      });
      const normal = setup(shots(4205), { readMemory: async () => null, writeMemory });
      await normal.history.lastBrewed();
      expect(bytes).toBeLessThanOrEqual(1048576);
      expect(writeMemory.mock.lastCall![0].entries).toHaveLength(4205);
      console.info(`4,205-shot UUID history envelope: ${bytes} UTF-8 bytes (limit 1,048,576)`);
      const oversized = setup(shots(10000), { readMemory: async () => saved, writeMemory });
      await expect(oversized.history.lastBrewed()).rejects.toMatchObject({ message: "requestFailed", status: 413 });
      expect(bytes).toBeGreaterThan(1048576);
      expect(writeMemory.mock.lastCall![0].entries).toHaveLength(10000);
      expect((await oversized.history.snapshot()).status).toMatchObject({ source: "saved", stale: true, error: "requestFailed" });
    });
  });
  it("updates only the changed shot, reveals older uses, and probes silent deletions without expiring history", async () => {
    vi.useFakeTimers();
    const shots: Shot[] = [{ id: "old", bag: "a", timestamp: 1 }, { id: "new", bag: "a", timestamp: 2 }];
    const { history, readShots, readShot } = setup(shots);
    expect([...await history.lastBrewed()]).toEqual([["a", 2]]);
    shots[1] = { id: "new", bag: "c", timestamp: 2 };
    history.invalidate("new");
    expect([...await history.lastBrewed()]).toEqual([["a", 1], ["c", 2]]);
    expect(readShot.mock.calls).toEqual([["new"]]);
    shots.splice(1);
    vi.advanceTimersByTime(14999);
    expect((await history.lastBrewed()).size).toBe(2);
    vi.advanceTimersByTime(1);
    expect([...await history.lastBrewed()]).toEqual([["a", 1]]);
    expect(readShots).toHaveBeenCalledTimes(2);
  });
  it("shares concurrent reads and discards a scan invalidated during a delayed page read", async () => {
    const first = deferred<Shot[]>();
    const shots = [{ id: "s", bag: "new", timestamp: 2 }];
    const readShots = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(shots);
    const { history } = setup(shots, { readShots });
    const a = history.lastBrewed(), b = history.lastBrewed();
    await vi.waitFor(() => expect(readShots).toHaveBeenCalledTimes(1));
    history.invalidate();
    first.resolve([{ id: "s", bag: "stale", timestamp: 1 }]);
    expect([...await a]).toEqual([["new", 2]]);
    expect([...await b]).toEqual([["new", 2]]);
    expect(readShots).toHaveBeenCalledTimes(2);
  });
  it("discards invalidation during an asynchronous identity lookup too", async () => {
    const first = deferred<string | null>();
    const coffeeId = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("new");
    const { history } = setup([{ id: "s", bag: "a", timestamp: 1 }], { coffeeId });
    const reading = history.lastBrewed();
    await vi.waitFor(() => expect(coffeeId).toHaveBeenCalledTimes(1));
    history.invalidate();
    first.resolve("stale");
    expect([...await reading]).toEqual([["new", 1]]);
  });
  it("surfaces read and identity errors, never caching partial history", async () => {
    const shots = [{ id: "s", bag: "a", timestamp: 1 }];
    const readShots = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(shots);
    const { history } = setup(shots, { readShots });
    await expect(history.lastBrewed()).rejects.toThrow("offline");
    expect((await history.lastBrewed()).get("a")).toBe(1);
    const bad = setup(shots, { coffeeId: () => { throw new Error("identity"); } });
    await expect(bad.history.lastBrewed()).rejects.toThrow("identity");
    await expect(bad.history.lastBrewed()).rejects.toThrow("identity");
    expect(bad.readShots).toHaveBeenCalledTimes(2);
  });
  it("bounds retries when writes keep invalidating scans", async () => {
    const readShots = vi.fn(async () => { history.invalidate(); return []; });
    const { history } = setup([], { readShots });
    await expect(history.lastBrewed()).rejects.toThrow("coffeeHistoryChanged");
    expect(readShots).toHaveBeenCalledTimes(3);
  });
  it("accepts a zero probe interval and rejects invalid intervals", async () => {
    const { history, readShots } = setup([], { probeIntervalMs: 0 });
    await history.lastBrewed();
    await history.lastBrewed();
    expect(readShots).toHaveBeenCalledTimes(2);
    for (const probeIntervalMs of [-1, Infinity, NaN]) expect(() => setup([], { probeIntervalMs })).toThrow("invalidArguments");
  });
  it("uses a rolling page audit to recover missed same-ID edits, including old shots and non-brews", async () => {
    vi.useFakeTimers();
    const shots = Array.from({ length: 205 }, (_, i) => ({ id: `s${i}`, bag: `bag${i}`, timestamp: i }));
    const { history, readShots, readShotIds } = setup(shots);
    await history.lastBrewed();
    shots[204].bag = "reassigned";
    for (let period = 0; period < 3; period++) {
      vi.advanceTimersByTime(15000);
      const result = await history.lastBrewed();
      expect(result.has("reassigned")).toBe(period === 2);
    }
    expect((await history.lastBrewed()).has("bag204")).toBe(false);
    expect(readShots.mock.calls).toEqual([[0, 100], [100, 100], [200, 100], [0, 100], [100, 100], [200, 100]]);
    expect(readShotIds).toHaveBeenCalledTimes(5);
  });
  it("finds missed additions and deletions even when the total count is unchanged", async () => {
    vi.useFakeTimers();
    const shots = Array.from({ length: 205 }, (_, i) => ({ id: `s${i}`, bag: `bag${i}`, timestamp: i }));
    const { history, readShot } = setup(shots);
    await history.lastBrewed();
    shots[204] = { id: "imported", bag: "imported-bag", timestamp: -1000 };
    vi.advanceTimersByTime(15000);
    const result = await history.lastBrewed();
    expect(result.has("bag204")).toBe(false);
    expect(result.get("imported-bag")).toBe(-1000);
    expect(readShot.mock.calls).toEqual([["imported"]]);
  });
  it("rejects failed probes and targeted reads, retains dirty work, and retries without a complete scan", async () => {
    vi.useFakeTimers();
    const shots = [{ id: "s", bag: "a", timestamp: 1 }];
    const { history, readShots, readShotIds, readShot } = setup(shots);
    await history.lastBrewed();
    vi.advanceTimersByTime(15000);
    readShotIds.mockRejectedValueOnce(new Error("probe offline"));
    await expect(history.lastBrewed()).rejects.toThrow("probe offline");
    expect((await history.lastBrewed()).get("a")).toBe(1);
    shots[0].bag = "b";
    history.invalidate("s");
    readShot.mockRejectedValueOnce(new Error("shot offline"));
    await expect(history.lastBrewed()).rejects.toThrow("shot offline");
    expect([...await history.lastBrewed()]).toEqual([["b", 1]]);
    expect(readShots).toHaveBeenCalledTimes(2);
  });
  it("retries membership shifts and rejects malformed or incomplete histories rather than truncating", async () => {
    const shots = Array.from({ length: 101 }, (_, i) => ({ id: `s${i}`, bag: "a", timestamp: i }));
    const bad = setup(shots, { readShots: async () => shots.slice(0, 99) });
    await expect(bad.history.lastBrewed()).rejects.toThrow("coffeeHistoryChanged");
    const duplicate = setup([], { readShotIds: async () => ["a", "a"] });
    await expect(duplicate.history.lastBrewed()).rejects.toThrow("invalidData");
  });
  it("does not restart a full scan when an event arrives during an incremental probe", async () => {
    vi.useFakeTimers();
    const shots = [{ id: "s", bag: "a", timestamp: 1 }];
    const { history, readShotIds, readShots } = setup(shots);
    await history.lastBrewed();
    vi.advanceTimersByTime(15000);
    const blocked = deferred<string[]>();
    readShotIds.mockReturnValueOnce(blocked.promise);
    const a = history.lastBrewed(), b = history.lastBrewed();
    history.invalidate("s");
    shots[0].bag = "b";
    blocked.resolve(["s"]);
    expect([...await a]).toEqual([["b", 1]]);
    expect([...await b]).toEqual([["b", 1]]);
    expect(readShots).toHaveBeenCalledTimes(2);
  });
  it("starts the probe interval at completion, even when cold initialization takes longer than 15 seconds", async () => {
    vi.useFakeTimers();
    const shots = [{ id: "s", bag: "a", timestamp: 1 }];
    const readShots = vi.fn(async () => { vi.setSystemTime(Date.now() + 21000); return shots; });
    const { history, readShotIds } = setup(shots, { readShots });
    await history.lastBrewed();
    vi.advanceTimersByTime(14999);
    await history.lastBrewed();
    expect(readShots).toHaveBeenCalledTimes(1);
    expect(readShotIds).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    await history.lastBrewed();
    expect(readShots).toHaveBeenCalledTimes(2);
  });
  it("keeps a failed rolling audit atomic and retries the same page", async () => {
    vi.useFakeTimers();
    const shots = Array.from({ length: 205 }, (_, i) => ({ id: `s${i}`, bag: `bag${i}`, timestamp: i }));
    let fail = false;
    const coffeeId = vi.fn((s: Shot) => {
      if (fail && s.id === "s1") throw new Error("identity offline");
      return s.bag;
    });
    const { history, readShots } = setup(shots, { coffeeId });
    await history.lastBrewed();
    shots[0].bag = "changed";
    fail = true;
    vi.advanceTimersByTime(15000);
    await expect(history.lastBrewed()).rejects.toThrow("identity offline");
    fail = false;
    const result = await history.lastBrewed();
    expect(result.has("bag0")).toBe(false);
    expect(result.get("changed")).toBe(0);
    expect(readShots.mock.calls.slice(-2)).toEqual([[0, 100], [0, 100]]);
  });
  it("handles invalidation during a targeted identity lookup without resurrecting its old bag", async () => {
    const shots = [{ id: "s", bag: "a", timestamp: 1 }];
    const first = deferred<string | null>();
    let blocked = false;
    const coffeeId = vi.fn((s: Shot) => blocked ? first.promise : s.bag);
    const { history, readShots, readShot } = setup(shots, { coffeeId });
    await history.lastBrewed();
    blocked = true;
    shots[0].bag = "b";
    history.invalidate("s");
    const reading = history.lastBrewed();
    await vi.waitFor(() => expect(readShot).toHaveBeenCalledTimes(1));
    shots[0].bag = "c";
    history.invalidate("s");
    blocked = false;
    first.resolve("b");
    expect([...await reading]).toEqual([["c", 1]]);
    expect(readShot).toHaveBeenCalledTimes(2);
    expect(readShots).toHaveBeenCalledTimes(1);
  });
  it("bounds cold reads to four in flight, reads exact-cap totals completely and waits for all pages", async () => {
    const shots = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, bag: `bag${i}`, timestamp: i }));
    const gates = Array.from({ length: 5 }, () => deferred<Shot[]>());
    const readShots = vi.fn((offset: number) => gates[offset / 100].promise);
    const { history } = setup(shots, { readShots });
    let finished = false;
    const reading = history.lastBrewed().then((result) => { finished = true; return result; });
    await vi.waitFor(() => expect(readShots).toHaveBeenCalledTimes(4));
    expect(finished).toBe(false);
    for (const i of [2, 0, 3]) gates[i].resolve(shots.slice(i * 100, (i + 1) * 100));
    await Promise.resolve();
    expect(readShots).toHaveBeenCalledTimes(4);
    gates[1].resolve(shots.slice(100, 200));
    await vi.waitFor(() => expect(readShots).toHaveBeenCalledTimes(5));
    expect(finished).toBe(false);
    gates[4].resolve(shots.slice(400));
    expect((await reading).size).toBe(500);
    expect(readShots.mock.calls).toEqual([[0, 100], [100, 100], [200, 100], [300, 100], [400, 100]]);
  });
  it.each(["synchronous", "asynchronous"] as const)("drains %s page failures before reads reject or retries start", async (mode) => {
    const shots = Array.from({ length: 205 }, (_, i) => ({ id: `s${i}`, bag: "a", timestamp: i }));
    const slow = deferred<Shot[]>();
    const readShots = vi.fn((offset: number) => {
      if (offset === 0) {
        if (mode === "synchronous") throw new Error("page offline");
        return Promise.reject(new Error("page offline"));
      }
      return offset === 100 ? slow.promise : Promise.resolve(shots.slice(200));
    });
    const { history } = setup(shots, { readShots });
    let failed = false;
    const reading = history.lastBrewed().catch((error: unknown) => { failed = true; throw error; });
    const rejection = expect(reading).rejects.toThrow("page offline");
    await vi.waitFor(() => expect(readShots).toHaveBeenCalledTimes(3));
    await Promise.resolve();
    expect(failed).toBe(false);
    slow.resolve(shots.slice(100, 200));
    await rejection;
    readShots.mockImplementation(async (offset) => shots.slice(offset, offset + 100));
    expect((await history.lastBrewed()).get("a")).toBe(204);
    expect(readShots).toHaveBeenCalledTimes(6);
  });
});
