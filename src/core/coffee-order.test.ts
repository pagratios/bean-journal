import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoffeeHistory, sortCoffees, type CoffeeHistoryOptions } from "./index";

type Bag = { id: string; finished: boolean };
type Shot = { bag: string | null; timestamp: number | null };
const bags: Bag[] = ["unseen", "older", "equal", "newer", "finished", "finished-old"].map((id) => ({
  id, finished: id.startsWith("finished"),
}));
const ids = (values: Bag[]) => values.map((bag) => bag.id);
const coffeeId = (bag: Bag) => bag.id, isFinished = (bag: Bag) => bag.finished;
function setup(shots: Shot[], extra: Partial<CoffeeHistoryOptions<Shot>> = {}) {
  const readShots = vi.fn(async (offset: number, limit: number) => shots.slice(offset, offset + limit));
  const history = createCoffeeHistory({
    readShots, coffeeId: (shot: Shot) => shot.bag, brewedAt: (shot: Shot) => shot.timestamp, ...extra,
  });
  return { history, readShots };
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
    const shots: Shot[] = Array.from({ length: 205 }, (_, i) => ({ bag: `bag-${i}`, timestamp: i }));
    shots.push({ bag: "bag-0", timestamp: 999 }, { bag: null, timestamp: 1000 }, { bag: "invalid", timestamp: NaN },
      { bag: "cleaning", timestamp: null }, { bag: "infinite", timestamp: Infinity });
    const { history, readShots } = setup(shots, { coffeeId: async (shot) => shot.bag });
    const result = await history.lastBrewed();
    expect(result.size).toBe(205);
    expect(result.get("bag-0")).toBe(999);
    expect(readShots.mock.calls).toEqual([[0, 100], [100, 100], [200, 100]]);
    (result as Map<string, number>).set("bag-0", 1);
    expect((await history.lastBrewed()).get("bag-0")).toBe(999);
    expect(readShots).toHaveBeenCalledTimes(3);
  });
  it("rebuilds on invalidation and expires without an event, removing reassigned and deleted uses", async () => {
    vi.useFakeTimers();
    const shots: Shot[] = [{ bag: "a", timestamp: 1 }, { bag: "b", timestamp: 2 }];
    const { history, readShots } = setup(shots);
    expect([...await history.lastBrewed()]).toEqual([["a", 1], ["b", 2]]);
    shots[1] = { bag: "c", timestamp: 2 };
    history.invalidate();
    expect([...await history.lastBrewed()]).toEqual([["a", 1], ["c", 2]]);
    shots.splice(0);
    vi.advanceTimersByTime(14999);
    expect((await history.lastBrewed()).size).toBe(2);
    vi.advanceTimersByTime(1);
    expect((await history.lastBrewed()).size).toBe(0);
    expect(readShots).toHaveBeenCalledTimes(3);
  });
  it("shares concurrent reads and discards a scan invalidated during a delayed page read", async () => {
    const first = deferred<Shot[]>();
    const readShots = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([{ bag: "new", timestamp: 2 }]);
    const { history } = setup([], { readShots });
    const a = history.lastBrewed(), b = history.lastBrewed();
    expect(readShots).toHaveBeenCalledTimes(1);
    history.invalidate();
    first.resolve([{ bag: "stale", timestamp: 1 }]);
    expect([...await a]).toEqual([["new", 2]]);
    expect([...await b]).toEqual([["new", 2]]);
    expect(readShots).toHaveBeenCalledTimes(2);
  });
  it("discards invalidation during an asynchronous identity lookup too", async () => {
    const first = deferred<string | null>();
    const coffeeId = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("new");
    const { history } = setup([{ bag: "a", timestamp: 1 }], { coffeeId });
    const reading = history.lastBrewed();
    await vi.waitFor(() => expect(coffeeId).toHaveBeenCalledTimes(1));
    history.invalidate();
    first.resolve("stale");
    expect([...await reading]).toEqual([["new", 1]]);
  });
  it("surfaces read and identity errors, never caching partial history", async () => {
    const readShots = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue([{ bag: "a", timestamp: 1 }]);
    const { history } = setup([], { readShots });
    await expect(history.lastBrewed()).rejects.toThrow("offline");
    expect((await history.lastBrewed()).get("a")).toBe(1);
    const bad = setup([{ bag: "a", timestamp: 1 }], { coffeeId: () => { throw new Error("identity"); } });
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
  it("accepts a zero TTL and rejects invalid cache ages", async () => {
    const { history, readShots } = setup([], { maxAgeMs: 0 });
    await history.lastBrewed();
    await history.lastBrewed();
    expect(readShots).toHaveBeenCalledTimes(2);
    for (const maxAgeMs of [-1, Infinity, NaN]) expect(() => setup([], { maxAgeMs })).toThrow("invalidArguments");
  });
});
