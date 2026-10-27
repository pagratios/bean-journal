import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { texts } from "./i18n";
import { page } from "./ui";
import { askChoices, CHOICE_DIALOG_CSS, createPointerGuard, createRatingSlider, RATING_SLIDER_CSS } from "./core";

const source = readFileSync(resolve("src", "ui.ts"), "utf8");
const theme = readFileSync(resolve("src", "core", "theme.css"), "utf8");

function render() {
  vi.stubGlobal("__DECAID_COPY__", texts);
  vi.stubGlobal("__DECAID_THEME__", theme);
  return page();
}
const script = (html: string) => html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("the page", () => {
  it("is one document with the theme first in its style and one script that parses", () => {
    const html = render();
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(`<style>${theme}`);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(() => new Function(script(html))).not.toThrow();
    expect(html).toContain(`<title>${texts.title}</title>`);
  });

  it("says nothing of Beanbox, its account or its cloud", () => {
    const html = render();
    expect(html).not.toMatch(/beanbox/i);
    expect(JSON.stringify(texts)).not.toMatch(/beanbox/i);
    for (const gone of ["api-key", "verify-key", "send-shot", "download-shot", "remote-shot", "skip-shot", "machines", "make-profile", "suggestions", "recipes\"", "offline"]) {
      expect(html).not.toContain(gone);
    }
  });

  it("has every view, tab and the picker", () => {
    const html = render();
    for (const view of ["shot", "coffees", "settings", "ai"]) {
      expect(html).toContain(`id="view-${view}"`);
      expect(html).toContain(`id="tab-${view}"`);
    }
    for (const id of ["next-coffee", "picker", "picker-finished", "picker-add", "show-finished", "add-coffee", "coffee-detail", "grid",
      "on-choice", "visualizer-notes", "r2-search", "r2-state", "mcp-access", "mcp-public-access", "mcp-confirm", "shot-set", "load-this", "act-done"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // The address opens a coffee's page, the gear card and the picker.
    for (const view of ['"coffee"', '"pick"', '"next"']) expect(source).toContain(`wanted === ${view}`);
  });

  it("calls the plugin with its own header, and speaks Streamline's overlay protocol", () => {
    const html = render();
    expect(html).toContain('"x-bean-journal-ui": "1"');
    expect(html).toContain('"content-type": "application/json"');
    for (const type of ["streamline:ready", "streamline:close", "streamline:size", "streamline:espresso-start"]) expect(html).toContain(type);
    expect(html).toContain("/ws/v1/machine/snapshot");
    expect(html).toContain("/api/v1/store/streamlineSettings/theme");
    expect(html).toContain("/api/v1/store/beanJournal-photos/");
  });

  it("uses the contract's actions", () => {
    for (const action of ["status", "coffees", "coffee", "save-coffee", "add-bag", "set-photo", "select", "choose-coffee", "shot", "shots",
      "shot-by-id", "latest", "rate-shot", "assign-coffee", "delete-shot", "load-shot", "next-settings", "grinders", "waters",
      "save-grinder", "archive-grinder", "save-water", "remove-water",
      "update-preferences", "shot-text", "mcp", "old-bags", "finish-old-bags"]) {
      expect(source).toContain(`api("${action}"`);
    }
    expect(source).toContain('api("delete-shot", { shotId: s.id, confirmed: true })');
    expect(source).toContain("addToBeanId");
    expect(source).toContain("saveNew: true");
  });

  it("takes photos from the camera or the gallery, made small", () => {
    expect(source).toContain('file.accept = "image/*"');
    expect(source).toContain('file.setAttribute("capture", "environment")');
    expect(source).toContain("800 / Math.max(");
    expect(source).toContain('toDataURL("image/jpeg", quality)');
  });

  it("opens outside pages without a new window (the overlay has no popups)", () => {
    const html = render();
    expect(html).not.toContain("_blank");
    expect(source).toContain("https://visualizer.coffee/shots/");
  });

  it("makes Bean Journal's MCP tokens and paths", () => {
    const html = render();
    expect(html).toContain("bjm_");
    expect(html).toContain("/api/v1/plugins/bean-journal.reaplugin/mcp");
    expect(html).toContain("--set-path /bean-journal");
  });

  it("keeps the owner's sizes: toggles, steps and the R2 button, and a score slider in steps of 5", () => {
    const html = render();
    expect(html).toContain("min-width:6.4rem;min-height:2.267rem");
    expect(html).toContain("min-width:1.733rem;min-height:2.4rem");
    expect(html).toContain("width:1.867rem;height:1.867rem");
    expect(source).toContain('range.step = "5"');
    expect(html).toContain("height:100dvh;overflow:hidden");
  });

  it("keeps the gear card transparent, without a dark color-scheme on html", () => {
    const html = render();
    expect(html).toContain("html.gear-only,html.gear-only body{background:transparent!important;color-scheme:normal!important}");
    expect(source).toContain(`document.querySelector('meta[name="color-scheme"]')?.remove()`);
  });

  it("serializes the shared five-step controls and intentional dialog layout, saving only changed ratings", () => {
    const html = render();
    expect(html).toContain(createRatingSlider.toString());
    expect(html).toContain(askChoices.toString());
    expect(html).toContain(RATING_SLIDER_CSS);
    expect(html).toContain(CHOICE_DIALOG_CSS);
    expect(source).toContain('const tasteRow = el("div", "rating-sliders")');
    expect(source).toContain("if (taste.value !== s.balance) patch.balance = taste.value");
    expect(source).toContain("if (body.value !== s.body) patch.body = body.value");
    expect(source).toContain("return showChoices(text, choices, dismiss)");
    expect(html).toContain('"sour-balanced"');
    expect(html).toContain('"medium-heavy"');
  });
});

describe("coffee list refreshes", () => {
  const section = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const code = transformSync(`function coffeeClient() {
    let coffees = [], coffeesLoaded = false, status = {}, showFinished = false;
    const list = (v) => v, asCoffee = (v) => v, str = (v) => typeof v === "string" ? v : "";
    const $ = (id) => elements[id], say = report, t = texts, busy = false;
    const el = (tag, className, text) => ({ tag, className, text });
    const renderNext = () => {}, renderFilters = () => {}, offerOldBags = () => {};
    const renderCoffees = () => { elements.grid.scrollTop = 0; rendered.grid = withFinishedLast(coffees).map((c) => c.id); };
    const renderPicker = () => { elements["picker-list"].scrollTop = 0; rendered.picker = withFinishedLast(coffees).map((c) => c.id); };
    ${section("  const nextCoffee =", "  function renderNext()")}
    ${section("  const withFinishedLast =", "  // What choosing did")}
    ${section("  const nextFirst =", "  // What's left")}
    ${section("  let coffeeRead =", "  // ── Old bags:")}
    return { refreshStatus, refreshCoffeeLists, ensureCoffees, ids: () => coffees.map((c) => c.id) };
  }`, { loader: "ts" }).code;
  function setupCoffeeClient() {
    const status = () => ({ hidden: true, className: "", children: [] as { text: string; onclick?: () => void }[],
      replaceChildren(...children: { text: string }[]) { this.children = children; },
      append(child: { text: string }) { this.children.push(child); } });
    const elements = { grid: { scrollTop: 120 }, "picker-list": { scrollTop: 240 }, picker: { open: true },
      "view-coffees": { hidden: false }, "coffee-history": status(), "picker-history": status() };
    const rendered = { grid: [] as string[], picker: [] as string[] };
    const report = vi.fn(), api = vi.fn();
    const events = new Map<string, (event: unknown) => void>();
    class Target { closest() { return true; } }
    const client = runInNewContext(`${code}; coffeeClient()`, { elements, rendered, report, api, Error, texts, makePointerGuard: createPointerGuard,
      setTimeout, clearTimeout, Element: Target, window: { addEventListener: (name: string, fn: (e: unknown) => void) => events.set(name, fn) },
      document: { hidden: false, addEventListener: (name: string, fn: (e: unknown) => void) => events.set(name, fn) },
    }) as {
      refreshStatus: () => Promise<void>; refreshCoffeeLists: () => Promise<void>; ensureCoffees: (force?: boolean) => Promise<void>;
      ids: () => string[];
    };
    return { client, api, elements, rendered, report, events, Target };
  }
  const coffees = ["new", "old", "done"].map((id) => ({ id, finished: id === "done" }));

  it("refreshes selection in both views without losing their scroll positions", async () => {
    const t = setupCoffeeClient();
    t.api.mockResolvedValueOnce({ coffees }).mockResolvedValueOnce({ coffee: { id: "old" } })
      .mockResolvedValueOnce({ coffees: [coffees[1], coffees[0], coffees[2]] });
    await t.client.ensureCoffees();
    await t.client.refreshStatus();
    expect(t.rendered).toEqual({ grid: ["old", "new", "done"], picker: ["old", "new", "done"] });
    expect(t.elements.grid.scrollTop).toBe(120);
    expect(t.elements["picker-list"].scrollTop).toBe(240);
    t.api.mockResolvedValueOnce({ coffee: { id: "done" } }).mockResolvedValueOnce({ coffees });
    await t.client.refreshStatus();
    expect(t.rendered).toEqual({ grid: ["new", "old", "done"], picker: ["new", "old", "done"] });
    expect(t.report).not.toHaveBeenCalled();
  });
  it("does not let a slow previous response overwrite a newer ordering", async () => {
    const t = setupCoffeeClient();
    let finish!: (value: unknown) => void;
    t.api.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ coffees });
    const stale = t.client.ensureCoffees(true);
    await t.client.refreshCoffeeLists();
    finish({ coffees: [...coffees].reverse() });
    await stale;
    expect(t.client.ids()).toEqual(["new", "old", "done"]);
    expect(t.rendered.grid).toEqual(["new", "old", "done"]);
    expect(t.rendered.picker).toEqual(t.rendered.grid);
  });
  it("surfaces refresh errors and keeps the last rendered lists", async () => {
    const t = setupCoffeeClient();
    t.api.mockResolvedValueOnce({ coffees }).mockRejectedValueOnce(new Error("Offline"));
    await t.client.refreshCoffeeLists();
    await t.client.refreshCoffeeLists();
    expect(t.report).toHaveBeenCalledWith("Offline", "error");
    expect(t.rendered.grid).toEqual(["new", "old", "done"]);
    expect(source).toContain('if (view === "coffees") void loadCoffees(true)');
    expect(source).toContain('await ensureCoffees(true);\n    // Each time a fresh list');
    expect(source).toContain('void refreshStatus(true).then(() => refreshCoffeeLists())');
  });
  it("labels saved, missing and failed history and exposes retry without hiding the coffee cards", async () => {
    const t = setupCoffeeClient();
    t.api.mockResolvedValueOnce({ coffees, history: { source: "saved", stale: true, refreshing: true } });
    await t.client.refreshCoffeeLists();
    expect(t.elements["coffee-history"].children[0].text).toBe(texts.coffeeOrderRefreshing);
    expect(t.rendered.grid).toEqual(["new", "old", "done"]);
    t.api.mockResolvedValueOnce({ coffees, history: { source: "none", stale: true, refreshing: true, cache: "missing" } });
    await t.client.refreshCoffeeLists();
    expect(t.elements["coffee-history"].children[0].text).toBe(texts.coffeeOrderBuilding);
    t.api.mockResolvedValueOnce({ coffees, history: { source: "none", stale: true, refreshing: true,
      cache: "invalid", error: "invalidData" } });
    await t.client.refreshCoffeeLists();
    expect(t.elements["coffee-history"].children[0].text).toContain(texts.coffeeOrderInvalid);
    expect(t.elements["coffee-history"].children[0].text).toContain(texts.coffeeOrderFallback);
    t.api.mockResolvedValueOnce({ coffees, history: { source: "none", stale: true, refreshing: false, error: "network" } });
    await t.client.refreshCoffeeLists();
    expect(t.elements["coffee-history"].children[0].text).toContain(texts.coffeeOrderFallback);
    expect(t.elements["coffee-history"].children[1].text).toBe(texts.coffeeOrderRetry);
    t.api.mockResolvedValueOnce({ coffees, history: { source: "current", stale: false, refreshing: false } });
    t.elements["coffee-history"].children[1].onclick!();
    await vi.waitFor(() => expect(t.elements["coffee-history"].hidden).toBe(true));
    expect(t.api).toHaveBeenLastCalledWith("coffees", { includeFinished: false, retryHistory: true });
  });
  it("defers refreshed cards during an active touch and uses fresh selection/finished flags after release", async () => {
    vi.useFakeTimers();
    const t = setupCoffeeClient();
    t.api.mockResolvedValueOnce({ coffees, selectedId: "old" });
    await t.client.refreshCoffeeLists();
    expect(t.rendered.grid).toEqual(["old", "new", "done"]);
    t.events.get("pointerdown")!({ target: new t.Target(), pointerId: 1 });
    const updated = [{ id: "new", finished: true }, { id: "done", finished: false }, { id: "old", finished: false }];
    t.api.mockResolvedValueOnce({ coffees: updated, selectedId: "new" });
    await t.client.refreshCoffeeLists();
    expect(t.client.ids()).toEqual(["new", "old", "done"]);
    expect(t.rendered.grid).toEqual(["old", "new", "done"]);
    t.events.get("pointerup")!({ pointerId: 1 });
    await vi.runOnlyPendingTimersAsync();
    expect(t.rendered.grid).toEqual(["done", "old", "new"]);
    expect(t.rendered.picker).toEqual(t.rendered.grid);
    expect(t.elements.grid.scrollTop).toBe(120);
  });
});

describe("nonblocking coffee page startup", () => {
  const start = source.indexOf("  function startPage("), end = source.indexOf("\n}\n\nexport function page", start);
  const boot = transformSync(source.slice(start, end), { loader: "ts" }).code;
  it.each(["coffees", "pick"])("starts %s before an unresolved status request finishes", (view) => {
    const calls: string[] = [];
    runInNewContext(boot, {
      params: new URLSearchParams(`?view=${view}`), views: ["shot", "coffees", "settings", "ai"],
      show: (value: string) => calls.push(value), refreshStatus: () => new Promise(() => {}),
      run: (fn: () => Promise<void>) => fn(), openPicker: async () => { calls.push("picker"); },
      document: { documentElement: { classList: { contains: () => false } } },
    });
    expect(calls).toContain(view === "coffees" ? "coffees" : "picker");
  });
});

describe("coffee resting-age labels", () => {
  const start = source.indexOf("  function bagDates("), end = source.indexOf("  function card(", start);
  const code = transformSync(`function labels(t) {
    const shortDate = (value) => value;
    const el = (tag, className, text) => ({
      tag, className, text, children: [], attributes: {},
      append(child) { this.children.push(child); },
      setAttribute(key, value) { this.attributes[key] = value; },
    });
    ${source.slice(start, end)}
    return { bagDates, restingAge };
  }`, { loader: "ts" }).code;
  type Node = { text: string; title: string; attributes: Record<string, string>; children: Node[] };
  const labels = runInNewContext(`${code}; labels(texts)`, { texts }) as {
    bagDates: (coffee: Record<string, unknown>) => Node;
    restingAge: (coffee: Record<string, unknown>) => Node | null;
  };

  it("shows small 5d and 0d labels with an accessible explanation, omitting unknown ages", () => {
    expect(labels.restingAge({ restingDays: null })).toBeNull();
    for (const days of [0, 5]) {
      const label = labels.restingAge({ restingDays: days })!;
      expect(label.text).toBe(`${days}d`);
      expect(label.title).toContain("excluding freezer time");
      expect(label.attributes["aria-label"]).toBe(label.title);
    }
    expect(labels.bagDates({ restingDays: 5, frozen: true, freezeDate: "2026-10-06" }).children.map((n) => n.text))
      .toEqual(["5d", "❄ 2026-10-06"]);
    expect(source).toContain('[t.resting, restingAge(c) ?? ""]');
    expect(source).toContain("const age = restingAge(b)");
  });
});

// Run the serialized page's navigation and R2 helpers without starting the other tabs.
const prefix = source.slice(source.indexOf("function client("), source.indexOf("  // ── Tabs ──"));
const click = source.slice(source.indexOf("    r2Button.onclick ="), source.indexOf('    // Beside the "TDS %" caption'));
const code = transformSync(`${prefix}
  return { findR2, searchR2IfMissing, searchR2, closeOverlay, fromSkin, theme: document.documentElement.dataset.theme,
    bindMeasurement(r2Button, tds) { ${click} } };
}`, { format: "cjs", loader: "ts" }).code;

type MeasurementButton = {
  disabled: boolean; classList: { add: (name: string) => void; remove: (name: string) => void };
  onclick?: () => Promise<void>;
};
type TdsInput = { value: string; isConnected: boolean; dispatchEvent: (event: Event) => void };
type R2Client = {
  findR2: () => Promise<boolean>;
  searchR2IfMissing: () => Promise<void>;
  searchR2: () => Promise<boolean>;
  bindMeasurement: (button: MeasurementButton, tds: TdsInput) => void;
  closeOverlay: () => void;
  fromSkin: boolean;
  theme: string;
};

const sensor = { id: "AA:BB:CC:DD:EE:01", info: { name: "DiFluid R2",
  data: [{ key: "tds", type: "number" }], commands: [{ id: "measure" }] } };

function setup({ found = false, state = "sleeping", hidden = false, search = "?view=shot&embed=1&theme=dark",
  referrer = "", historyLength = 1 } = {}) {
  const elements = {
    "view-shot": { hidden },
    notice: { textContent: "", className: "" },
  };
  const button = { hidden: true };
  const fetcher = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
    if (url === "/api/v1/sensors") return Response.json(found ? [sensor] : []);
    if (url === "/api/v1/machine/state") return Response.json({ state: { state } });
    if (url === "/api/v1/devices/scan?connect=false") { found = true; return Response.json([]); }
    if (url === "/api/v1/store/streamlineSettings/theme") return Response.json("dark");
    if (url.endsWith("/execute")) return Response.json({ status: "ok", result: { reading: { tds: 9.37 } } });
    throw new Error(`Unexpected request: ${url}`);
  });
  const dataset: Record<string, string> = {};
  const assign = vi.fn(), back = vi.fn(), postMessage = vi.fn(), onPageEvent = vi.fn();
  const client: R2Client = runInNewContext(`${code}\nclient(texts)`, {
    module: { exports: {} }, texts, URLSearchParams, URL, Date, Number, Error, Event, setTimeout, Map, WeakMap,
    clearTimeout, MutationObserver: class { observe() {} }, addEventListener: onPageEvent,
    history: { length: historyLength, back },
    location: { search, assign }, window: { matchMedia: () => ({ matches: false }), parent: { postMessage } },
    document: {
      referrer,
      documentElement: { dataset, classList: { add: () => {}, contains: () => false } },
      getElementById: (id: keyof typeof elements) => elements[id],
      querySelectorAll: (selector: string) => selector === "select" ? [] : [button],
      querySelector: () => null,
      addEventListener: () => {},
    },
    fetch: fetcher,
  });
  return { client, fetcher, elements, button, dataset, assign, back, postMessage, onPageEvent };
}

describe("fullscreen page navigation", () => {
  const skin = "http://localhost:3000/?page=main";
  const search = `?view=shot&returnTo=${encodeURIComponent(skin)}&theme=dark`;

  it("returns to Streamline directly when there is no matching history entry", () => {
    const t = setup({ search });
    expect(t.client.fromSkin).toBe(true);
    t.client.closeOverlay();
    expect(t.assign).toHaveBeenCalledWith(skin);
    expect(t.back).not.toHaveBeenCalled();
    expect(t.postMessage).not.toHaveBeenCalled();
  });

  it("uses history to restore the dashboard and cancels the fallback when it leaves", () => {
    vi.useFakeTimers();
    const t = setup({ search, referrer: "http://localhost:3000/", historyLength: 2 });
    t.client.closeOverlay();
    expect(t.back).toHaveBeenCalledOnce();
    const [event, onHide, options] = t.onPageEvent.mock.calls.find(([name]) => name === "pagehide")!;
    expect(event).toBe("pagehide");
    expect(options).toEqual({ once: true });
    onHide();
    vi.advanceTimersByTime(1500);
    expect(t.assign).not.toHaveBeenCalled();
  });

  it("falls back to Streamline when history navigation does not leave the page", () => {
    vi.useFakeTimers();
    const t = setup({ search, referrer: "http://localhost:3000/", historyLength: 2 });
    t.client.closeOverlay();
    vi.advanceTimersByTime(1499);
    expect(t.assign).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(t.assign).toHaveBeenCalledWith(skin);
  });

  it.each(["javascript:alert(1)", "https://user:password@example.com/", "/"])("rejects an unsafe return address: %s", (returnTo) => {
    const t = setup({ search: `?returnTo=${encodeURIComponent(returnTo)}&theme=dark` });
    expect(t.client.fromSkin).toBe(false);
  });

  it("keeps small embedded cards on the overlay close protocol even with a return address", () => {
    const t = setup({ search: `${search}&embed=1` });
    t.client.closeOverlay();
    expect(t.postMessage).toHaveBeenCalledWith({ type: "streamline:close" }, "*");
    expect(t.assign).not.toHaveBeenCalled();
    expect(t.back).not.toHaveBeenCalled();
  });
});

describe("theme", () => {
  it("follows ?theme=, else Streamline's own choice in Decaid's store", async () => {
    expect(setup().client.theme).toBe("dark");
    const t = setup({ search: "?view=shot&embed=1" });
    expect(t.client.theme).toBe("light");
    await vi.waitFor(() => expect(t.dataset.theme).toBe("dark"));
    expect(t.fetcher).toHaveBeenCalledWith("/api/v1/store/streamlineSettings/theme");
  });
});

describe("R2 controls on the tablet page", () => {
  it("finds the R2 from the data channels sent by Decaid", async () => {
    const t = setup({ found: true });
    await t.client.searchR2IfMissing();
    expect(t.button.hidden).toBe(false);
    expect(t.fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses a full discovery-only scan when opened asleep", async () => {
    vi.useFakeTimers();
    const t = setup();
    let finishScan: ((value: Response) => void) | undefined;
    t.fetcher.mockImplementationOnce(async () => Response.json([]));
    t.fetcher.mockImplementationOnce(async () => Response.json({ state: { state: "sleeping" } }));
    t.fetcher.mockImplementationOnce(() => new Promise((resolve) => { finishScan = resolve; }));
    const pending = t.client.searchR2IfMissing();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.fetcher).toHaveBeenLastCalledWith("/api/v1/devices/scan?connect=false");
    expect(t.button.hidden).toBe(true);
    t.fetcher.mockImplementationOnce(async () => Response.json([sensor]));
    finishScan!(Response.json([]));
    await pending;
    expect(t.button.hidden).toBe(false);
    expect(t.elements.notice.textContent).toBe(texts.r2Appeared);
  });

  it("waits for sensor registration and shares an in-flight scan", async () => {
    vi.useFakeTimers();
    const t = setup();
    t.fetcher.mockImplementationOnce(async () => Response.json([]));
    t.fetcher.mockImplementationOnce(async () => Response.json([]));
    t.fetcher.mockImplementationOnce(async () => Response.json([sensor]));
    const first = t.client.searchR2();
    expect(t.client.searchR2()).toBe(first);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await first).toBe(true);
    expect(t.button.hidden).toBe(false);
    expect(t.fetcher.mock.calls.filter(([url]) => url.includes("/scan"))).toHaveLength(1);
  });

  it.each(["espresso", "steam", "hotWater"])("does not automatically scan during %s", async (state) => {
    const t = setup({ state });
    await t.client.searchR2IfMissing();
    expect(t.fetcher.mock.calls.some(([url]) => url.includes("/scan"))).toBe(false);
  });

  it("does not scan from another tab", async () => {
    const t = setup({ hidden: true });
    await t.client.searchR2IfMissing();
    expect(t.fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports a failed scan and allows an immediate retry", async () => {
    const t = setup();
    t.fetcher.mockImplementationOnce(async () => Response.json([], { status: 503 }));
    expect(await t.client.searchR2()).toBe(false);
    expect(t.elements.notice).toMatchObject({ className: "notice error", textContent: "Could not search for the R2: HTTP 503" });
    await t.client.searchR2IfMissing();
    expect(t.button.hidden).toBe(false);
    expect(t.fetcher.mock.calls.filter(([url]) => url.includes("/scan"))).toHaveLength(2);
  });

  it("takes one reading into TDS, and keeps TDS when the R2 fails", async () => {
    const t = setup({ found: true });
    await t.client.findR2();
    const button: MeasurementButton = { disabled: false, classList: { add: vi.fn(), remove: vi.fn() } };
    const tds: TdsInput = { value: "8.1", isConnected: true, dispatchEvent: vi.fn() };
    t.client.bindMeasurement(button, tds);
    await button.onclick!();
    const requests = t.fetcher.mock.calls.filter(([url]) => url.endsWith("/execute"));
    expect(requests).toHaveLength(1);
    expect(requests[0]![0]).toBe("/api/v1/sensors/AA%3ABB%3ACC%3ADD%3AEE%3A01/execute");
    expect(JSON.parse(String(requests[0]![1]!.body))).toEqual({ commandId: "measure", params: { timeout: 30 } });
    expect(tds.value).toBe("9.37");
    expect(tds.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "input", bubbles: true }));
    t.fetcher.mockImplementationOnce(async () => Response.json({ status: "error", message: "Exception: R2 disconnected" }, { status: 500 }));
    await button.onclick!();
    expect(tds.value).toBe("9.37");
    expect(t.elements.notice.textContent).toBe("The R2 didn't measure: R2 disconnected");
    expect(button.disabled).toBe(false);
  });
});
