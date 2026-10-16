import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  designedProfile, mcpMessage, mcpTokenPattern, mcpToolList, streamlineSurfaces, tagChoice, tagIn,
  type McpServer, type McpContext, type ObjectData, type SurfaceCopy,
} from "./index";

const folder = resolve("src", "core");
const sources = readdirSync(folder).filter((f) => /\.(ts|css)$/.test(f) && !f.endsWith(".test.ts"));

describe("the core", () => {
  // Other plugins build on it: it must not name a product or reach into one.
  it("names no product and imports only itself", () => {
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const code = readFileSync(resolve(folder, file), "utf8");
      expect(code, file).not.toMatch(/bean[\s_-]?journal|beanbox|bjm_/i);
      for (const [, from] of code.matchAll(/from\s+"([^"]+)"/g)) expect(from, `${file} imports ${from}`).toMatch(/^\.\/[\w-]+$/);
    }
  });

  it("reads a plugin's own extras by its key", () => {
    const shot = { extras: { mine: { balance: "sour", body: "chewy" }, theirs: { balance: "bitter" } } };
    expect(tagIn(shot, "mine")).toEqual({ balance: "sour", body: "chewy" });
    expect(tagIn({}, "mine")).toEqual({});
    expect(tagChoice(tagIn(shot, "mine"), "balance", ["sour", "bitter"])).toBe("sour");
    expect(tagChoice(tagIn(shot, "mine"), "body", ["thin", "heavy"])).toBeNull();
    expect(tagChoice(tagIn(shot, "theirs"), "body", ["thin"])).toBeUndefined();
  });

  it("leaves the assistant's dose for the plugin to keep", () => {
    const steps = [{ name: "Pour", pump: "pressure", pressure: 9, temperature: 93, seconds: 30 }];
    const made = designedProfile({ title: "Turbo", steps, dose: 18 });
    expect(made.profile.title).toBe("AI / Turbo");
    expect(made.dose).toBe(18);
    expect(designedProfile({ title: "Turbo", steps }).dose).toBeNull();
  });

  it("makes a token pattern from the plugin's prefix", () => {
    const token = mcpTokenPattern("abc");
    expect(token.test("abc_" + "x".repeat(32))).toBe(true);
    expect(token.test("abd_" + "x".repeat(32))).toBe(false);
    expect(token.test("abc_" + "x".repeat(31))).toBe(false);
  });
});

describe("streamlineSurfaces", () => {
  const s: SurfaceCopy = {
    lastGrind: "Last {grind}", lastGrindTitle: "", gearNone: "No gear", rpm: "{rpm} rpm", ratioMode: "Ratio", ratioTitle: "",
    scale: "Scale", scaleTitle: "", menuShot: "Edit", keepOnBare: "on", keepOff: "off", keepOnTitle: "", keepOffTitle: "",
  };
  const workflow = { profile: { title: "P" }, context: { targetDoseWeight: 18, targetYield: 36, grinderSetting: "12", grinderModel: "Niche", extras: { rpm: 800 } } };
  const byId = (answer: { surfaces: ObjectData[] }) => Object.fromEntries(answer.surfaces.map((x) => [x.id, x]));

  it("draws the plugin's own button, image and view", () => {
    const answer = streamlineSurfaces({
      s, workflow, kept: null, now: 0, lastGrind: "", water: "Soft",
      button: { id: "other", label: "A very long coffee name that won't fit", text: "Roaster", image: "https://example.com/a.jpg", view: "pick", saverLabel: "Other" },
    });
    const all = byId(answer);
    expect(all.other).toMatchObject({ kind: "header-button", label: "A very long coffee name…", text: "Roaster", image: "https://example.com/a.jpg", action: { view: "pick" } });
    expect(all["other-saver"]).toMatchObject({ kind: "screensaver-button", label: "Other" });
    expect(all.gear).toMatchObject({ text: "Niche · 800 rpm · Soft" });
    expect(all["last-grind"]).toBeUndefined();
    expect(answer.live).toEqual({ endpoint: "changed" });
  });

  it("leaves out what the plugin doesn't give", () => {
    const all = byId(streamlineSurfaces({
      s, workflow: { context: {} }, kept: null, now: 0, lastGrind: "14", water: "",
      button: { id: "x", label: "X", view: "shot", saverLabel: "X" },
    }));
    expect(all.x).not.toHaveProperty("text");
    expect(all.x).not.toHaveProperty("image");
    expect(all.gear).toMatchObject({ text: "No gear" });
    expect(all["last-grind"]).toMatchObject({ text: "Last 14", action: { value: 14 } });
    expect(all.ratio).toBeUndefined();
  });
});

describe("mcpMessage", () => {
  const server: McpServer = {
    name: "other", title: "Another plugin",
    tools: [
      { name: "look", level: "read", kind: "read", title: "Look", description: "Reads.", call: () => ({ action: "look" }) },
      { name: "pour", level: "full", kind: "machine", title: "Pour", description: "Changes the machine.",
        properties: { grams: { type: "number" } }, required: ["grams"], call: (a) => ({ action: "pour", body: { g: a.grams } }) },
    ],
  };
  const acts: [string, ObjectData][] = [];
  const ctx: McpContext = {
    level: "full", version: "9.9.9", instructions: "Hi",
    act: async (action, body) => { acts.push([action, body]); return { ok: action }; },
    explain: () => "failed", says: { notAllowed: "no", tooMany: "slow", confirm: "ask" },
  };
  const call = (name: string, args: ObjectData = {}) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

  it("introduces the plugin's server and lists its tools by level", async () => {
    const init = await mcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, server, ctx);
    expect(init?.result).toMatchObject({ serverInfo: { name: "other", title: "Another plugin", version: "9.9.9" }, instructions: "Hi" });
    expect(mcpToolList(server.tools, "read").map((t) => t.name)).toEqual(["look"]);
    expect(mcpToolList(server.tools, "full").find((t) => t.name === "pour")?.inputSchema.properties).toHaveProperty("confirmed");
  });

  it("runs the plugin's actions, asking first for machine changes", async () => {
    acts.length = 0;
    const asked = await mcpMessage(call("pour", { grams: 5 }), server, ctx);
    expect(JSON.stringify(asked)).toContain("needs_confirmation");
    expect(acts).toEqual([]);
    const done = await mcpMessage(call("pour", { grams: 5, confirmed: true }), server, ctx);
    expect(acts).toEqual([["pour", { g: 5, action: "pour" }]]);
    expect(done?.result).toMatchObject({ structuredContent: { ok: "pour" }, isError: false });
    const refused = await mcpMessage(call("pour", { grams: 5, confirmed: true }), server, { ...ctx, level: "read" });
    expect(refused?.result).toMatchObject({ isError: true, content: [{ text: "no" }] });
  });
});
