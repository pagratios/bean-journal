export type CoffeeSortOptions<Coffee> = {
  coffeeId: (coffee: Coffee) => string;
  isFinished: (coffee: Coffee) => boolean;
  selectedId: string | null;
  lastBrewed: ReadonlyMap<string, number>;
};

/** Finished last, selected unfinished first, then newest brew; ties keep the input order. Never mutates the input. */
export function sortCoffees<Coffee>(coffees: readonly Coffee[], options: CoffeeSortOptions<Coffee>): Coffee[] {
  const { coffeeId, isFinished, selectedId, lastBrewed } = options;
  return coffees.map((coffee, index) => {
    const id = coffeeId(coffee), timestamp = lastBrewed.get(id);
    return { coffee, index, finished: isFinished(coffee), selected: !!selectedId && id === selectedId,
      timestamp: timestamp !== undefined && Number.isFinite(timestamp) ? timestamp : -Infinity };
  }).sort((a, b) => Number(a.finished) - Number(b.finished)
    || (!a.finished ? Number(b.selected) - Number(a.selected) : 0)
    || (a.timestamp === b.timestamp ? 0 : a.timestamp > b.timestamp ? -1 : 1)
    || a.index - b.index).map(({ coffee }) => coffee);
}

export type CoffeeHistoryOptions<Shot> = {
  /** Complete summaries in a stable order. Pages are always requested at Decaid's actual cap of 100. */
  readShots: (offset: number, limit: number) => Promise<readonly Shot[]>;
  /** All shot IDs, including non-brews. This is a lightweight membership query, not full shot records. */
  readShotIds: () => Promise<readonly string[]>;
  /** Read current identity/time after an event. Return null only for a confirmed missing shot. */
  readShot: (id: string) => Promise<Shot | null>;
  shotId: (shot: Shot) => string;
  /** A stable bag id, never a display name. Null means the shot cannot be assigned confidently. */
  coffeeId: (shot: Shot) => string | null | Promise<string | null>;
  /** The original brew time in milliseconds, not an edit/upload time. Null excludes non-brews. */
  brewedAt: (shot: Shot) => number | null;
  /** Interval between membership probes and one-page missed-edit audits, measured from completion. Default: 15s. */
  probeIntervalMs?: number;
};

/** Retains every shot's use, so removing/reassigning a winner reveals the next brew without rescanning history. */
export function createCoffeeHistory<Shot>(options: CoffeeHistoryOptions<Shot>) {
  const interval = options.probeIntervalMs ?? 15000;
  if (!Number.isFinite(interval) || interval < 0) throw new Error("invalidArguments");
  type Use = { coffee: string | null; time: number | null };
  type Snapshot = { uses: Map<string, Use>; lastBrewed: ReadonlyMap<string, number> };
  let generation = 0;
  let cached: Snapshot | null = null;
  let pending: Promise<void> | null = null;
  let dirty = new Set<string>();
  let rebuild = true;
  let probedAt: number | null = null;
  let auditOffset = 0;
  const changed = new Error("coffeeHistoryChanged");

  /** Supply an event/write's shot ID; no ID requests an explicit complete reconciliation. */
  function invalidate(id?: string) {
    generation++;
    if (id) dirty.add(id);
    else rebuild = true;
  }
  function check(version: number) { if (version !== generation) throw changed; }
  async function ids() {
    const values = await options.readShotIds();
    if (!Array.isArray(values) || values.some((id) => typeof id !== "string" || !id) || new Set(values).size !== values.length)
      throw new Error("invalidData");
    return new Set(values);
  }
  function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>) {
    return a.size === b.size && [...a].every((id) => b.has(id));
  }
  async function use(shot: Shot, uses: Map<string, Use>, version: number) {
    const id = options.shotId(shot);
    if (typeof id !== "string" || !id) throw new Error("invalidData");
    const time = options.brewedAt(shot);
    const coffee = time !== null && Number.isFinite(time) ? await options.coffeeId(shot) : null;
    check(version);
    uses.set(id, { coffee, time: time !== null && Number.isFinite(time) ? time : null });
  }
  async function scan(version: number) {
    const before = await ids(), uses = new Map<string, Use>(), limit = 100;
    check(version);
    const pages = Math.max(1, Math.ceil(before.size / limit));
    for (let page = 0; page < pages; page += 4) {
      // Bound tablet load, and drain every read before retrying so failed/invalidated scans never overlap.
      const results = await Promise.allSettled(Array.from({ length: Math.min(4, pages - page) },
        async (_, i) => options.readShots((page + i) * limit, limit)));
      for (const result of results) if (result.status === "rejected") throw result.reason;
      check(version);
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status !== "fulfilled") throw new Error("invalidData");
        const shots = result.value, offset = (page + i) * limit;
        if (!Array.isArray(shots) || shots.length > limit) throw new Error("invalidData");
        if (shots.length !== Math.min(limit, before.size - offset)) throw changed;
        for (const shot of shots) {
          if (uses.has(options.shotId(shot))) throw changed;
          await use(shot, uses, version);
        }
      }
    }
    const after = await ids();
    check(version);
    if (!sameIds(before, after) || !sameIds(after, new Set(uses.keys()))) throw changed;
    return uses;
  }
  async function refresh() {
    for (let attempt = 0; attempt < 3; attempt++) {
      const version = generation;
      try {
        const full = rebuild || !cached;
        const probe = full || probedAt === null || Date.now() - probedAt >= interval;
        if (!full && !probe && !dirty.size) return;
        let uses: Map<string, Use>, nextOffset = auditOffset;
        if (full) {
          uses = await scan(version);
          nextOffset = 0;
        } else {
          uses = new Map(cached!.uses);
          const updates = new Set(dirty);
          if (probe) {
            const current = await ids();
            check(version);
            for (const id of uses.keys()) if (!current.has(id)) uses.delete(id);
            for (const id of current) if (!uses.has(id)) updates.add(id);
            // IDs detect silent deletes/additions, not missed edits. Audit a bounded page, never expire the index.
            const offset = auditOffset < current.size ? auditOffset : 0;
            const shots = await options.readShots(offset, 100);
            check(version);
            if (!Array.isArray(shots) || shots.length > 100) throw new Error("invalidData");
            if (shots.length !== Math.min(100, current.size - offset)
              || new Set(shots.map(options.shotId)).size !== shots.length) throw changed;
            for (const shot of shots) {
              if (!current.has(options.shotId(shot))) throw changed;
              await use(shot, uses, version);
            }
            nextOffset = shots.length < 100 || offset + shots.length >= current.size ? 0 : offset + shots.length;
          }
          for (const id of updates) {
            const shot = await options.readShot(id);
            check(version);
            if (shot === null) uses.delete(id);
            else {
              if (options.shotId(shot) !== id) throw new Error("invalidData");
              await use(shot, uses, version);
            }
          }
        }
        check(version);
        const lastBrewed = new Map<string, number>();
        for (const { coffee, time } of uses.values()) {
          if (coffee && time !== null && (!lastBrewed.has(coffee) || time > lastBrewed.get(coffee)!)) lastBrewed.set(coffee, time);
        }
        cached = { uses, lastBrewed };
        dirty = new Set();
        rebuild = false;
        auditOffset = nextOffset;
        if (probe) probedAt = Date.now();
        return;
      } catch (error) {
        if (error !== changed) throw error;
      }
    }
    throw changed;
  }
  async function lastBrewed(): Promise<ReadonlyMap<string, number>> {
    if (!pending) {
      pending = refresh().finally(() => { pending = null; });
    }
    await pending;
    if (rebuild || dirty.size) return lastBrewed();
    return new Map(cached!.lastBrewed);
  }

  return { lastBrewed, invalidate };
}
