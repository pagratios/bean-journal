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
  /** A complete, consistently ordered shot listing. Return fewer than limit only at the end. */
  readShots: (offset: number, limit: number) => Promise<readonly Shot[]>;
  /** A stable bag id, never a display name. Null means the shot cannot be assigned confidently. */
  coffeeId: (shot: Shot) => string | null | Promise<string | null>;
  /** The original brew time in milliseconds, not an edit/upload time. Null excludes non-brews. */
  brewedAt: (shot: Shot) => number | null;
  /** Deletions may emit no event: history expires even when the host never invalidates it. Default: 15 seconds. */
  maxAgeMs?: number;
};

/** Rebuilds history from shot snapshots so deletion/reassignment also removes an old bag's last use. */
export function createCoffeeHistory<Shot>(options: CoffeeHistoryOptions<Shot>) {
  const maxAgeMs = options.maxAgeMs ?? 15000;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) throw new Error("invalidArguments");
  type Snapshot = { at: number; lastBrewed: ReadonlyMap<string, number> };
  let generation = 0;
  let cached: Snapshot | null = null;
  let pending: { generation: number; promise: Promise<Snapshot | null> } | null = null;

  function invalidate() { generation++; cached = null; }

  async function scan(version: number): Promise<Snapshot | null> {
    const at = Date.now(), lastBrewed = new Map<string, number>(), limit = 100;
    for (let offset = 0; ; offset += limit) {
      const shots = await options.readShots(offset, limit);
      if (version !== generation) return null;
      for (const shot of shots) {
        const timestamp = options.brewedAt(shot);
        if (timestamp === null || !Number.isFinite(timestamp)) continue;
        const id = await options.coffeeId(shot);
        if (version !== generation) return null;
        if (id && (!lastBrewed.has(id) || timestamp > lastBrewed.get(id)!)) lastBrewed.set(id, timestamp);
      }
      if (shots.length < limit) break;
    }
    return cached = { at, lastBrewed };
  }

  async function lastBrewed(): Promise<ReadonlyMap<string, number>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (cached && Date.now() - cached.at < maxAgeMs) return new Map(cached.lastBrewed);
      const version = generation;
      if (!pending || pending.generation !== version) pending = { generation: version, promise: scan(version) };
      const reading = pending;
      let snapshot: Snapshot | null;
      try { snapshot = await reading.promise; }
      finally { if (pending === reading) pending = null; }
      if (snapshot && version === generation) return new Map(snapshot.lastBrewed);
    }
    throw new Error("coffeeHistoryChanged");
  }

  return { lastBrewed, invalidate };
}
