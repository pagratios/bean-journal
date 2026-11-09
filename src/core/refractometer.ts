export type Refractometer = { id: string; name: string; average: true };
export type SensorSubscription = (
  path: string, snapshot: (value: unknown) => void, failed: (error: Error) => void,
) => Promise<() => void>;
export type SensorTransport = {
  open(options: { kind: "websocket"; url: string }): Promise<{ handle: string }>;
  onEvent(handle: string, listener: (event: { type: string; data?: unknown; message?: string }) => void): void;
  close(handle: string): Promise<unknown>;
};

/** Self-contained so the same protocol can be serialized into a browser page. */
export function createRefractometerRuntime(options: {
  request: (path: string, method?: string, body?: unknown) => Promise<unknown>;
  subscribe: SensorSubscription;
  timeoutPerSampleMs?: number;
}) {
  type Data = Record<string, unknown>;
  const obj = (v: unknown): Data => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Data : {};
  const rows = (v: unknown) => Array.isArray(v) ? v.map(obj) : [];
  const prefix = "plugin:difluid-r2.reaplugin:difluid-r2:";
  const community = (id: string) => id.startsWith(prefix);
  const timeout = options.timeoutPerSampleMs ?? 180000;
  if (!Number.isInteger(timeout) || timeout < 15000 || timeout > 180000) throw new Error("invalidArguments");
  const error = (detail: string) => Object.assign(new Error("sensorFailed"), { detail });
  const detail = (e: unknown) => {
    const value = obj(e);
    return typeof value.detail === "string" && value.detail ? value.detail
      : e instanceof Error ? e.message : "Invalid sensor response";
  };
  function discover(value: unknown): Refractometer[] {
    if (!Array.isArray(value)) throw new Error("invalidData");
    return rows(value).filter((s) => {
      const info = obj(s.info), commands = rows(info.commands);
      const channels = [...rows(info.data), ...rows(info.dataChannels)];
      return typeof s.id === "string" && community(s.id) && channels.some((c) => c.key === "reading")
        && ["measure", "measureAverage", "getReading"].every((id) => commands.some((c) => c.id === id));
    }).map((s) => {
      const id = String(s.id), info = obj(s.info);
      return { id, name: typeof info.name === "string" ? info.name : "", average: true as const };
    }).sort((a, b) => Number(/\bR2\b/i.test(b.name)) - Number(/\bR2\b/i.test(a.name)));
  }
  function measure(sensor: Refractometer, count = 1) {
    if (!community(sensor.id) || !sensor.average) throw new Error("sensorNotFound");
    if (!Number.isInteger(count) || count < 1 || count > 10) {
      throw new Error("invalidArguments");
    }
    let finished = false;
    let cancel!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => { finished = true; reject(error("Measurement cancelled; the R2 may still be busy")); };
    });
    let deadline: ReturnType<typeof setTimeout>;
    let close: (() => void) | undefined;
    const waiters = new Set<() => void>();
    const bounded = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => { finished = true; reject(error("Measurement timed out")); }, timeout * count + 10000);
    });
    let fail!: (e: Error) => void;
    const broken = new Promise<never>((_, reject) => {
      fail = (e) => { finished = true; reject(error(detail(e))); };
    });
    const execute = async (commandId: string, params: Data) => {
      if (finished) throw error("Measurement cancelled");
      const value = obj(await options.request(`/sensors/${encodeURIComponent(sensor.id)}/execute`, "POST", { commandId, params }));
      if (value.status !== "ok") throw error(String(value.message ?? value.error ?? "Invalid sensor response"));
      return obj(value.result);
    };
    const readTds = (result: Data) => {
      const tds = obj(result.reading).tds;
      if (typeof tds !== "number" || !Number.isFinite(tds) || tds <= 0 || tds > 30) throw error("Invalid TDS reading");
      return tds;
    };
    const work = async () => {
      let commandSent = false, started = false, acknowledged = false;
      close = await options.subscribe(`/ws/v1/sensors/${encodeURIComponent(sensor.id)}/snapshot`, (value) => {
        const snapshot = obj(value);
        // Ignore a replay of the previous test. The command clears its reading before acknowledging start.
        if (commandSent && (snapshot.status === "started" || snapshot.status === "average_started")) started = true;
        if ((started || acknowledged) && typeof snapshot.error === "string" && snapshot.error) fail(error(snapshot.error));
      }, fail);
      if (finished) { close(); close = undefined; throw error("Measurement cancelled"); }
      commandSent = true;
      const result = await execute(count === 1 ? "measure" : "measureAverage", count === 1 ? {} : { count });
      if (result.started !== true) throw error("The R2 did not acknowledge measurement start");
      if (finished) throw error("Measurement cancelled");
      acknowledged = true;
      while (!finished) {
        try {
          // v0.2.0 clears getReading at start and exposes only the completed aggregate, never intermediate samples.
          return readTds(await execute("getReading", {}));
        } catch (e) {
          if (detail(e) !== "Error: DiFluid R2 has no completed reading") throw e;
        }
        if (finished) throw error("Measurement cancelled");
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
          const timer = setTimeout(done, 500);
          waiters.add(done);
        });
      }
      throw error("Measurement cancelled");
    };
    const completed = work();
    const result = Promise.race([completed, broken, cancelled, bounded]).catch((e: unknown) => {
      throw error(detail(e));
    }).finally(() => {
      finished = true;
      clearTimeout(deadline);
      close?.();
      close = undefined;
      for (const done of waiters) done();
    });
    return { result, cancel };
  }
  return { discover, measure };
}

/** Decaid's plugin transport, not a browser WebSocket global. */
export function sensorSubscription(transport: SensorTransport, report: (error: unknown) => void): SensorSubscription {
  return async (path, snapshot, failed) => {
    const { handle } = await transport.open({ kind: "websocket", url: `ws://localhost:8080${path}` });
    const close = () => { void transport.close(handle).catch(report); };
    try {
      transport.onEvent(handle, (event) => {
        if (event.type === "data") {
          try { snapshot(JSON.parse(String(event.data))); }
          catch { failed(new Error("Invalid sensor snapshot")); }
        } else if (event.type === "error" || event.type === "close") {
          failed(new Error(event.message || "R2 disconnected"));
        }
      });
    } catch (e) { close(); throw e; }
    return close;
  };
}
