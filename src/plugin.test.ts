import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { texts } from "./i18n";
import { createPlugin, PLUGIN_ID, VERSION } from "./plugin";
import { object, optionalObject, type ObjectData } from "./protocol";

const profile = { title: "Classic", beverage_type: "espresso", steps: [{ name: "Pour", pump: "pressure", pressure: 9, temperature: 93, seconds: 30 }] };
const token = "bjm_" + "a".repeat(43), publicToken = "bjm_" + "b".repeat(43);

function merge(target: ObjectData, patch: ObjectData): ObjectData {
  const out: ObjectData = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" ? merge(out[k] as ObjectData, v as ObjectData) : v;
  }
  return out;
}
function makeShot(id: string, ageSeconds: number, context: ObjectData = {}, annotations: ObjectData = {}, shotProfile: ObjectData = profile): ObjectData {
  const start = Date.now() + ageSeconds * 1000;
  return {
    id, timestamp: new Date(start).toISOString(), updatedAt: new Date(start).toISOString(),
    workflow: { profile: shotProfile, context: { targetDoseWeight: 18, targetYield: 36, ...context } }, annotations,
    measurements: [0, 15, 30].map((t) => ({
      machine: { timestamp: new Date(start + t * 1000).toISOString(), state: { state: "espresso", substate: "pouring" }, pressure: 9, flow: 2, profileFrame: 0, groupTemperature: 93 },
      scale: { weight: t * 1.2 },
    })),
  };
}

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).forEach((f) => f()); vi.unstubAllGlobals(); vi.useRealTimers(); });

type World = { beans?: ObjectData[]; batches?: ObjectData[]; phase?: string; slowWorkflow?: number; settingsStatus?: number; sensors?: ObjectData[]; workflowEvents?: boolean };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function setup(settings: ObjectData = {}, world: World = {}) {
  vi.stubGlobal("__DECAID_COPY__", texts);
  vi.stubGlobal("__DECAID_THEME__", ":root{--bg:white}");
  let workflow: ObjectData = { profile, context: { targetDoseWeight: 18, targetYield: 36 } };
  const shots = new Map<string, ObjectData>();
  const store = new Map<string, unknown>();
  const beans: ObjectData[] = world.beans ?? [];
  const batches: ObjectData[] = world.batches ?? [];
  const grinders: ObjectData[] = [{ id: "g-lagom", model: "Lagom 01", settingType: "numeric", settingSmallStep: 0.1, rpmSmallStep: 50, archived: false },
    { id: "g-old", model: "Old grinder", settingType: "preset", settingValues: ["Fine"], archived: true }];
  const profiles: ObjectData[] = [{ id: "profile:turbo", visibility: "visible", isDefault: true, updatedAt: "2026-10-12T00:00:00Z",
    profile: { title: "Turbo Shot", beverage_type: "espresso", target_weight: 50, steps: [{ name: "Pour", pump: "pressure", pressure: 6, temperature: 92, seconds: 20 }] } }];
  const calls: { url: string; method: string; body: unknown }[] = [];
  const emitted: { event: string; payload: unknown }[] = [];
  let nextId = 1;
  const stamp = () => new Date(Date.now() + nextId++).toISOString().replace("Z", "");
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || "GET";
    const body: unknown = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    if (!url.startsWith("http://localhost:8080/api/v1/")) throw new Error(`Outside Decaid: ${url}`);
    const path = url.slice("http://localhost:8080/api/v1".length);
    const [route, query = ""] = path.split("?");
    const q = new URLSearchParams(query);
    const b: ObjectData = body && typeof body === "object" && !Array.isArray(body) ? body as ObjectData : {};
    if (route === "/workflow") {
      if (world.slowWorkflow) await new Promise((r) => setTimeout(r, world.slowWorkflow));
      if (method === "PUT") {
        workflow = merge(workflow, b);
        if (world.workflowEvents) plugin.onEvent({ name: "workflowUpdated", payload: structuredClone(workflow) });
      }
      return json(workflow);
    }
    if (route === "/machine/state") return json({ state: { state: world.phase ?? "idle" } });
    if (route === "/info") return json({ version: "1", localIp: "192.168.1.20" });
    if (route === "/beans") {
      if (method === "POST") {
        if (typeof b.roaster !== "string" || typeof b.name !== "string") return json({ error: "roaster" }, 400);
        const made = { id: `bean-${nextId++}`, decaf: false, archived: false, createdAt: stamp(), ...b };
        beans.push(made);
        return json(made, 201);
      }
      return json(q.get("includeArchived") === "true" ? beans : beans.filter((x) => !x.archived));
    }
    let m = /^\/beans\/([^/]+)$/.exec(route);
    if (m) {
      const i = beans.findIndex((x) => x.id === decodeURIComponent(m![1]));
      if (i < 0) return json({ error: "Bean not found" }, 404);
      if (method === "DELETE") throw new Error("The plugin never deletes a bean");
      if (method === "PUT") {
        if (["roaster", "name", "decaf", "archived"].some((k) => k in b && b[k] === null)) return json({ error: "null" }, 400);
        beans[i] = { ...beans[i], ...b };
      }
      return json(beans[i]);
    }
    m = /^\/beans\/([^/]+)\/batches$/.exec(route);
    if (m) {
      const beanId = decodeURIComponent(m[1]);
      if (method === "POST") {
        // Decaid's POST starts a batch full and open, whatever the body says.
        const { weightRemaining: _w, archived: _a, ...rest } = b;
        void _w; void _a;
        const made = { id: `batch-${nextId++}`, beanId, frozen: false, createdAt: stamp(), ...rest, weightRemaining: rest.weight ?? null, archived: false };
        batches.push(made);
        return json(made, 201);
      }
      return json(batches.filter((x) => x.beanId === beanId && (q.get("includeArchived") === "true" || !x.archived)));
    }
    if (route === "/bean-batches") return json(q.get("includeArchived") === "true" ? batches : batches.filter((x) => !x.archived));
    m = /^\/bean-batches\/([^/]+)$/.exec(route);
    if (m) {
      const i = batches.findIndex((x) => x.id === decodeURIComponent(m![1]));
      if (i < 0) return json({ error: "Batch not found" }, 404);
      if (method === "DELETE") throw new Error("The plugin never deletes a batch");
      if (method === "PUT") batches[i] = { ...batches[i], ...b };
      return json(batches[i]);
    }
    m = /^\/store\/([^/]+)\/([^/]+)$/.exec(route);
    if (m) {
      const key = `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`;
      if (method === "POST") { store.set(key, body); return new Response(null, { status: 204 }); }
      if (!store.has(key)) return json({ error: "Key not found" }, 404);
      if (method === "DELETE") { store.delete(key); return json({ deleted: true }); }
      return json(store.get(key));
    }
    if (route === "/grinders") {
      if (method === "POST") {
        if (typeof b.model !== "string" || !b.model) return json({ error: "model" }, 400);
        const made = { id: `g-${nextId++}`, settingType: "numeric", ...b, archived: false };
        grinders.push(made);
        return json(made, 201);
      }
      return json(q.get("includeArchived") === "true" ? grinders : grinders.filter((g) => !g.archived));
    }
    m = /^\/grinders\/([^/]+)$/.exec(route);
    if (m) {
      const i = grinders.findIndex((g) => g.id === decodeURIComponent(m![1]));
      if (i < 0) return json({ error: "Grinder not found" }, 404);
      if (method === "DELETE") throw new Error("The plugin never deletes a grinder");
      if (method === "PUT") {
        if (["model", "archived", "settingType"].some((k) => k in b && b[k] === null)) return json({ error: "null" }, 400);
        grinders[i] = { ...grinders[i], ...b };
      }
      return json(grinders[i]);
    }
    if (route === "/shots") {
      const batchIds = q.get("beanId") ? new Set(batches.filter((x) => x.beanId === q.get("beanId")).map((x) => x.id)) : null;
      const all = [...shots.values()].filter((s) => {
        const w = object(s.workflow), ctx = object(w.context);
        return (!q.get("coffeeName") || ctx.coffeeName === q.get("coffeeName")) && (!q.get("profileTitle") || object(w.profile).title === q.get("profileTitle"))
          && (!batchIds || batchIds.has(String(ctx.beanBatchId)));
      }).sort((x, y) => String(y.timestamp).localeCompare(String(x.timestamp)));
      const offset = Number(q.get("offset") ?? 0), limit = Math.min(100, Number(q.get("limit") ?? 20));
      return json({ items: all.slice(offset, offset + limit) });
    }
    m = /^\/shots\/([^/]+)$/.exec(route);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!shots.has(id)) return json({ error: "Shot not found" }, 404);
      if (method === "DELETE") { shots.delete(id); return json({ success: true, id }); }
      if (method === "PUT") shots.set(id, { ...merge(shots.get(id)!, b), updatedAt: new Date().toISOString() });
      return json(shots.get(id));
    }
    if (route === "/profiles") {
      if (method === "POST") {
        const made = { id: `profile:${nextId++}`, visibility: "visible", updatedAt: stamp(), ...b };
        profiles.push(made);
        return json(made, 201);
      }
      return json(q.get("includeHidden") === "true" ? profiles : profiles.filter((p) => (p.visibility ?? "visible") === "visible"));
    }
    m = /^\/profiles\/([^/]+)$/.exec(route);
    if (m) {
      const p = profiles.find((x) => x.id === decodeURIComponent(m![1]));
      return p ? json(p) : json({ error: "Profile not found" }, 404);
    }
    if (route === `/plugins/${PLUGIN_ID}/settings` && method === "POST") {
      if ((world.settingsStatus ?? 200) >= 400) return json({ error: "no" }, world.settingsStatus);
      Object.assign(settings, b);
      return json(settings);
    }
    if (route === "/sensors") return json(world.sensors ?? [
      { id: "AA:BB", info: { name: "DiFluid R2", data: [{ key: "tds" }], commands: [{ id: "measure" }] } },
      { id: "temp", info: { name: "Thermometer", data: [{ key: "temperatureC" }], commands: [{ id: "measure" }] } },
    ]);
    if (route === "/devices/scan") return json([]);
    if (/^\/sensors\/[^/]+\/execute$/.test(route)) return json({ status: "ok", result: { reading: { tds: 9.41 } } });
    throw new Error(`Unexpected ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  const host: Parameters<typeof createPlugin>[0] = {
    log: () => {},
    emit: (event, payload) => { emitted.push({ event, payload }); },
    storage: () => { throw new Error("The plugin keeps nothing in plugin storage"); },
  };
  let plugin = createPlugin(host);
  plugin.onLoad(settings);
  cleanup.push(() => plugin.onUnload());
  const headers = { host: "tablet:8080", origin: "http://tablet:8080", "content-type": "application/json", "x-bean-journal-ui": "1" };
  const control = async (body: ObjectData, extra: Record<string, string> = {}) => {
    const res = await plugin.__httpRequestHandler({ endpoint: "control", method: "POST", body, headers: { ...headers, ...extra } });
    return { status: res.status, data: JSON.parse(res.body || "null") };
  };
  const ok = async (body: ObjectData) => {
    const res = await control(body);
    if (res.status !== 200) throw new Error(`${String(body.action)}: ${res.status} ${JSON.stringify(res.data)}`);
    return res.data;
  };
  const put = (patch: ObjectData) => fetch("http://localhost:8080/api/v1/workflow", { method: "PUT", body: JSON.stringify(patch) });
  const context = () => object(workflow.context);
  const ratio = async (body: ObjectData) => {
    const res = await plugin.__httpRequestHandler({ endpoint: "ratio", method: "POST", body, headers });
    if (res.status !== 200) throw new Error(`ratio: ${res.status} ${res.body}`);
    return JSON.parse(res.body);
  };
  const restart = () => { plugin.onUnload(); plugin = createPlugin(host); plugin.onLoad(settings); };
  return { get plugin() { return plugin; }, control, ok, put, ratio, restart, calls, shots, store, beans, batches, emitted, workflow: () => workflow, context, settings, profiles };
}

const ratioWorld = (): World => ({
  beans: [{ id: "b1", roaster: "R", name: "Long Cup", archived: false }, { id: "b2", roaster: "R", name: "Short Cup", archived: false }],
  batches: [{ id: "t1", beanId: "b1", archived: false }, { id: "t2", beanId: "b2", archived: false }, { id: "t3", beanId: "b1", archived: false }],
});

describe("Bean Journal plugin", () => {
  it("orders by selection then actual brew time, always finishes last, and keeps bags of the same bean distinct", async () => {
    vi.useFakeTimers();
    const t = setup({}, {
      beans: [{ id: "b1", roaster: "R", name: "Same name" }, { id: "b2", roaster: "R", name: "Same name" }],
      batches: ["unseen", "tie", "new", "old", "done", "done-old"].map((id, i) => ({
        id, beanId: i === 1 ? "b2" : "b1", archived: id.startsWith("done"), roastDate: `2026-10-${20 - i}T00:00:00`,
      })),
    });
    const listing = async (more: ObjectData = {}) => (await t.ok({ action: "coffees", includeFinished: true, ...more })).coffees.map((c: ObjectData) => c.id);
    for (const [id, seconds, batch] of [["older", -300, "old"], ["equal", -300, "tie"], ["recent", -60, "new"], ["finished", -10, "done"]] as const) {
      t.shots.set(id, makeShot(id, seconds, { beanBatchId: batch, coffeeName: "Same name", coffeeRoaster: "R" }));
    }
    t.shots.set("clean", makeShot("clean", 10, { beanBatchId: "unseen" }, {}, { beverage_type: "cleaning" }));
    t.shots.set("calibrate", makeShot("calibrate", 20, { beanBatchId: "old" }, {}, { beverage_type: "calibration" }));
    t.shots.set("named", makeShot("named", 30, { coffeeName: "Same name", coffeeRoaster: "R" }));
    t.shots.set("unknown", makeShot("unknown", 40, { beanBatchId: "unknown", coffeeName: "Same name" }));
    t.shots.set("invalid-time", { ...makeShot("invalid-time", 50, { beanBatchId: "unseen" }), timestamp: "invalid" });
    expect(await listing()).toEqual(["new", "tie", "old", "unseen", "done", "done-old"]);
    await t.ok({ action: "select", coffeeId: "old" });
    expect(await listing()).toEqual(["old", "new", "tie", "unseen", "done", "done-old"]);
    await t.ok({ action: "select", coffeeId: "unseen" });
    expect(await listing()).toEqual(["unseen", "new", "tie", "old", "done", "done-old"]);
    await t.ok({ action: "select", coffeeId: null });
    expect(await listing()).toEqual(["new", "tie", "old", "unseen", "done", "done-old"]);
    await t.put({ context: { beanBatchId: "done-old" } });
    expect(await listing()).toEqual(["new", "tie", "old", "unseen", "done", "done-old"]);
    expect(await listing({ includeFinished: false })).toEqual(["new", "tie", "old", "unseen"]);
    expect(await listing({ search: "same" })).toEqual(["new", "tie", "old", "unseen", "done", "done-old"]);
    expect(t.calls.filter((c) => c.url.includes("/shots?"))).toHaveLength(1);
  });

  it("refreshes new brews, edits, reassignments, confirmed deletions and missed-event changes", async () => {
    vi.useFakeTimers();
    const t = setup({}, ratioWorld());
    const listing = async () => (await t.ok({ action: "coffees" })).coffees.map((c: ObjectData) => c.id);
    t.shots.set("a", makeShot("a", -300, { beanBatchId: "t1" }));
    t.shots.set("b", makeShot("b", -200, { beanBatchId: "t2" }));
    expect(await listing()).toEqual(["t2", "t1", "t3"]);
    t.shots.set("c", makeShot("c", -100, { beanBatchId: "t3" }));
    t.plugin.onEvent({ name: "shotStored", payload: { id: "c" } });
    expect(await listing()).toEqual(["t3", "t2", "t1"]);
    await t.ok({ action: "rate-shot", shotId: "a", score: 95 });
    expect(await listing()).toEqual(["t3", "t2", "t1"]);
    const edited = t.shots.get("a")!;
    t.shots.set("a", merge(edited, { annotations: { extras: { visualizerId: "uploaded-now" } }, updatedAt: new Date().toISOString() }));
    t.plugin.onEvent({ name: "shotUpdated", payload: { id: "a" } });
    expect(await listing()).toEqual(["t3", "t2", "t1"]);
    await t.ok({ action: "assign-coffee", shotId: "c", coffeeId: "t1" });
    expect(await listing()).toEqual(["t1", "t2", "t3"]);
    expect((await t.control({ action: "delete-shot", shotId: "c" })).data.code).toBe("confirmation");
    expect(await listing()).toEqual(["t1", "t2", "t3"]);
    await t.ok({ action: "delete-shot", shotId: "c", confirmed: true });
    expect(await listing()).toEqual(["t2", "t1", "t3"]);
    t.shots.delete("b");
    vi.setSystemTime(Date.now() + 15000);
    expect(await listing()).toEqual(["t1", "t2", "t3"]);
    t.shots.set("a", merge(t.shots.get("a")!, { workflow: { context: { beanBatchId: "t3" } } }));
    vi.setSystemTime(Date.now() + 15000);
    expect(await listing()).toEqual(["t3", "t1", "t2"]);
    await t.ok({ action: "assign-coffee", shotId: "a", coffeeId: null });
    expect(await listing()).toEqual(["t1", "t2", "t3"]);
    t.restart();
    expect(await listing()).toEqual(["t1", "t2", "t3"]);
  });

  it("reads beyond the first shot page for brew ordering", async () => {
    const t = setup({}, ratioWorld());
    for (let i = 0; i < 105; i++) t.shots.set(`s${i}`, makeShot(`s${i}`, -i, { beanBatchId: "t1" }));
    t.shots.set("old-bag", makeShot("old-bag", -1000, { beanBatchId: "t3" }));
    expect((await t.ok({ action: "coffees" })).coffees.map((c: ObjectData) => c.id)).toEqual(["t1", "t3", "t2"]);
    expect(t.calls.some((c) => c.url.endsWith("/shots?limit=100&offset=100&order=desc"))).toBe(true);
  });

  it("surfaces shot history read errors instead of returning a success-shaped unsorted shelf", async () => {
    const t = setup({}, ratioWorld());
    const read = fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) =>
      url.includes("/shots?") ? json({ error: "Busy" }, 503) : read(url, init)));
    const failed = await t.control({ action: "coffees" });
    expect(failed.status).not.toBe(200);
    expect(failed.data.code).toBe("requestFailed");
    vi.stubGlobal("fetch", read);
    expect((await t.ok({ action: "coffees" })).coffees.map((c: ObjectData) => c.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("lists coffees, saves one, asks about a duplicate and adds a bag", async () => {
    const t = setup({}, {
      beans: [{ id: "b1", roaster: "Café Señor", name: "Kiambu", decaf: false, archived: false, createdAt: "2026-01-01T00:00:00", extras: { beanbox: { bag_id: "x" } } },
        { id: "b2", roaster: "Imports", name: "No bag", decaf: false, archived: false, createdAt: "2026-01-02T00:00:00" }],
      batches: [{ id: "t1", beanId: "b1", roastDate: "2026-10-01T00:00:00", weight: 250, weightRemaining: 120, frozen: false, archived: false, createdAt: "2026-10-02T00:00:00" },
        { id: "t0", beanId: "b1", roastDate: "2026-08-01T00:00:00", frozen: false, archived: true, createdAt: "2026-08-02T00:00:00" }],
    });
    expect((await t.ok({ action: "coffees" })).coffees.map((c: ObjectData) => c.id)).toEqual(["t1", "bean:b2"]);
    expect((await t.ok({ action: "coffees", includeFinished: true })).coffees.map((c: ObjectData) => c.id)).toEqual(["t1", "bean:b2", "t0"]);
    expect((await t.ok({ action: "coffees", search: "senor" })).coffees.map((c: ObjectData) => c.id)).toEqual(["t1"]);

    const dup = await t.ok({ action: "save-coffee", fields: { roaster: "cafe senor", name: "KIAMBU", roastDate: "2026-10-10" } });
    expect(dup.duplicates.map((c: ObjectData) => c.id)).toEqual(["t1"]);
    expect(t.beans).toHaveLength(2);
    expect(t.calls.some((c) => c.method !== "GET" && /beans|batches/.test(c.url))).toBe(false);

    const added = (await t.ok({ action: "save-coffee", addToBeanId: "b1", fields: { roaster: "ignored", name: "ignored", roastDate: "2026-10-10", weight: 250, remaining: 200 } })).coffee;
    expect(added).toMatchObject({ beanId: "b1", name: "Kiambu", roastDate: "2026-10-10", weight: 250, remaining: 200, finished: false });
    expect(t.beans.find((b) => b.id === "b1")!.name).toBe("Kiambu");

    const made = (await t.ok({ action: "save-coffee", fields: { roaster: "New Roaster", name: "Huila", country: "Colombia", farm: "La Finca", link: "https://shop.example/h", weight: 250, frozen: true } })).coffee;
    expect(made).toMatchObject({ roaster: "New Roaster", name: "Huila", country: "Colombia", farm: "La Finca", link: "https://shop.example/h", weight: 250, remaining: 250, frozen: true });
    expect(made.freezeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const again = await t.ok({ action: "save-coffee", saveNew: true, fields: { roaster: "Café Señor", name: "Kiambu" } });
    expect(again.coffee.beanId).not.toBe("b1");

    // Editing keeps other apps' extras; finishing a bag archives it, never deletes it.
    const edited = (await t.ok({ action: "save-coffee", id: "t1", fields: { tastingNotes: "Blackcurrant", finished: true } })).coffee;
    expect(edited).toMatchObject({ tastingNotes: "Blackcurrant", finished: true });
    expect(t.beans.find((b) => b.id === "b1")!.extras).toEqual({ beanbox: { bag_id: "x" } });
    expect(t.batches.find((b) => b.id === "t1")!.archived).toBe(true);
    expect(t.calls.some((c) => c.method === "DELETE")).toBe(false);

    const bag = (await t.ok({ action: "add-bag", beanId: "b2", fields: { roastDate: "2026-10-12", finished: false } })).coffee;
    expect(bag).toMatchObject({ beanId: "b2", roastDate: "2026-10-12" });
    expect((await t.ok({ action: "coffees" })).coffees.some((c: ObjectData) => c.id === "bean:b2")).toBe(false);

    const missing = await t.control({ action: "save-coffee", fields: { name: "No roaster" } });
    expect(missing).toEqual({ status: 400, data: { error: texts.errors.missingName, code: "missingName" } });
    expect((await t.control({ action: "coffee", id: "nope" })).status).toBe(404);
  });

  it("keeps a coffee's photo in Decaid's store, stamped on the bean", async () => {
    const t = setup({}, { beans: [{ id: "b1", roaster: "R", name: "N", decaf: false, archived: false, createdAt: "2026-01-01T00:00:00", extras: { other: 1 } }] });
    const photo = `data:image/jpeg;base64,${"A".repeat(400)}`;
    const set = (await t.ok({ action: "set-photo", beanId: "b1", photo })).coffee;
    expect(set.id).toBe("bean:b1");
    expect(set.photo).toMatch(/^\d{4}-/);
    expect(t.store.get("beanJournal-photos/b1")).toBe(photo);
    expect(t.beans[0].extras).toMatchObject({ other: 1, beanJournal: { photo: set.photo } });
    expect((await t.control({ action: "set-photo", beanId: "b1", photo: `data:image/jpeg;base64,${"A".repeat(600001)}` })).data.code).toBe("photoTooLarge");
    expect((await t.control({ action: "set-photo", beanId: "b1", photo: "javascript:alert(1)" })).data.code).toBe("invalidArguments");
    expect((await t.control({ action: "set-photo", beanId: "b1", photo: "https://bad host/x.jpg" })).data.code).toBe("invalidArguments");
    // An assistant's https address is kept as it is: the page shows it from the web.
    const url = "https://shop.example/img/kiambu.jpg?w=800";
    const linked = (await t.ok({ action: "set-photo", beanId: "b1", photo: url })).coffee;
    expect(t.store.get("beanJournal-photos/b1")).toBe(url);
    expect(linked.photo).toMatch(/^\d{4}-/);
    expect((await t.ok({ action: "set-photo", beanId: "b1", photo: null })).coffee.photo).toBeNull();
    expect(t.store.has("beanJournal-photos/b1")).toBe(false);
    expect(t.beans[0].extras).toEqual({ other: 1 });
  });

  it("saves Decaid's other coffee fields and an assistant's photo with the coffee, checking the photo before writing", async () => {
    const t = setup({}, {
      beans: [{ id: "b1", roaster: "R", name: "N", decaf: false, archived: false, createdAt: "2026-01-01T00:00:00", extras: { other: 1 } }],
      batches: [{ id: "t1", beanId: "b1", frozen: false, archived: false, createdAt: "2026-10-02T00:00:00" }],
    });
    const before = t.calls.length;
    expect((await t.control({ action: "save-coffee", id: "t1", fields: { species: "Arabica" }, photo: "ftp://x" })).data.code).toBe("invalidArguments");
    expect(t.calls.slice(before).some((c) => c.method !== "GET")).toBe(false);

    const url = "https://shop.example/n.png";
    const edited = (await t.ok({ action: "save-coffee", id: "t1", photo: url, fields: { species: "Arabica", decafProcess: "Sugarcane EA",
      harvestDate: "2025/26", qualityScore: 87.25, price: 18.5, currency: "EUR", buyDate: "2026-10-03" } })).coffee;
    expect(edited).toMatchObject({ id: "t1", species: "Arabica", decafProcess: "Sugarcane EA", harvestDate: "2025/26", qualityScore: 87.25,
      price: 18.5, currency: "EUR", buyDate: "2026-10-03" });
    expect(edited.photo).toMatch(/^\d{4}-/);
    expect(t.store.get("beanJournal-photos/b1")).toBe(url);
    expect(t.beans[0]).toMatchObject({ species: "Arabica", decafProcess: "Sugarcane EA", extras: { other: 1, beanJournal: { photo: edited.photo } } });
    expect(t.batches[0]).toMatchObject({ harvestDate: "2025/26", qualityScore: 87.25, price: 18.5, currency: "EUR", buyDate: "2026-10-03T00:00:00" });

    // A duplicate saves nothing, the photo neither.
    const dup = await t.ok({ action: "save-coffee", fields: { roaster: "R", name: "N" }, photo: url });
    expect(dup.duplicates).toHaveLength(1);
    const made = (await t.ok({ action: "save-coffee", saveNew: true, fields: { roaster: "R", name: "N", price: 12 }, photo: `data:image/png;base64,${"A".repeat(40)}` })).coffee;
    expect(made).toMatchObject({ price: 12 });
    expect(t.store.get(`beanJournal-photos/${made.beanId}`)).toMatch(/^data:image\/png;base64,/);
    expect((await t.ok({ action: "save-coffee", id: made.id, fields: {}, photo: null })).coffee.photo).toBeNull();
  });

  it("offers old bags for finishing once, archiving only those the user chose", async () => {
    const day = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString();
    const beans = Array.from({ length: 14 }, (_, i) => ({ id: `b${i}`, roaster: "R", name: `Coffee ${i}`, decaf: false, archived: false, createdAt: day(1) }));
    const batches = beans.map((b, i) => ({ id: `t${i}`, beanId: b.id, frozen: false, archived: false, createdAt: day(1), ...(i === 0 ? { roastDate: day(10).slice(0, 19) } : {}) }));
    const t = setup({}, { beans, batches });
    // t0 roasted lately, t1 had a shot lately, t2 is the next shot's; t3's shot is too old to count.
    t.shots.set("s1", { id: "s1", timestamp: day(5), workflow: { context: { beanBatchId: "t1" } } });
    t.shots.set("s2", { id: "s2", timestamp: day(200), workflow: { context: { beanBatchId: "t3" } } });
    await t.put({ context: { beanBatchId: "t2" } });
    const offered = await t.ok({ action: "old-bags" });
    expect(offered.asked).toBe(false);
    expect(offered.bags.map((c: ObjectData) => c.id)).toEqual(Array.from({ length: 11 }, (_, i) => `t${i + 3}`));
    expect(offered.bags[0]).toMatchObject({ lastDate: null });

    expect((await t.control({ action: "finish-old-bags", ids: ["t3"] })).data.code).toBe("confirmation");
    expect((await t.ok({ action: "finish-old-bags", ids: ["t3", "t4", "nope"], confirmed: true })).finished).toBe(2);
    expect(t.batches.filter((b) => b.archived).map((b) => b.id)).toEqual(["t3", "t4"]);
    expect(t.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(await t.ok({ action: "old-bags" })).toEqual({ asked: true, bags: [] });
  });

  it("offers nothing when few bags are old, and asks again later", async () => {
    const t = setup({}, { beans: [{ id: "b1", roaster: "R", name: "N", decaf: false, archived: false, createdAt: "2020-01-01T00:00:00" }],
      batches: [{ id: "t1", beanId: "b1", frozen: false, archived: false, createdAt: "2020-01-01T00:00:00" }] });
    expect(await t.ok({ action: "old-bags" })).toEqual({ asked: false, bags: [] });
    expect(t.store.has("beanJournal/oldBags")).toBe(false);
    // "Keep all": no bag changes, and it isn't asked again.
    expect(await t.ok({ action: "finish-old-bags", ids: [] })).toEqual({ finished: 0 });
    expect(t.batches[0].archived).toBe(false);
    expect(await t.ok({ action: "old-bags" })).toEqual({ asked: true, bags: [] });
  });

  it("chooses a coffee for the next shot, making a bag for a bean without one, and keeps or loads its last or best shot", async () => {
    const t = setup({}, {
      beans: [{ id: "b1", roaster: "R", name: "Kiambu", decaf: false, archived: false, createdAt: "2026-01-01T00:00:00" },
        { id: "b2", roaster: "I", name: "Imported", decaf: false, archived: false, createdAt: "2026-01-01T00:00:00" }],
      batches: [{ id: "t1", beanId: "b1", frozen: false, archived: false, createdAt: "2026-10-02T00:00:00" }],
    });
    const chosen = (await t.ok({ action: "select", coffeeId: "bean:b2" })).coffee;
    expect(chosen).toMatchObject({ beanId: "b2", name: "Imported" });
    expect(chosen.batchId).toMatch(/^batch-/);
    expect(t.context()).toMatchObject({ beanBatchId: chosen.batchId, coffeeName: "Imported", coffeeRoaster: "I",
      extras: { beanJournal: { gear: { beanBatchId: chosen.batchId, coffeeName: "Imported" } } } });
    // Chosen again: the bag made before, not a second one.
    await t.ok({ action: "select", coffeeId: "bean:b2" });
    expect(t.batches.filter((b) => b.beanId === "b2")).toHaveLength(1);
    expect(t.emitted).toContainEqual({ event: "changed", payload: { what: "workflow" } });

    t.shots.set("old", makeShot("old", -300, { beanBatchId: "t1", coffeeName: "Kiambu", grinderSetting: "10" }, { enjoyment: 9 }));
    t.shots.set("new", makeShot("new", -60, { beanBatchId: "t1", coffeeName: "Kiambu", grinderSetting: "12", targetDoseWeight: 19 }, { enjoyment: 7 }));
    t.shots.set("clean", makeShot("clean", -10, { beanBatchId: "t1" }, {}, { title: "Cleaning", beverage_type: "cleaning", steps: [] }));
    await t.put({ context: { grinderSetting: "5" } });
    expect(await t.ok({ action: "choose-coffee", coffeeId: "t1", settings: "keep" })).toMatchObject({ coffee: { id: "t1" }, loaded: null });
    expect(t.context()).toMatchObject({ beanBatchId: "t1", grinderSetting: "5" });
    expect(await t.ok({ action: "choose-coffee", coffeeId: "t1", settings: "last" })).toMatchObject({ loaded: "new" });
    expect(t.context()).toMatchObject({ grinderSetting: "12", targetDoseWeight: 19 });
    expect(await t.ok({ action: "choose-coffee", coffeeId: "t1", settings: "best" })).toMatchObject({ loaded: "old" });
    expect(t.context().grinderSetting).toBe("10");
    const detail = await t.ok({ action: "coffee", id: "t1" });
    expect(detail).toMatchObject({ coffee: { id: "t1" }, last: "new", best: "old" });
    expect(detail.shots.map((s: ObjectData) => s.id)).toEqual(["clean", "new", "old"]);
    expect(detail.shots[1]).toMatchObject({ coffeeId: "t1", score: 70, grind: "12" });

    const status = await t.ok({ action: "status" });
    expect(status).toMatchObject({ version: VERSION, coffee: { id: "t1", name: "Kiambu" }, coffeeName: "Kiambu", dose: 18, onCoffeeChoice: "keep", mcp: "off", mcpPublic: "off" });
    await t.ok({ action: "select", coffeeId: null });
    expect(t.context()).toMatchObject({ beanBatchId: null, coffeeName: null, extras: { beanJournal: { gear: { coffeeName: null } } } });
    expect((await t.ok({ action: "status" })).coffee).toBeNull();
  });

  it("rates a shot in Decaid's fields and Bean Journal's own, and remembers the water", async () => {
    const t = setup({}, { beans: [{ id: "b1", roaster: "R", name: "Kiambu", decaf: false, archived: false, createdAt: "x" }],
      batches: [{ id: "t1", beanId: "b1", frozen: false, archived: false, createdAt: "y" }] });
    t.shots.set("s1", makeShot("s1", -60, { beanBatchId: "t1", coffeeName: "Kiambu" }, { extras: { beanbox: { balance: "bitter" } } }));
    const shot = (await t.ok({ action: "rate-shot", shotId: "s1", score: 85, balance: "sour", body: "heavy", notes: "Bright", tds: 9.1, ey: 0,
      dose: 18.2, yield: 40, grind: "12", grinderId: "g-old", rpm: 900, water: "Lotus Light" })).shot;
    const saved = t.shots.get("s1")!;
    expect(saved.annotations).toMatchObject({ enjoyment: 8.5, espressoNotes: "Bright", drinkTds: 9.1, drinkEy: null, actualDoseWeight: 18.2, actualYield: 40,
      extras: { beanJournal: { balance: "sour", body: "heavy", water: "Lotus Light" }, beanbox: { balance: "bitter" } } });
    expect(object(object(saved.workflow).context)).toMatchObject({ grinderId: "g-old", grinderModel: "Old grinder", grinderSetting: "12", extras: { rpm: 900 } });
    expect(shot).toMatchObject({ id: "s1", coffeeId: "t1", beanId: "b1", score: 85, balance: "sour", body: "heavy", water: "Lotus Light", rpm: 900, grind: "12", notes: "Bright", ey: null, visualizerId: null });
    expect(t.store.get("beanJournal/waters")).toEqual(["Lotus Light"]);
    await t.ok({ action: "rate-shot", shotId: "s1", water: "Volvic" });
    await t.ok({ action: "rate-shot", shotId: "s1", water: "lotus light" });
    expect((await t.ok({ action: "waters" })).waters).toEqual(["lotus light", "Volvic"]);
    const cleared = (await t.ok({ action: "rate-shot", shotId: "s1", score: null, balance: null, water: null, rpm: null })).shot;
    expect(cleared).toMatchObject({ score: null, balance: null, water: null, rpm: null });
    for (const bad of [{ score: 101 }, { score: 7.5 }, { balance: "sweet" }, { body: "light" }, { rpm: 0 }, { tds: 31 }, {}]) {
      expect((await t.control({ action: "rate-shot", shotId: "s1", ...bad })).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await t.control({ action: "rate-shot", shotId: "s1", grinderId: "nope" })).data.code).toBe("grinderNotFound");
    const moved = (await t.ok({ action: "assign-coffee", shotId: "s1", coffeeId: null })).shot;
    expect(moved).toMatchObject({ coffeeId: null, beanId: null, coffeeName: "" });
    expect((await t.ok({ action: "shot-text", shotId: "s1" })).text).toContain("Espresso shot");
  });

  it("puts back the coffee, grinder and speed after Streamline clears them", async () => {
    const t = setup({}, { beans: [{ id: "b1", roaster: "R", name: "Kiambu", decaf: false, archived: false, createdAt: "x" }],
      batches: [{ id: "t1", beanId: "b1", frozen: false, archived: false, createdAt: "y" }] });
    await t.ok({ action: "select", coffeeId: "t1" });
    await t.ok({ action: "next-settings", grinderId: "g-lagom", rpm: 900, grind: "12", water: "Lotus" });
    expect(t.context()).toMatchObject({ grinderId: "g-lagom", grinderModel: "Lagom 01", grinderSetting: "12",
      extras: { rpm: 900, beanJournal: { water: "Lotus", gear: { beanBatchId: "t1", coffeeName: "Kiambu", grinderId: "g-lagom", rpm: 900 } } } });
    // Streamline's clean-up after a shot (DYE2 on).
    await t.put({ context: { beanBatchId: null, coffeeName: null, coffeeRoaster: null, grinderId: null, grinderModel: null, extras: { rpm: null } } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: t.workflow() });
    await vi.waitFor(() => expect(t.context()).toMatchObject({ beanBatchId: "t1", coffeeName: "Kiambu", coffeeRoaster: "R", grinderId: "g-lagom",
      grinderModel: "Lagom 01", extras: { rpm: 900 } }), { timeout: 3000 });
    // A grinder changed in DYE2 becomes the one kept.
    await t.put({ context: { grinderId: null, grinderModel: "Niche", extras: { rpm: null } } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: t.workflow() });
    await vi.waitFor(() => expect(optionalObject(object(object(t.context().extras).beanJournal).gear)).toMatchObject({ grinderModel: "Niche", grinderId: null, rpm: null }), { timeout: 3000 });
    // The page's "no coffee" is the user's: it stays cleared.
    await t.ok({ action: "select", coffeeId: null });
    t.plugin.onEvent({ name: "workflowUpdated", payload: t.workflow() });
    await new Promise((r) => setTimeout(r, 1000));
    expect(t.context().coffeeName).toBeNull();
  });

  it("long after a shot, takes a grinder or coffee cleared in Streamline as the user's, but still undoes the whole clean-up", async () => {
    const t = setup({}, { beans: [{ id: "b1", roaster: "R", name: "Kiambu", decaf: false, archived: false, createdAt: "x" }],
      batches: [{ id: "t1", beanId: "b1", frozen: false, archived: false, createdAt: "y" }] });
    await t.ok({ action: "select", coffeeId: "t1" });
    await t.ok({ action: "next-settings", grinderId: "g-lagom", rpm: 900 });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 60000);
    await t.put({ context: { grinderId: null, grinderModel: null, extras: { rpm: null } } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: t.workflow() });
    await vi.waitFor(() => expect(optionalObject(object(object(t.context().extras).beanJournal).gear)).toMatchObject({ grinderId: null, rpm: null }), { timeout: 3000 });
    expect(t.context()).toMatchObject({ grinderId: null, coffeeName: "Kiambu" });
    // The grinder again, then Streamline's start-up clean-up: everything at once comes back.
    await t.ok({ action: "next-settings", grinderId: "g-lagom", rpm: 900 });
    await t.put({ context: { beanBatchId: null, coffeeName: null, coffeeRoaster: null, grinderId: null, grinderModel: null, extras: { rpm: null } } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: t.workflow() });
    await vi.waitFor(() => expect(t.context()).toMatchObject({ beanBatchId: "t1", grinderId: "g-lagom", extras: { rpm: 900 } }), { timeout: 3000 });
  });

  it("brings back a finished bean when a new bag of it is added, opens an old shot by id and never cuts notes", async () => {
    const t = setup({}, { beans: [{ id: "b1", roaster: "R", name: "Kiambu", decaf: false, archived: true, createdAt: "x" }],
      batches: [{ id: "t0", beanId: "b1", frozen: false, archived: true, createdAt: "y" }] });
    const bag = (await t.ok({ action: "save-coffee", addToBeanId: "b1", fields: { roastDate: "2026-10-12" } })).coffee;
    expect(bag).toMatchObject({ beanId: "b1", finished: false });
    expect(t.beans[0].archived).toBe(false);
    expect(t.calls.some((c) => c.method === "DELETE")).toBe(false);

    for (let i = 0; i < 1050; i++) t.shots.set(`s${i}`, makeShot(`s${i}`, -i * 60));
    const found = await t.ok({ action: "shot", offset: 0, shotId: "s1040" });
    expect(found).toMatchObject({ offset: 1040, shot: { id: "s1040" } });

    const long = "x".repeat(3000);
    t.shots.set("s1", makeShot("s1", -60, {}, { espressoNotes: long }));
    await t.ok({ action: "rate-shot", shotId: "s1", score: 80 });
    expect(object(t.shots.get("s1")!.annotations).espressoNotes).toBe(long);
    await t.ok({ action: "rate-shot", shotId: "s1", notes: long + "y" });
    expect(object(t.shots.get("s1")!.annotations).espressoNotes).toBe(long + "y");
    expect((await t.control({ action: "rate-shot", shotId: "s1", notes: "z".repeat(10001) })).status).toBe(400);
  });

  it("keeps the ratio when the skin changes the dose, and sets the drink from a typed ratio", async () => {
    const t = setup();
    const ratio = async (body: ObjectData, extra: Record<string, string> = {}) => {
      const res = await t.plugin.__httpRequestHandler({ endpoint: "ratio", method: "POST", body,
        headers: { host: "tablet:8080", origin: "http://tablet:3000", "content-type": "application/json", ...extra } });
      return { status: res.status, data: JSON.parse(res.body || "null") };
    };
    expect(await ratio({ ratio: 2.5 })).toEqual({ status: 200, data: { ratio: 2.5, yield: 45 } });
    expect(object(t.workflow().profile).target_weight).toBe(45);
    expect((await ratio({ lock: 1 })).status).toBe(200);
    expect(object(t.context().extras).lockRatio).toBe(true);
    const dose = async (d: number, y: number, bare = false) => {
      await t.put({ context: { targetDoseWeight: d, targetYield: y } });
      // A Decaid whose event doesn't carry the workflow: the plugin reads it.
      t.plugin.onEvent({ name: "workflowUpdated", payload: bare ? {} : t.workflow() });
    };
    await dose(20, 45);
    await vi.waitFor(() => expect(t.context().targetYield).toBe(50));
    // Only the stop weight goes with it: the whole profile from the event could undo a Brew change.
    const write = t.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/workflow")).at(-1)!;
    expect(write.body).toEqual({ context: { targetYield: 50 }, profile: { target_weight: 50 } });
    await dose(19, 50, true);
    await vi.waitFor(() => expect(t.context().targetYield).toBe(47.5));
    await ratio({ lock: 0 });
    await dose(18, 47.5);
    await new Promise((r) => setTimeout(r, 30));
    expect(t.context().targetYield).toBe(47.5);
    for (const bad of [{ ratio: 0.5 }, { ratio: "2" }, { lock: 2 }, {}]) expect((await ratio(bad)).status).toBe(400);
    expect((await ratio({ ratio: 2 }, { "content-type": "text/plain" })).status).toBe(415);
    expect((await ratio({ ratio: 2 }, { origin: "https://evil.example" })).status).toBe(403);
  });

  it("remembers 80 g unlocked and 1:2.5 locked across coffee, bag and profile switches and restarts", async () => {
    const t = setup({}, ratioWorld());
    await t.ok({ action: "load-profile", profileId: "profile:turbo", coffeeId: "t1", yield: 80, lockRatio: false, confirmed: true });
    await t.put({ context: { targetDoseWeight: 20 } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: {} });
    await t.ok({ action: "select", coffeeId: "t2" });
    expect(t.context()).toMatchObject({ targetYield: 80, extras: { lockRatio: false } });
    await t.ratio({ ratio: 2.5 });
    await t.ratio({ lock: 1 });
    await t.put({ context: { targetDoseWeight: 18 } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: { workflow: t.workflow() } });
    await vi.waitFor(() => expect(t.context().targetYield).toBe(45));
    await t.put({ context: { targetDoseWeight: 20 } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: "changed" });
    await vi.waitFor(() => expect(t.context().targetYield).toBe(50));
    await t.ok({ action: "select", coffeeId: "t3" });
    expect(t.context()).toMatchObject({ beanBatchId: "t3", targetYield: 80, extras: { lockRatio: false } });
    await t.ok({ action: "choose-coffee", coffeeId: "t2", settings: "keep" });
    expect(t.context()).toMatchObject({ targetYield: 50, extras: { lockRatio: true } });

    await t.put({ profile, context: { targetYield: 36 } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: t.workflow() });
    await t.ratio({ lock: 0 });
    await t.ratio({ ratio: 3 });
    await t.ok({ action: "load-profile", profileId: "profile:turbo", confirmed: true });
    expect(t.context()).toMatchObject({ targetYield: 50, extras: { lockRatio: true } });
    await t.ok({ action: "load-profile", profileId: "profile:turbo", confirmed: true });
    expect(t.context()).toMatchObject({ targetYield: 50, extras: { lockRatio: true } });
    expect(object(t.workflow().profile).target_weight).toBe(50);
    const stored = object(t.store.get("beanJournal/ratioMemory"));
    expect(stored.version).toBe(1);
    expect((stored.entries as ObjectData[]).map((row) => row.coffee)).toEqual(["b1", "b2", "b2"]);

    // Decaid still has the selected pair, but the skin reset its mode/numbers before the plugin starts.
    t.plugin.onUnload();
    await t.put({ context: { targetDoseWeight: 18, targetYield: 36, extras: { lockRatio: false } } });
    t.restart();
    await vi.waitFor(() => expect(t.context()).toMatchObject({ targetYield: 45, extras: { lockRatio: true } }));
    await t.ok({ action: "select", coffeeId: "t1" });
    expect(t.context()).toMatchObject({ targetYield: 80, extras: { lockRatio: false } });
  });

  it("gives explicit profile/shot loads and combined next-shot inputs precedence over memory", async () => {
    const t = setup({}, ratioWorld());
    const load = (fields: ObjectData = {}) => t.ok({ action: "load-profile", profileId: "profile:turbo", confirmed: true, ...fields });
    await load({ coffeeId: "t1", yield: 80, lockRatio: false });
    await load({ coffeeId: "t2", ratio: 2.5, lockRatio: true });
    await load({ coffeeId: "t1", dose: 20, yield: 70, lockRatio: true });
    expect(t.context()).toMatchObject({ targetDoseWeight: 20, targetYield: 70, extras: { lockRatio: true } });
    await t.ok({ action: "select", coffeeId: "t2" });
    expect(t.context().targetYield).toBe(50);
    await load({ coffeeId: "t1", dose: 18 });
    // Even an explicit dose requests the profile's normal numbers, not its remembered 70 g.
    expect(t.context().targetYield).toBe(50);
    await load({ coffeeId: "t1", lockRatio: false });
    expect(t.context()).toMatchObject({ targetYield: 50, extras: { lockRatio: false } });
    await t.ok({ action: "next-settings", coffeeId: "t2", lockRatio: false });
    expect(t.context()).toMatchObject({ beanBatchId: "t2", targetYield: 50, extras: { lockRatio: false } });

    t.shots.set("s1", makeShot("s1", -60, { beanBatchId: "t1", targetYield: 64, extras: { lockRatio: false } }, {},
      object(t.profiles[0].profile)));
    await t.ok({ action: "choose-coffee", coffeeId: "t1", settings: "last" });
    expect(t.context()).toMatchObject({ beanBatchId: "t1", targetDoseWeight: 18, targetYield: 64, extras: { lockRatio: false } });
    expect(object(t.workflow().profile).target_weight).toBe(64);
    await t.ok({ action: "select", coffeeId: "t2" });
    await t.ok({ action: "select", coffeeId: "t1" });
    expect(t.context().targetYield).toBe(64);
    t.shots.set("best", makeShot("best", -120, { beanBatchId: "t1", targetYield: 45, extras: { lockRatio: true } },
      { enjoyment: 9 }, object(t.profiles[0].profile)));
    await t.ok({ action: "choose-coffee", coffeeId: "t1", settings: "best" });
    expect(t.context()).toMatchObject({ targetYield: 45, extras: { lockRatio: true } });
    await t.put({ context: { targetDoseWeight: 20 } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: {} });
    await vi.waitFor(() => expect(t.context().targetYield).toBe(50));
  });

  it("restores exact typed ratios after restart without drift and ignores delayed event payloads and echoes", async () => {
    const t = setup({}, { ...ratioWorld(), workflowEvents: true });
    await t.ok({ action: "select", coffeeId: "t1" });
    await t.put({ context: { targetDoseWeight: 18.1 } });
    await t.ratio({ ratio: 2.35 });
    await t.ratio({ lock: 1 });
    expect(t.context().targetYield).toBe(42.5);
    const stale = structuredClone(t.workflow());
    await t.ok({ action: "select", coffeeId: "t2" });
    await t.ratio({ lock: 0 });
    await t.ratio({ ratio: 4 });
    t.plugin.onEvent({ name: "workflowUpdated", payload: stale });
    await t.ok({ action: "select", coffeeId: "t1" });
    expect(t.context()).toMatchObject({ targetYield: 42.5, extras: { lockRatio: true } });
    t.restart();
    await t.ratio({ lock: 1 });
    for (const [dose, yieldG] of [[18.2, 42.8], [18.1, 42.5], [20, 47]]) {
      await t.put({ context: { targetDoseWeight: dose } });
      await vi.waitFor(() => expect(t.context().targetYield).toBe(yieldG));
    }
    const count = t.calls.filter((call) => call.method === "PUT" && call.url.endsWith("/workflow")).length;
    t.plugin.onEvent({ name: "workflowUpdated", payload: stale });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(t.calls.filter((call) => call.method === "PUT" && call.url.endsWith("/workflow"))).toHaveLength(count);
    expect(t.store.get("beanJournal/ratioMemory")).toMatchObject({ entries: expect.arrayContaining([
      expect.objectContaining({ coffee: "b1", choice: { locked: true, ratio: 2.35 } }),
    ]) });
  });

  it("restores ratio memory after shot coffee clean-up without saving another coffee's target", async () => {
    const t = setup({}, ratioWorld());
    await t.ok({ action: "load-profile", profileId: "profile:turbo", coffeeId: "t1", yield: 80, lockRatio: false, confirmed: true });
    await t.ok({ action: "load-profile", profileId: "profile:turbo", coffeeId: "t2", ratio: 2.5, lockRatio: true, confirmed: true });
    await t.put({ context: { beanBatchId: null, coffeeName: null, coffeeRoaster: null, targetYield: 90, extras: { lockRatio: false } } });
    t.plugin.onEvent({ name: "workflowUpdated", payload: t.workflow() });
    await vi.waitFor(() => expect(t.context()).toMatchObject({ beanBatchId: "t2", targetYield: 45, extras: { lockRatio: true } }), { timeout: 3000 });
    await t.ok({ action: "select", coffeeId: "t1" });
    expect(t.context()).toMatchObject({ targetYield: 80, extras: { lockRatio: false } });
  });

  it("answers Streamline's skin, the last answer when Decaid is slow, and pushes the fresh one", async () => {
    const world: World = {};
    const t = setup({}, world);
    const skin = async () => JSON.parse((await t.plugin.__httpRequestHandler({ endpoint: "skin", method: "GET", body: null,
      headers: { host: "tablet:8080", origin: "http://tablet:3000" } })).body) as { surfaces: ObjectData[] };
    const header = (a: { surfaces: ObjectData[] }) => a.surfaces.find((s) => s.id === "bean-journal");
    expect(header(await skin())).toMatchObject({ label: "Bean Journal", text: "Choose coffee", action: { view: "pick" } });
    t.shots.set("g1", makeShot("g1", -60, { coffeeName: "Kiambu", grinderSetting: "12" }));
    await t.put({ context: { coffeeName: "Kiambu", coffeeRoaster: "R", grinderSetting: "14" } });
    const fresh = await skin();
    expect(header(fresh)).toMatchObject({ label: "Kiambu", text: "R", action: { view: "shot" } });
    expect(fresh.surfaces.find((s) => s.id === "last-grind")).toMatchObject({ text: "Last 12" });
    world.slowWorkflow = 1500;
    await t.put({ context: { coffeeName: "Huila" } });
    const started = Date.now();
    const quick = await skin();
    expect(Date.now() - started).toBeLessThan(1400);
    expect(header(quick)).toMatchObject({ label: "Kiambu" });
    await vi.waitFor(() => expect(t.emitted).toContainEqual({ event: "changed", payload: { what: "skin" } }), { timeout: 3000 });
    world.slowWorkflow = 0;
    expect(header(await skin())).toMatchObject({ label: "Huila" });
  });

  it("loads a shot's settings for the next shot, and sets the next shot's gear and water", async () => {
    const t = setup({}, { beans: [{ id: "b1", roaster: "R", name: "Kiambu", decaf: false, archived: false, createdAt: "x" }],
      batches: [{ id: "t1", beanId: "b1", frozen: false, archived: false, createdAt: "y" }] });
    const turbo = { title: "Turbo", beverage_type: "espresso", steps: [{ name: "Go", pump: "pressure", pressure: 6, temperature: 90, seconds: 20 }] };
    t.shots.set("s1", makeShot("s1", -60, { grinderId: "g-lagom", grinderModel: "Lagom 01", grinderSetting: "11", targetYield: 45, extras: { rpm: 1100, beanJournal: { water: "Volvic" } } },
      { actualDoseWeight: 18.4 }, turbo));
    const loaded = await t.ok({ action: "load-shot", shotId: "s1", coffeeId: "t1" });
    expect(loaded).toMatchObject({ next: { grinderId: "g-lagom", grinderModel: "Lagom 01", grind: "11", rpm: 1100, water: "Volvic", lockRatio: false }, coffee: { id: "t1" } });
    expect(t.workflow()).toMatchObject({ profile: turbo, context: { targetDoseWeight: 18.4, targetYield: 45, beanBatchId: "t1", coffeeName: "Kiambu" } });
    t.shots.set("c1", makeShot("c1", -30, {}, {}, { title: "Clean", beverage_type: "cleaning", steps: [] }));
    expect((await t.control({ action: "load-shot", shotId: "c1" })).data.code).toBe("notABrew");

    const next = (await t.ok({ action: "next-settings", grinderModel: "Hand grinder", rpm: null, grind: "", water: "Third Wave", lockRatio: true })).next;
    expect(next).toEqual({ grinderId: null, grinderModel: "Hand grinder", grind: "", rpm: null, water: "Third Wave", lockRatio: true });
    expect((await t.ok({ action: "waters" })).waters).toEqual(["Third Wave"]);
    expect((await t.control({ action: "next-settings", grinderId: "g-old" })).data.code).toBe("grinderNotFound");
    expect((await t.control({ action: "next-settings" })).status).toBe(400);
    expect((await t.ok({ action: "grinders" })).grinders).toEqual([{ id: "g-lagom", model: "Lagom 01", settingType: "numeric", settingValues: [], settingSmallStep: 0.1, rpmSmallStep: 50 }]);
    expect(await t.ok({ action: "equipment" })).toEqual({ grinders: [expect.objectContaining({ id: "g-lagom" })], waters: ["Third Wave"] });

    const busy = setup({}, { phase: "espresso" });
    busy.shots.set("s1", makeShot("s1", -60));
    expect((await busy.control({ action: "load-shot", shotId: "s1" })).data.code).toBe("machineBusy");
    expect((await busy.control({ action: "next-settings", grind: "3" })).data.code).toBe("machineBusy");
  });

  it("adds, edits and puts away grinders (never deletes one), and keeps the list of waters", async () => {
    const t = setup();
    const made = (await t.ok({ action: "save-grinder", model: "  Niche   Zero ", burrs: "63 mm", settingSmallStep: 1 })).grinder;
    expect(made).toMatchObject({ model: "Niche Zero", burrs: "63 mm", settingSmallStep: 1, rpmSmallStep: null, archived: false });
    expect((await t.control({ action: "save-grinder", model: "lagom 01" })).data.code).toBe("grinderExists");
    expect((await t.control({ action: "save-grinder", model: "old GRINDER" })).data.code).toBe("grinderExists");
    expect((await t.control({ action: "save-grinder", model: "" })).status).toBe(400);
    expect((await t.control({ action: "save-grinder", model: "X", rpmSmallStep: -5 })).status).toBe(400);
    expect((await t.control({ action: "save-grinder", model: "X", rpmSmallStep: 0.1 })).status).toBe(400);
    expect((await t.control({ action: "save-grinder", id: "nope", burrs: "x" })).data.code).toBe("grinderNotFound");
    const edited = (await t.ok({ action: "save-grinder", id: made.id, model: "Niche Zero", burrs: null, rpmSmallStep: 50 })).grinder;
    expect(edited).toMatchObject({ id: made.id, model: "Niche Zero", burrs: "", settingSmallStep: 1, rpmSmallStep: 50 });
    expect(t.calls.filter((c) => c.method === "PUT" && c.url.endsWith(`/grinders/${made.id}`)).at(-1)?.body).toEqual({ model: "Niche Zero", burrs: null, rpmSmallStep: 50 });

    expect((await t.ok({ action: "archive-grinder", id: made.id, archived: true })).grinder).toMatchObject({ archived: true });
    expect((await t.ok({ action: "grinders" })).grinders.map((g: ObjectData) => g.id)).toEqual(["g-lagom"]);
    expect((await t.ok({ action: "grinders", includeArchived: true })).grinders.map((g: ObjectData) => [g.id, g.archived]))
      .toEqual([["g-lagom", false], ["g-old", true], [made.id, true]]);
    await t.ok({ action: "archive-grinder", id: made.id, archived: false });
    expect((await t.control({ action: "archive-grinder", id: made.id })).status).toBe(400);
    expect(t.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect((await t.ok({ action: "save-grinder", model: "Y", settingSmallStep: 0.1, rpmSmallStep: 25 })).grinder).toMatchObject({ settingSmallStep: 0.1, rpmSmallStep: 25 });

    expect((await t.ok({ action: "save-water", name: "Volvic" })).waters).toEqual(["Volvic"]);
    expect((await t.ok({ action: "save-water", name: " Lotus\tLight " })).waters).toEqual(["Lotus Light", "Volvic"]);
    expect((await t.control({ action: "save-water", name: "volvic" })).data.code).toBe("waterExists");
    expect((await t.ok({ action: "save-water", name: "Volvic Natural", previous: "volvic" })).waters).toEqual(["Lotus Light", "Volvic Natural"]);
    expect((await t.control({ action: "save-water", name: "Y", previous: "Gone" })).status).toBe(404);
    expect((await t.ok({ action: "remove-water", name: "lotus light" })).waters).toEqual(["Volvic Natural"]);
    expect((await t.control({ action: "remove-water", name: "Gone" })).status).toBe(404);
    expect(t.store.get("beanJournal/waters")).toEqual(["Volvic Natural"]);
    expect((await t.ok({ action: "waters" })).waters).toEqual(["Volvic Natural"]);
  });

  it("walks the shots, notices a new one, and deletes one only when confirmed", async () => {
    const t = setup();
    t.shots.set("a", makeShot("a", -300, { coffeeName: "Kiambu" }));
    t.shots.set("b", makeShot("b", -200, { coffeeName: "Huila" }, { extras: { visualizerId: "viz-9" } }));
    t.shots.set("c", makeShot("c", -100, { coffeeName: "Kiambu" }));
    expect(await t.ok({ action: "shot", offset: 0 })).toMatchObject({ offset: 0, older: true, shot: { id: "c" } });
    expect(await t.ok({ action: "shot", offset: 0, shotId: "b" })).toMatchObject({ offset: 1, shot: { id: "b", visualizerId: "viz-9" } });
    expect(await t.ok({ action: "shot", offset: 1, filter: { coffeeName: "Kiambu" } })).toMatchObject({ older: false, shot: { id: "a" } });
    expect((await t.ok({ action: "shots", except: "c" })).shots.map((s: ObjectData) => s.id)).toEqual(["b", "a"]);
    expect(await t.ok({ action: "latest" })).toMatchObject({ id: "c" });
    t.shots.set("d", makeShot("d", -10));
    expect((await t.ok({ action: "latest" })).id).toBe("c");
    t.plugin.onEvent({ name: "shotStored", payload: { id: "d" } });
    expect((await t.ok({ action: "latest" })).id).toBe("d");

    expect(await t.control({ action: "delete-shot", shotId: "a" })).toEqual({ status: 400, data: { error: texts.errors.confirmation, code: "confirmation" } });
    expect(t.shots.has("a")).toBe(true);
    expect(await t.ok({ action: "delete-shot", shotId: "a", confirmed: true })).toEqual({ deleted: true });
    expect(t.shots.has("a")).toBe(false);
  });

  it("writes the notes block for Visualizer after a shot and a rating while the setting is on, and keeps the user's notes clean", async () => {
    const t = setup({ VisualizerNotes: true });
    t.shots.set("s1", makeShot("s1", -60, { extras: { rpm: 900, beanJournal: { water: "Lotus" } } }, { espressoNotes: "Sweet" }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    t.plugin.onEvent({ name: "shotStored", payload: { id: "s1" } });
    await vi.advanceTimersByTimeAsync(4500);
    vi.useRealTimers();
    await vi.waitFor(() => expect(object(t.shots.get("s1")!.annotations).espressoNotes).toBe("Sweet\n\n[Bean Journal]\nWater: Lotus\nGrinder: 900 RPM\n[/Bean Journal]"));
    const rated = (await t.ok({ action: "rate-shot", shotId: "s1", balance: "balanced", notes: "Sweet and round" })).shot;
    expect(rated.notes).toBe("Sweet and round");
    expect(object(t.shots.get("s1")!.annotations).espressoNotes).toBe("Sweet and round\n\n[Bean Journal]\nTaste: Balanced\nWater: Lotus\nGrinder: 900 RPM\n[/Bean Journal]");
    expect((await t.ok({ action: "preferences" })).preferences).toEqual({ onCoffeeChoice: "keep", visualizerNotes: true });

    const off = setup();
    off.shots.set("s1", makeShot("s1", -60, {}, { espressoNotes: "Plain" }));
    await off.ok({ action: "rate-shot", shotId: "s1", balance: "sour" });
    expect(object(off.shots.get("s1")!.annotations).espressoNotes).toBe("Plain");
  });

  it("saves preferences in Decaid's plugin settings", async () => {
    const t = setup();
    expect(await t.ok({ action: "update-preferences", onCoffeeChoice: "best", visualizerNotes: true }))
      .toEqual({ preferences: { onCoffeeChoice: "best", visualizerNotes: true }, reloaded: true });
    expect(t.settings).toMatchObject({ OnCoffeeChoice: "best", VisualizerNotes: true });
    for (const bad of [{ onCoffeeChoice: "first" }, { visualizerNotes: "yes" }, { autoUpload: true }, {}]) {
      expect((await t.control({ action: "update-preferences", ...bad })).status).toBe(400);
    }
    const failing = setup({}, { settingsStatus: 500 });
    expect((await failing.control({ action: "update-preferences", onCoffeeChoice: "last" })).data.code).toBe("settingsFailed");
  });

  it("measures TDS with the refractometer and saves it on the named shot", async () => {
    const t = setup();
    t.shots.set("s1", makeShot("s1", -60));
    expect(await t.ok({ action: "refractometer" })).toEqual({ sensors: [{ id: "AA:BB", name: "DiFluid R2" }], preferred: "AA:BB" });
    expect(await t.ok({ action: "search-refractometer" })).toMatchObject({ preferred: "AA:BB" });
    expect(t.calls.some((c) => c.url.endsWith("/devices/scan?connect=false"))).toBe(true);
    const measured = await t.ok({ action: "measure-tds", shotId: "s1" });
    expect(measured).toMatchObject({ sensor: "AA:BB", tds: 9.41, shot: { id: "s1", tds: 9.41 } });
    expect((await t.control({ action: "measure-tds", sensorId: "nope" })).data.code).toBe("sensorNotFound");
  });

  it("refuses other websites and requests without the page's header, and serves the page", async () => {
    const t = setup();
    expect((await t.control({ action: "status" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await t.control({ action: "status" }, { "x-bean-journal-ui": "" })).status).toBe(403);
    expect((await t.control({ action: "status" }, { origin: "http://192.168.1.30:3000" })).status).toBe(200);
    expect((await t.control({ action: "nope" })).status).toBe(400);
    const ui = await t.plugin.__httpRequestHandler({ endpoint: "ui", method: "GET", body: null, headers: { host: "tablet:8080" } });
    expect(ui.status).toBe(200);
    expect(ui.headers["Content-Security-Policy"]).toContain("frame-ancestors 'self' http://tablet:*");
  });

  it("lets AI assistants in only with a token and a level, a bare 404 otherwise", async () => {
    const call = async (t: ReturnType<typeof setup>, headers: Record<string, string>, query: Record<string, string> = {}) =>
      (await t.plugin.__httpRequestHandler({ endpoint: "mcp", method: "POST", body: { jsonrpc: "2.0", id: 1, method: "ping" }, query,
        headers: { host: "tablet:8080", "content-type": "application/json", ...headers } })).status;
    const off = setup({ McpToken: token });
    expect(await call(off, { authorization: `Bearer ${token}` })).toBe(404);
    const on = setup({ McpAccess: "read", McpToken: token, McpPublicAccess: "shots", McpPublicToken: publicToken, McpPublicUrl: "https://x.ts.net/bj" });
    expect(await call(on, { authorization: `Bearer ${token}` })).not.toBe(404);
    expect(await call(on, { authorization: "Bearer bjm_wrong" })).toBe(404);
    expect(await call(on, {}, { token: publicToken })).not.toBe(404);
    expect(await call(on, {})).toBe(404);
    expect(await call(setup({ McpAccess: "full", McpToken: "bbm_" + "a".repeat(43) }), { authorization: `Bearer bbm_${"a".repeat(43)}` })).toBe(404);
    const tab = await on.ok({ action: "mcp" });
    expect(tab).toEqual({ access: "read", token, publicAccess: "shots", publicToken, publicUrl: "https://x.ts.net/bj", confirm: "changes",
      path: `/api/v1/plugins/${PLUGIN_ID}/mcp`, lanUrl: `http://192.168.1.20:8080/api/v1/plugins/${PLUGIN_ID}/mcp` });
    expect((await on.ok({ action: "status" })).mcp).toBe("read");
  });

  it("works in Decaid's plugin engine, which has no URL class", async () => {
    execFileSync(process.execPath, [resolve("scripts", "build.mjs")], { stdio: "pipe" });
    const t = setup({}, { beans: [{ id: "b1", roaster: "R", name: "Kiambu", decaf: false, archived: false, createdAt: "x" }] });
    t.plugin.onUnload();
    const context: Record<string, unknown> & { createPlugin?: typeof createPlugin } = { fetch: globalThis.fetch, setTimeout, clearTimeout, console };
    runInNewContext(readFileSync(resolve("build", PLUGIN_ID, "plugin.js"), "utf8"), context);
    expect(context.URL).toBeUndefined();
    const plugin = context.createPlugin!({ log: () => {}, storage: () => {} });
    plugin.onLoad({});
    cleanup.push(() => plugin.onUnload());
    const call = async (body: ObjectData, origin: string) => {
      const res = await plugin.__httpRequestHandler({ endpoint: "control", method: "POST", body,
        headers: { origin, "content-type": "application/json", "x-bean-journal-ui": "1" } });
      return { status: res.status, data: JSON.parse(res.body) };
    };
    expect((await call({ action: "status" }, "http://192.168.1.20:8080")).data.version).toBe(VERSION);
    expect((await call({ action: "status" }, "https://evil.example")).status).toBe(403);
    const chosen = await call({ action: "select", coffeeId: "bean:b1" }, "http://localhost:8080");
    expect(chosen.data.coffee).toMatchObject({ beanId: "b1", name: "Kiambu" });
    const skin = await plugin.__httpRequestHandler({ endpoint: "skin", method: "GET", body: null, headers: { origin: "http://localhost:3000" } });
    expect(JSON.parse(skin.body).surfaces[0]).toMatchObject({ label: "Kiambu" });
  });

  // Other plugins pin a version of the core: the package says the plugin's.
  it("keeps package.json's version with the plugin's", () => {
    expect(JSON.parse(readFileSync(resolve("package.json"), "utf8")).version).toBe(VERSION);
  });
});
