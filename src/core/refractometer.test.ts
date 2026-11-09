import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { createRefractometerRuntime, parseRefractometerPreference, sensorSubscription, type SensorSubscription } from "./refractometer";

const id = "plugin:difluid-r2.reaplugin:difluid-r2:AA:BB";
const sensor = { id, name: "DiFluid R2", average: true as const };
const info = { name: sensor.name, data: [{ key: "reading" }, { key: "measuring" }, { key: "error" }],
  commands: [{ id: "measure" }, { id: "measureAverage" }, { id: "getReading" }] };
const ok = (result: unknown) => ({ status: "ok", result });
const noReading = () => Object.assign(new Error("requestFailed"), {
  status: 500, detail: "Error: DiFluid R2 has no completed reading",
});
afterEach(() => vi.useRealTimers());

function setup() {
  vi.useFakeTimers();
  let snapshot!: (value: unknown) => void, failed!: (error: Error) => void;
  const close = vi.fn();
  const subscribe = vi.fn<SensorSubscription>(async (_path, read, fail) => {
    snapshot = read; failed = fail; return close;
  });
  const request = vi.fn(async (_path: string, _method?: string, body?: unknown) => {
    const command = (body as { commandId: string }).commandId;
    if (command === "getReading") throw noReading();
    snapshot({ status: "started", reading: {}, measuring: true, error: "" });
    return ok({ started: true });
  });
  const runtime = createRefractometerRuntime({ request, subscribe });
  return { runtime, request, subscribe, close, snapshot: (value: unknown) => snapshot(value), failed: (error: Error) => failed(error) };
}

describe("shared refractometer runtime", () => {
  it("parses reusable preferences with the prior Single/count 3 default", () => {
    expect(parseRefractometerPreference(null)).toEqual({ mode: "single", count: 3 });
    for (const mode of ["single", "average"]) for (const count of [2, 3, 10]) {
      expect(parseRefractometerPreference({ mode, count })).toEqual({ mode, count });
    }
    for (const value of [{ mode: "average", count: 1 }, { mode: "average", count: 11 }, { mode: "average", count: 2.5 },
      { mode: "other", count: 3 }, { mode: "single", count: "3" }, [], "average"]) {
      expect(() => parseRefractometerPreference(value)).toThrow("invalidArguments");
    }
    const parser = runInNewContext(`(${parseRefractometerPreference.toString()})`, { Error });
    expect(parser({ mode: "average", count: 7 })).toEqual({ mode: "average", count: 7 });
  });
  it("requires the released driver's prefix, object channel and all three commands, refusing native and unrelated sensors", () => {
    const t = setup();
    expect(t.runtime.discover([
      { id: "native", info: { name: "DiFluid R2", dataChannels: [{ key: "tds" }], commands: [{ id: "measure" }] } },
      { id, info }, { id: "unknown", info }, { id: "temp", info: { data: [{ key: "temperature" }], commands: [{ id: "measure" }] } },
    ])).toEqual([sensor]);
    expect(t.runtime.discover([{ id, info: { ...info, commands: [{ id: "measure" }, { id: "getReading" }] } }]))
      .toEqual([]);
    expect(t.runtime.discover([{ id, info: { ...info, data: undefined, dataChannels: [{ key: "reading" }] } }])).toEqual([sensor]);
    expect(() => t.runtime.discover({ sensors: [] })).toThrow("invalidData");
  });

  it("is serializable without URL, browser globals or module imports", async () => {
    const factory = runInNewContext(`(${createRefractometerRuntime.toString()})`, { setTimeout, clearTimeout, Error });
    const runtime = factory({ request: async (_path: string, _method: string, body: { commandId: string }) =>
      ok(body.commandId === "getReading" ? { reading: { tds: 9.1 } } : { started: true }), subscribe: async () => () => {} });
    expect(await runtime.measure(sensor).result).toBe(9.1);
  });

  it("refuses native sensors before opening transport or issuing commands", () => {
    const t = setup();
    expect(() => t.runtime.measure({ id: "AA:BB", name: "R2", average: true })).toThrow("sensorNotFound");
    expect(t.subscribe).not.toHaveBeenCalled();
    expect(t.request).not.toHaveBeenCalled();
  });

  it.each([1, 2, 7, 10])("subscribes before count %i starts and waits for a final result, not started or an old/intermediate snapshot", async (count) => {
    const t = setup();
    const operation = t.runtime.measure(sensor, count);
    const result = vi.fn();
    void operation.result.then(result);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.subscribe).toHaveBeenCalledWith(`/ws/v1/sensors/${encodeURIComponent(id)}/snapshot`, expect.any(Function), expect.any(Function));
    expect(t.subscribe.mock.invocationCallOrder[0]).toBeLessThan(t.request.mock.invocationCallOrder[0]!);
    expect(t.request.mock.calls[0]![2]).toEqual({ commandId: count === 1 ? "measure" : "measureAverage", params: count === 1 ? {} : { count } });
    t.snapshot({ reading: { tds: 8.1 }, status: "average_ongoing", measuring: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(result).not.toHaveBeenCalled();
    t.request.mockResolvedValueOnce(ok({ reading: { tds: 9.37 } }));
    await vi.advanceTimersByTimeAsync(500);
    expect(await operation.result).toBe(9.37);
    expect(t.close).toHaveBeenCalledOnce();
  });

  it.each(["Error: DiFluid R2 is busy", "Error: DiFluid R2 is not connected", "no_liquid", "HTTP 503"])(
    "does not treat %s as pending", async (message) => {
      const t = setup();
      t.request.mockRejectedValueOnce(Object.assign(new Error("requestFailed"), { detail: message }));
      const operation = t.runtime.measure(sensor);
      await expect(operation.result).rejects.toMatchObject({ message: "sensorFailed", detail: message });
      expect(t.request).toHaveBeenCalledTimes(1);
      expect(t.close).toHaveBeenCalledOnce();
    });

  it.each(["no_liquid", "hardware_error_1"])("reports stream device error %s without waiting for the deadline", async (error) => {
    const t = setup();
    const operation = t.runtime.measure(sensor, 7);
    const rejected = expect(operation.result).rejects.toMatchObject({ detail: error });
    await vi.advanceTimersByTimeAsync(0);
    t.snapshot({ status: "error", error, reading: {}, measuring: false });
    await rejected;
    expect(t.close).toHaveBeenCalledOnce();
    const calls = t.request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.request).toHaveBeenCalledTimes(calls);
  });

  it("cancels waiting, cleans up and does not accept a later result", async () => {
    const t = setup();
    const operation = t.runtime.measure(sensor);
    const rejected = expect(operation.result).rejects.toMatchObject({ detail: expect.stringContaining("cancelled") });
    await vi.advanceTimersByTimeAsync(0);
    operation.cancel();
    await rejected;
    expect(t.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails on disconnect and bounds even a hung start request", async () => {
    const t = setup();
    t.request.mockReturnValueOnce(new Promise(() => {}));
    const operation = t.runtime.measure(sensor, 2);
    const rejected = expect(operation.result).rejects.toMatchObject({ detail: "R2 disconnected" });
    await vi.advanceTimersByTimeAsync(0);
    t.failed(new Error("R2 disconnected"));
    await rejected;
    expect(t.close).toHaveBeenCalledOnce();
  });

  it("bounds each counted operation at the supported maximum driver deadline plus transport grace", async () => {
    const t = setup();
    const operation = t.runtime.measure(sensor, 2);
    const rejected = expect(operation.result).rejects.toMatchObject({ detail: "Measurement timed out" });
    await vi.advanceTimersByTimeAsync(370000);
    await rejected;
    expect(t.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes a subscription that opens only after cancellation, without starting the device", async () => {
    const t = setup();
    let opened!: (close: () => void) => void;
    t.subscribe.mockReturnValueOnce(new Promise((resolve) => { opened = resolve; }));
    const operation = t.runtime.measure(sensor);
    const rejected = expect(operation.result).rejects.toThrow("sensorFailed");
    operation.cancel();
    await rejected;
    opened(t.close);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.close).toHaveBeenCalledOnce();
    expect(t.request).not.toHaveBeenCalled();
  });

  it("never starts a measurement when the stream fails while subscribing", async () => {
    const t = setup();
    t.subscribe.mockImplementationOnce(async (_path, _snapshot, failed) => {
      failed(new Error("R2 disconnected"));
      return t.close;
    });
    await expect(t.runtime.measure(sensor).result).rejects.toMatchObject({ detail: "R2 disconnected" });
    expect(t.close).toHaveBeenCalledOnce();
    expect(t.request).not.toHaveBeenCalled();
  });

  it("does not hide arbitrary getReading HTTP errors behind polling", async () => {
    const t = setup();
    t.request.mockResolvedValueOnce(ok({ started: true })).mockRejectedValueOnce(Object.assign(new Error("requestFailed"), {
      status: 500, detail: "Error: DiFluid R2 is not connected",
    }));
    await expect(t.runtime.measure(sensor).result).rejects.toMatchObject({ detail: "Error: DiFluid R2 is not connected" });
    expect(t.request).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, null, 0, 31, NaN, "9.37"])("refuses malformed final TDS %s", async (tds) => {
    const t = setup();
    t.request.mockResolvedValueOnce(ok({ started: true })).mockResolvedValueOnce(ok({ reading: { tds } }));
    await expect(t.runtime.measure(sensor).result).rejects.toMatchObject({ detail: "Invalid TDS reading" });
  });

  it.each([0, 1.5, 11, NaN])("refuses invalid count %s before transport or commands", (count) => {
    const t = setup();
    expect(() => t.runtime.measure(sensor, count)).toThrow("invalidArguments");
    expect(t.request).not.toHaveBeenCalled();
    expect(t.subscribe).not.toHaveBeenCalled();
  });

  it("adapts the actual Decaid host transport data and close events", async () => {
    const open = vi.fn(async () => ({ handle: "socket-1" })), close = vi.fn(async () => {});
    let listener!: (event: { type: string; data?: unknown }) => void;
    const onEvent = vi.fn((_handle, handler) => { listener = handler; });
    const read = vi.fn(), failed = vi.fn(), report = vi.fn();
    const dispose = await sensorSubscription({ open, close, onEvent }, report)("/ws/v1/sensors/id/snapshot", read, failed);
    expect(open).toHaveBeenCalledWith({ kind: "websocket", url: "ws://localhost:8080/ws/v1/sensors/id/snapshot" });
    listener({ type: "data", data: '{"reading":{"tds":9.4}}' });
    expect(read).toHaveBeenCalledWith({ reading: { tds: 9.4 } });
    listener({ type: "close" });
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: "R2 disconnected" }));
    dispose();
    expect(close).toHaveBeenCalledWith("socket-1");
  });
});
