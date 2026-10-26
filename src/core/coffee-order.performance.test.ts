import { expect, it, vi } from "vitest";
import { createCoffeeHistory } from "./coffee-order";

it("measures a retained index over 4,205 shots with 100-item caps and 300ms request latency", async () => {
  type Shot = { id: string; bag: string; time: number; notes?: string };
  const shots: Shot[] = Array.from({ length: 4205 }, (_, i) => ({ id: `s${i}`, bag: `bag${i % 40}`, time: 5000 - i }));
  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 300));
  let clockOffset = 0;
  const realNow = Date.now.bind(Date);
  const now = vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);
  const counts = { pages: 0, ids: 0, shots: 0 };
  let failProbe = false;
  const history = createCoffeeHistory({
    readShots: async (offset, limit) => {
      counts.pages++;
      await delay();
      return shots.slice(offset, offset + Math.min(limit, 100)).map((s) => ({ ...s }));
    },
    readShotIds: async () => {
      counts.ids++;
      await delay();
      if (failProbe) { failProbe = false; throw new Error("probe offline"); }
      return shots.map((s) => s.id);
    },
    readShot: async (id) => { counts.shots++; await delay(); return shots.find((s) => s.id === id) ?? null; },
    shotId: (s: Shot) => s.id, coffeeId: (s) => s.bag, brewedAt: (s) => s.time,
  });
  const measurements: { scenario: string; ms: number; pages: number; ids: number; shots: number }[] = [];
  async function measure(scenario: string) {
    const before = { ...counts }, start = performance.now();
    try { return await history.lastBrewed(); }
    finally {
      measurements.push({ scenario, ms: Math.round(performance.now() - start),
        pages: counts.pages - before.pages, ids: counts.ids - before.ids, shots: counts.shots - before.shots });
    }
  }
  try {
    expect((await measure("cold / first view")).get("bag39")).toBe(4961);
    expect(measurements[0]).toMatchObject({ pages: 43, ids: 2, shots: 0 });
    expect(measurements[0].ms).toBeLessThan(6000);
    for (let period = 1; period <= 4; period++) {
      clockOffset += 15000;
      await measure(`unchanged +${period * 15}s`);
      expect(measurements.at(-1)).toMatchObject({ pages: 1, ids: 1, shots: 0 });
      expect(measurements.at(-1)!.ms).toBeLessThan(1000);
    }
    shots.unshift({ id: "new", bag: "new-bag", time: 6000 });
    history.invalidate("new");
    expect((await measure("new brew")).get("new-bag")).toBe(6000);
    expect(measurements.at(-1)).toMatchObject({ pages: 0, ids: 0, shots: 1 });
    shots[1].notes = "edited; not a brew";
    history.invalidate(shots[1].id);
    expect((await measure("notes / rating edit")).get("bag0")).toBe(5000);
    shots[0].bag = "reassigned";
    history.invalidate("new");
    const reassigned = await measure("reassignment");
    expect(reassigned.has("new-bag")).toBe(false);
    expect(reassigned.get("reassigned")).toBe(6000);
    shots.splice(0, 1);
    clockOffset += 15000;
    expect((await measure("silent deletion")).has("reassigned")).toBe(false);
    expect(measurements.at(-1)).toMatchObject({ pages: 1, ids: 1, shots: 0 });
    for (const sample of measurements.slice(5)) expect(sample.ms).toBeLessThan(1000);
    clockOffset += 15000;
    const changing = measure("concurrent invalidation");
    history.invalidate("s1");
    const shared = history.lastBrewed();
    expect([...await changing]).toEqual([...await shared]);
    expect(measurements.at(-1)).toMatchObject({ pages: 1, ids: 2, shots: 1 });
    clockOffset += 15000;
    failProbe = true;
    await expect(measure("failed probe")).rejects.toThrow("probe offline");
    expect(measurements.at(-1)).toMatchObject({ pages: 0, ids: 1, shots: 0 });
    await measure("probe retry");
    expect(measurements.at(-1)).toMatchObject({ pages: 1, ids: 1, shots: 0 });
    console.table(measurements);
  } finally { now.mockRestore(); }
}, 45000);
