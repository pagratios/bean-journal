import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
import { texts } from "./i18n";
import { page } from "./ui";

const source = readFileSync(resolve("src", "ui.ts"), "utf8");
const theme = readFileSync(resolve("src", "theme.css"), "utf8");

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
      "update-preferences", "shot-text", "mcp"]) {
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
});

// Run the serialized page's actual R2 helpers and click handler without starting the other tabs.
const prefix = source.slice(source.indexOf("function client("), source.indexOf("  // ── Tabs ──"));
const click = source.slice(source.indexOf("    r2Button.onclick ="), source.indexOf('    // Beside the "TDS %" caption'));
const code = transformSync(`${prefix}
  return { findR2, searchR2IfMissing, searchR2, theme: document.documentElement.dataset.theme,
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
  theme: string;
};

const sensor = { id: "AA:BB:CC:DD:EE:01", info: { name: "DiFluid R2",
  data: [{ key: "tds", type: "number" }], commands: [{ id: "measure" }] } };

function setup({ found = false, state = "sleeping", hidden = false, search = "?view=shot&embed=1&theme=dark" } = {}) {
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
  const client: R2Client = runInNewContext(`${code}\nclient(texts)`, {
    module: { exports: {} }, texts, URLSearchParams, URL, Date, Number, Error, Event, setTimeout, Map, WeakMap,
    MutationObserver: class { observe() {} }, addEventListener: () => {},
    location: { search }, window: { matchMedia: () => ({ matches: false }) },
    document: {
      documentElement: { dataset, classList: { add: () => {}, contains: () => false } },
      getElementById: (id: keyof typeof elements) => elements[id],
      querySelectorAll: (selector: string) => selector === "select" ? [] : [button],
      querySelector: () => null,
      addEventListener: () => {},
    },
    fetch: fetcher,
  });
  return { client, fetcher, elements, button, dataset };
}

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
