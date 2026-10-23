import { describe, expect, it, vi } from "vitest";
import { MCP_BUDGET, MCP_TOKEN, MCP_TOOLS, mcpMessage, mcpToolList, rateLimit, type McpContext } from "./mcp";

type ObjectData = Record<string, unknown>;
const object = (value: unknown) => value as ObjectData;
const context = (over: Partial<McpContext> = {}): McpContext => ({
  level: "read", confirm: "none", version: "9.9.9", instructions: "Hello", says: { notAllowed: "Not allowed", tooMany: "Too many", confirm: "Ask first" },
  act: vi.fn(async () => ({ ok: true })), explain: (e) => (e instanceof Error ? `said: ${e.message}` : "failed"), ...over,
});
const call = (name: string, args: ObjectData = {}, id = 1) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const props = (name: string, confirm: McpContext["confirm"] = "changes") => object(mcpToolList("full", confirm).find((t) => t.name === name)!.inputSchema.properties);

describe("MCP messages", () => {
  it("answers initialize as Bean Journal, with the asked protocol version when known, else the newest", async () => {
    const known = await mcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, context());
    expect(known).toMatchObject({ id: 1, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} },
      serverInfo: { name: "bean-journal", title: "Bean Journal on the Decent", version: "9.9.9" }, instructions: "Hello" } });
    const unknown = await mcpMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, context());
    expect(unknown).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
  });

  it("answers nothing to notifications and refuses what isn't JSON-RPC", async () => {
    expect(await mcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, context())).toBeNull();
    expect(await mcpMessage([], context())).toMatchObject({ error: { code: -32600 } });
    expect(await mcpMessage({ id: 1, method: "ping" }, context())).toMatchObject({ error: { code: -32600 } });
    expect(await mcpMessage({ jsonrpc: "2.0", id: 1, method: "resources/list" }, context())).toMatchObject({ error: { code: -32601 } });
    expect(await mcpMessage({ jsonrpc: "2.0", id: 7, method: "ping" }, context())).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
    // A client's malformed params is its own mistake, answered as such rather than failing the request.
    expect(await mcpMessage({ jsonrpc: "2.0", id: 8, method: "tools/list", params: "x" }, context())).toMatchObject({ error: { code: -32602 } });
    const ctx = context();
    expect(await mcpMessage({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "get_status", arguments: [1] } }, ctx))
      .toMatchObject({ result: { isError: true } });
    expect(ctx.act).not.toHaveBeenCalled();
  });

  it("takes only bjm_ tokens", () => {
    expect(MCP_TOKEN.test(`bjm_${"a".repeat(32)}`)).toBe(true);
    expect(MCP_TOKEN.test(`bbm_${"a".repeat(32)}`)).toBe(false);
    expect(MCP_TOKEN.test("bjm_short")).toBe(false);
  });

  it("lists only the tools of the level, each level including the ones before", () => {
    const names = (level: McpContext["level"]) => mcpToolList(level).map((t) => t.name);
    expect(names("off")).toEqual([]);
    expect(names("read")).toEqual(["get_status", "get_dial_in_context", "list_coffees", "get_shot", "list_shots", "list_profiles",
      "list_equipment", "get_preferences", "get_refractometer"]);
    expect(names("shots")).toEqual([...names("read"), "rate_shot", "delete_shot", "measure_tds", "set_next_shot", "add_coffee", "update_coffee"]);
    expect(names("full")).toEqual([...names("shots"), "create_profile", "update_profile", "update_preferences", "search_refractometer",
      "choose_coffee", "load_profile", "load_shot_settings"]);
    expect(names("full")).toHaveLength(MCP_TOOLS.length);
    for (const tool of mcpToolList("full")) expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("refuses a tool above the level even when confirmed", async () => {
    const levels = ["off", "read", "shots", "full"] as const;
    const samples: Record<string, ObjectData> = {
      rate_shot: { shot_id: "s1", score: 80 }, delete_shot: { shot_id: "s1" }, add_coffee: { roaster: "R", name: "N" },
      update_coffee: { coffee_id: "c1", finished: true }, update_preferences: { on_coffee_choice: "best" },
      choose_coffee: { coffee_id: "c1" }, load_shot_settings: { shot_id: "s1" },
    };
    for (const tool of MCP_TOOLS) {
      for (const level of levels.slice(0, levels.indexOf(tool.level))) {
        const ctx = context({ level });
        expect(mcpToolList(level).map((t) => t.name)).not.toContain(tool.name);
        expect(await mcpMessage(call(tool.name, { ...samples[tool.name], confirmed: true }), ctx)).toMatchObject({ result: { isError: true, content: [{ text: "Not allowed" }] } });
        expect(ctx.act).not.toHaveBeenCalled();
      }
    }
  });

  it("always asks before deleting a shot, even when confirmation is disabled", async () => {
    const ctx = context({ level: "shots", confirm: "none" });
    expect(await mcpMessage(call("delete_shot", { shot_id: "s1" }), ctx)).toMatchObject({ result: { structuredContent: { needs_confirmation: true, arguments: { shot_id: "s1" } } } });
    expect(ctx.act).not.toHaveBeenCalled();
    await mcpMessage(call("delete_shot", { shot_id: "s1", confirmed: true }), ctx);
    expect(ctx.act).toHaveBeenCalledTimes(1);
    expect(ctx.act).toHaveBeenCalledWith("delete-shot", { action: "delete-shot", shotId: "s1", confirmed: true });
    expect(props("delete_shot", "none")).toHaveProperty("confirmed");
    expect(mcpToolList("full", "none").find((t) => t.name === "delete_shot")!.annotations.destructiveHint).toBe(true);
    // The shot id alone: there is no remote copy to name.
    expect(Object.keys(props("delete_shot", "none"))).toEqual(["shot_id", "confirmed"]);
  });

  it("maps full profile edits and exposes exactly the Decaid beverage categories", async () => {
    const ctx = context({ level: "full" });
    await mcpMessage(call("update_profile", { profile_id: "profile:p", expected_updated_at: "now",
      beverage_type: "tea", tank_temperature: 80, target_volume_count_start: 1, dose: null }), ctx);
    expect(ctx.act).toHaveBeenCalledWith("update-profile", { action: "update-profile", profileId: "profile:p",
      expectedUpdatedAt: "now", beverageType: "tea", tankTemperature: 80, volumeCountStart: 1, dose: null });
    await mcpMessage(call("create_profile", { title: "Bloom", steps: [], dose: 18, save_new: true, confirmed: true }), context({ level: "full", act: ctx.act }));
    expect(ctx.act).toHaveBeenLastCalledWith("create-profile", { action: "create-profile", title: "Bloom", steps: [], dose: 18, saveNew: true });
    for (const name of ["create_profile", "update_profile"]) {
      expect(props(name).beverage_type).toMatchObject({ enum: ["espresso", "filter", "pourover", "tea", "tea_portafilter", "calibrate", "cleaning", "manual"] });
    }
  });

  it("runs a tool as the page's action, with the page's argument names", async () => {
    const act = vi.fn(async () => ({ offset: 2, older: true, shot: { id: "s1", series: { t: [0, 1] }, score: 80 } }));
    const answer = await mcpMessage(call("get_shot", { offset: 2, coffee_name: "Kiambu" }), context({ act }));
    expect(act).toHaveBeenCalledWith("shot", { action: "shot", offset: 2, filter: { coffeeName: "Kiambu", coffeeRoaster: undefined, profileTitle: undefined } });
    // The curves only when asked.
    expect(answer).toMatchObject({ result: { isError: false, structuredContent: { offset: 2, shot: { id: "s1", score: 80 } } } });
    expect(JSON.stringify(answer)).not.toContain("series");
    expect(JSON.stringify(await mcpMessage(call("get_shot", { shot_id: "s1", include_curves: true }), context({ act })))).toContain("series");
    expect(act).toHaveBeenLastCalledWith("shot-by-id", { action: "shot-by-id", shotId: "s1" });
    await mcpMessage(call("list_shots", { profile_title: "Bloom" }), context({ act }));
    expect(act).toHaveBeenLastCalledWith("shots", { action: "shots", filter: { coffeeName: undefined, coffeeRoaster: undefined, profileTitle: "Bloom" } });
    await mcpMessage(call("list_coffees", { include_finished: true }), context({ act }));
    expect(act).toHaveBeenLastCalledWith("coffees", { action: "coffees", includeFinished: true });
    await mcpMessage(call("get_dial_in_context", { coffee_id: "c1" }), context({ act }));
    expect(act).toHaveBeenLastCalledWith("dial-in", { action: "dial-in", coffeeId: "c1" });
    for (const [name, action] of [["get_status", "status"], ["list_equipment", "equipment"], ["get_preferences", "preferences"], ["get_refractometer", "refractometer"]]) {
      await mcpMessage(call(name), context({ act }));
      expect(act).toHaveBeenLastCalledWith(action, { action });
    }
    await mcpMessage(call("rate_shot", { shot_id: "s1", score: 85, grinder_model: "Lagom", balance: null, water: "Lotus Light" }), context({ level: "shots", act }));
    expect(act).toHaveBeenLastCalledWith("rate-shot", { action: "rate-shot", shotId: "s1", score: 85, grinderModel: "Lagom", balance: null, water: "Lotus Light" });
    await mcpMessage(call("measure_tds", { shot_id: "s1" }), context({ level: "shots", act }));
    expect(act).toHaveBeenLastCalledWith("measure-tds", { action: "measure-tds", sensorId: undefined, shotId: "s1" });
    const full = context({ level: "full", confirm: "none", act });
    await mcpMessage(call("load_profile", { profile_id: "profile:abc", dose: 18, coffee_id: "c1", water: "Volvic" }), full);
    expect(act).toHaveBeenLastCalledWith("load-profile", { action: "load-profile", profileId: "profile:abc", dose: 18, coffeeId: "c1", water: "Volvic", confirmed: true });
    await mcpMessage(call("load_profile", { profile_id: "profile:abc", ratio: 2.5, lock_ratio: true }), full);
    expect(act).toHaveBeenLastCalledWith("load-profile", { action: "load-profile", profileId: "profile:abc", ratio: 2.5, lockRatio: true, confirmed: true });
    await mcpMessage(call("load_shot_settings", { shot_id: "s1", coffee_id: "c1" }), full);
    expect(act).toHaveBeenLastCalledWith("load-shot", { action: "load-shot", shotId: "s1", coffeeId: "c1" });
    await mcpMessage(call("choose_coffee", { coffee_id: "c1", settings: "best" }), full);
    expect(act).toHaveBeenLastCalledWith("choose-coffee", { action: "choose-coffee", coffeeId: "c1", settings: "best" });
    await mcpMessage(call("update_preferences", { on_coffee_choice: "last" }), full);
    expect(act).toHaveBeenLastCalledWith("update-preferences", { action: "update-preferences", onCoffeeChoice: "last" });
    await mcpMessage(call("update_preferences", { visualizer_notes: true, on_coffee_choice: "best" }), full);
    expect(act).toHaveBeenLastCalledWith("update-preferences", { action: "update-preferences", onCoffeeChoice: "best", visualizerNotes: true });
    act.mockClear();
    expect(await mcpMessage(call("update_preferences"), context({ level: "full", confirm: "none", act, explain: (e) => e instanceof Error ? e.message : "" })))
      .toMatchObject({ result: { isError: true, content: [{ text: "invalidArguments" }] } });
    expect(act).not.toHaveBeenCalled();
    expect(props("update_preferences").visualizer_notes).toMatchObject({ type: "boolean" });
    await mcpMessage(call("search_refractometer"), full);
    expect(act).toHaveBeenLastCalledWith("search-refractometer", { action: "search-refractometer" });
    await mcpMessage(call("set_next_shot", { lock_ratio: false }), context({ level: "shots", act }));
    expect(act).toHaveBeenLastCalledWith("next-settings", { action: "next-settings", lockRatio: false });
    for (const name of ["set_next_shot", "load_profile"]) expect(props(name).lock_ratio).toMatchObject({ type: "boolean" });
    // Water is free text everywhere, never an id.
    for (const name of ["rate_shot", "set_next_shot", "load_profile"]) {
      expect(props(name).water).toMatchObject({ type: ["string", "null"] });
      expect(props(name)).not.toHaveProperty("water_id");
    }
  });

  it("refuses missing or unknown arguments, and says a failure in the page's words", async () => {
    const act = vi.fn(async () => { throw new Error("machineBusy"); });
    expect(await mcpMessage(call("rate_shot", { shot_id: "s1", score: 1 }), context({ act }))).toMatchObject({ result: { isError: true, content: [{ text: "Not allowed" }] } });
    expect(await mcpMessage(call("load_shot_settings"), context({ level: "full", confirm: "none", act }))).toMatchObject({ result: { isError: true, content: [{ text: "Missing: shot_id" }] } });
    expect(await mcpMessage(call("add_coffee", { name: "Kiambu" }), context({ level: "shots", act }))).toMatchObject({ result: { isError: true, content: [{ text: "Missing: roaster" }] } });
    expect(await mcpMessage(call("get_status", { x: 1 }), context({ act }))).toMatchObject({ result: { isError: true, content: [{ text: "Unknown arguments: x" }] } });
    // Beanbox's argument names are not taken.
    expect(await mcpMessage(call("rate_shot", { shot_id: "s1", bean_id: "b1", water_id: "w1" }), context({ level: "shots", act })))
      .toMatchObject({ result: { isError: true, content: [{ text: "Unknown arguments: bean_id, water_id" }] } });
    expect(await mcpMessage(call("delete_shot", { shot_id: "s1", brew_id: null, confirmed: true }), context({ level: "shots", act })))
      .toMatchObject({ result: { isError: true, content: [{ text: "Unknown arguments: brew_id" }] } });
    expect(await mcpMessage(call("nope"), context({ act }))).toMatchObject({ error: { code: -32602 } });
    expect(await mcpMessage(call("upload_shot"), context({ level: "full", act }))).toMatchObject({ error: { code: -32602 } });
    expect(act).not.toHaveBeenCalled();
    expect(await mcpMessage(call("get_status"), context({ act }))).toMatchObject({ result: { isError: true, content: [{ text: "said: machineBusy" }] } });
  });

  it("asks in the chat first, as the AI tab says, and runs once the user agreed", async () => {
    const act = vi.fn(async () => ({ ok: true }));
    const ctx = (confirm: McpContext["confirm"]) => context({ level: "full", confirm, act });
    // Machine and profile changes: asked, with what it would do; the call itself does nothing.
    const asked = await mcpMessage(call("load_profile", { profile_id: "profile:abc" }), ctx("changes"));
    expect(asked).toMatchObject({ result: { isError: false, structuredContent: { needs_confirmation: true, tool: "load_profile", arguments: { profile_id: "profile:abc" }, says: "Ask first" } } });
    expect(act).not.toHaveBeenCalled();
    await mcpMessage(call("load_profile", { profile_id: "profile:abc", confirmed: true }), ctx("changes"));
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenLastCalledWith("load-profile", { action: "load-profile", profileId: "profile:abc", confirmed: true });
    // A rating or a coffee is asked only with "every change"; reads never.
    await mcpMessage(call("rate_shot", { shot_id: "s1", score: 80 }), ctx("changes"));
    await mcpMessage(call("update_coffee", { coffee_id: "c1", remaining: 120 }), ctx("changes"));
    expect(act).toHaveBeenCalledTimes(3);
    for (const [name, args] of [["rate_shot", { shot_id: "s1", score: 80 }], ["add_coffee", { roaster: "R", name: "N" }], ["set_next_shot", { rpm: 900 }]] as const) {
      expect(await mcpMessage(call(name, args), ctx("all"))).toMatchObject({ result: { structuredContent: { needs_confirmation: true } } });
    }
    await mcpMessage(call("get_status"), ctx("all"));
    expect(act).toHaveBeenCalledTimes(4);
    // The schema says so where it applies.
    const keys = (confirm: McpContext["confirm"], name: string) => Object.keys(props(name, confirm));
    expect(keys("changes", "load_profile")).toContain("confirmed");
    expect(keys("changes", "update_preferences")).toContain("confirmed");
    expect(keys("changes", "rate_shot")).not.toContain("confirmed");
    expect(keys("changes", "add_coffee")).not.toContain("confirmed");
    expect(keys("all", "add_coffee")).toContain("confirmed");
    expect(keys("none", "load_profile")).not.toContain("confirmed");
  });

  it("runs a merged tool as the page actions its arguments name, in order, with their answers merged", async () => {
    const act = vi.fn(async (action: string) => action === "next-settings" ? { coffee: { id: "c1", beanId: "b1" }, next: { rpm: 900 } }
      : action === "assign-coffee" ? { shot: { id: "s1", coffeeId: "c1", series: { t: [0] } } } : { shot: { id: "s1", coffeeId: "c1", score: 80, series: { t: [0] } } });
    const shots = (over: Partial<McpContext> = {}) => context({ level: "shots", act, ...over });
    const order = () => act.mock.calls.map((c) => c[0]);
    // A shot's coffee and its rating: the coffee first, then the fields; only what is named.
    const rated = await mcpMessage(call("rate_shot", { shot_id: "s1", coffee_id: "c1", score: 80 }), shots());
    expect(order()).toEqual(["assign-coffee", "rate-shot"]);
    expect(act).toHaveBeenCalledWith("assign-coffee", { action: "assign-coffee", shotId: "s1", coffeeId: "c1" });
    expect(act).toHaveBeenLastCalledWith("rate-shot", { action: "rate-shot", shotId: "s1", score: 80 });
    expect(rated).toMatchObject({ result: { isError: false, structuredContent: { shot: { id: "s1", coffeeId: "c1", score: 80 } } } });
    expect(JSON.stringify(rated)).not.toContain("series");
    act.mockClear();
    await mcpMessage(call("rate_shot", { shot_id: "s1", coffee_id: null }), shots());
    expect(order()).toEqual(["assign-coffee"]);
    expect(act).toHaveBeenCalledWith("assign-coffee", { action: "assign-coffee", shotId: "s1", coffeeId: null });
    act.mockClear();
    await mcpMessage(call("rate_shot", { shot_id: "s1" }), shots());
    expect(order()).toEqual(["rate-shot"]);
    // The next shot's coffee and settings.
    act.mockClear();
    const next = await mcpMessage(call("set_next_shot", { coffee_id: "c1", rpm: 900, grinder_model: "Lagom P64", water: null }), shots());
    expect(order()).toEqual(["next-settings"]);
    expect(act).toHaveBeenLastCalledWith("next-settings", { action: "next-settings", coffeeId: "c1", rpm: 900, grinderModel: "Lagom P64", water: null });
    expect(next).toMatchObject({ result: { structuredContent: { coffee: { beanId: "b1" }, next: { rpm: 900 } } } });
    act.mockClear();
    await mcpMessage(call("set_next_shot", { coffee_id: null }), shots());
    expect(act).toHaveBeenCalledWith("next-settings", { action: "next-settings", coffeeId: null });
    expect(order()).toEqual(["next-settings"]);
    act.mockClear();
    await mcpMessage(call("set_next_shot", { coffee_id: "c1", lock_ratio: false }), shots());
    expect(act).toHaveBeenCalledExactlyOnceWith("next-settings", { action: "next-settings", coffeeId: "c1", lockRatio: false });
    act.mockClear();
    await mcpMessage(call("set_next_shot"), shots());
    expect(act).toHaveBeenCalledWith("next-settings", { action: "next-settings" });
    // One id or the list.
    const full = context({ level: "full", act });
    await mcpMessage(call("list_profiles", { profile_id: "profile:abc" }), full);
    expect(act).toHaveBeenLastCalledWith("profile", { action: "profile", profileId: "profile:abc" });
    await mcpMessage(call("list_profiles"), full);
    expect(act).toHaveBeenLastCalledWith("profiles", { action: "profiles" });
  });

  it("adds and edits coffees with the form's fields, passing duplicates back to ask about", async () => {
    const duplicates = [{ id: "batch-1", beanId: "bean-1", roaster: "Taf Coffee", name: "Kiambu AA" }];
    const act = vi.fn(async (action: string, body: ObjectData) => action === "coffee" ? { coffee: { id: body.id, beanId: "bean-1" }, bags: [], shots: [{ id: "s1" }], last: "s1", best: null }
      : body.addToBeanId || body.saveNew || body.id ? { coffee: { id: "batch-9", beanId: "bean-1" } } : { duplicates });
    const ctx = context({ level: "shots", act });
    const add = { roaster: "Taf Coffee", name: "Kiambu AA", country: "Kenya", varieties: ["SL28", "SL34"], altitude: [1700, 1900], process: "Washed",
      decaf: false, species: "Arabica", tasting_notes: "Blackcurrant", link: "https://example.com/kiambu", roast_date: "2026-10-01", roast_level: "Light",
      harvest_date: "2025", quality_score: 87, price: 18.5, currency: "EUR", buy_date: "2026-10-02", weight: 250,
      frozen: false, open_date: "2026-10-05", best_before: "2027-04-01", bag_notes: "Gift" };
    const fields = { roaster: "Taf Coffee", name: "Kiambu AA", country: "Kenya", varieties: ["SL28", "SL34"], altitude: [1700, 1900], process: "Washed",
      decaf: false, species: "Arabica", tastingNotes: "Blackcurrant", link: "https://example.com/kiambu", roastDate: "2026-10-01", roastLevel: "Light",
      harvestDate: "2025", qualityScore: 87, price: 18.5, currency: "EUR", buyDate: "2026-10-02", weight: 250,
      frozen: false, openDate: "2026-10-05", bestBefore: "2027-04-01", bagNotes: "Gift" };
    // A coffee already there: nothing saved, the duplicates passed back as they are.
    expect(await mcpMessage(call("add_coffee", add), ctx)).toMatchObject({ result: { isError: false, structuredContent: { duplicates } } });
    expect(act).toHaveBeenLastCalledWith("save-coffee", { action: "save-coffee", fields });
    // Then the user's choice: a separate coffee, or a new bag of the one shown (found by its bag's id).
    expect(await mcpMessage(call("add_coffee", { ...add, save_new: true }), ctx)).toMatchObject({ result: { structuredContent: { coffee: { id: "batch-9" } } } });
    expect(act).toHaveBeenLastCalledWith("save-coffee", { action: "save-coffee", fields, saveNew: true });
    act.mockClear();
    const added = await mcpMessage(call("add_coffee", { ...add, add_to_coffee_id: "batch-1" }), ctx);
    expect(act.mock.calls).toEqual([["coffee", { action: "coffee", id: "batch-1" }], ["save-coffee", { action: "save-coffee", fields, addToBeanId: "bean-1" }]]);
    // Only the saved coffee: not the lookup's shots.
    expect(object(object(added).result).structuredContent).toEqual({ coffee: { id: "batch-9", beanId: "bean-1" } });
    act.mockClear();
    const explain = (e: unknown) => e instanceof Error ? e.message : "failed";
    expect(await mcpMessage(call("add_coffee", { ...add, add_to_coffee_id: "batch-1", save_new: true }), context({ level: "shots", act, explain })))
      .toMatchObject({ result: { isError: true, content: [{ text: "invalidArguments" }] } });
    expect(act).not.toHaveBeenCalled();
    // The edit: only the fields given; null clears, finished and the freezer dates only here.
    await mcpMessage(call("update_coffee", { coffee_id: "batch-1", remaining: 120, region: null, finished: true, freeze_date: "2026-10-10", thaw_date: null }), ctx);
    expect(act).toHaveBeenLastCalledWith("save-coffee", { action: "save-coffee", id: "batch-1", fields: { remaining: 120, region: null, finished: true, freezeDate: "2026-10-10", thawDate: null } });
    // The photo goes beside the fields, on a new coffee, a new bag or an edit; null removes it.
    const photo = "https://example.com/kiambu.jpg";
    await mcpMessage(call("add_coffee", { ...add, photo }), ctx);
    expect(act).toHaveBeenLastCalledWith("save-coffee", { action: "save-coffee", fields, photo });
    await mcpMessage(call("add_coffee", { ...add, add_to_coffee_id: "batch-1", photo }), ctx);
    expect(act).toHaveBeenLastCalledWith("save-coffee", { action: "save-coffee", fields, photo, addToBeanId: "bean-1" });
    await mcpMessage(call("update_coffee", { coffee_id: "batch-1", photo: null, decaf_process: "Swiss Water" }), ctx);
    expect(act).toHaveBeenLastCalledWith("save-coffee", { action: "save-coffee", id: "batch-1", fields: { decafProcess: "Swiss Water" }, photo: null });
    expect(props("update_coffee").photo).toMatchObject({ type: ["string", "null"] });
    expect(props("add_coffee")).not.toHaveProperty("finished");
    expect(props("update_coffee").region).toMatchObject({ type: ["string", "null"] });
    // What Decaid can't clear stays non-null.
    for (const key of ["roaster", "name", "decaf", "frozen", "finished"]) expect(typeof props("update_coffee")[key] === "object" && object(props("update_coffee")[key]).type).not.toContain("null");
    expect(object(mcpToolList("shots").find((t) => t.name === "add_coffee")!.inputSchema).required).toEqual(["roaster", "name"]);
  });

  it("refuses changes beyond the minute's limit, never reads", async () => {
    let now = 0;
    const allowChange = rateLimit(2, 60000, () => now);
    const ctx = context({ level: "shots", allowChange });
    for (let i = 0; i < 2; i++) expect(await mcpMessage(call("set_next_shot", { rpm: 900 }), ctx)).toMatchObject({ result: { isError: false } });
    expect(await mcpMessage(call("set_next_shot", { rpm: 900 }), ctx)).toMatchObject({ result: { isError: true, content: [{ text: "Too many" }] } });
    expect(await mcpMessage(call("get_status"), ctx)).toMatchObject({ result: { isError: false } });
    now = 60001;
    expect(await mcpMessage(call("set_next_shot", { rpm: 900 }), ctx)).toMatchObject({ result: { isError: false } });
  });

  it("keeps the tool list within what clients take, with no word of Beanbox", () => {
    for (const confirm of ["none", "changes", "all"] as const) {
      const tools = mcpToolList("full", confirm);
      expect(tools.length).toBeLessThanOrEqual(MCP_BUDGET.tools);
      expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
      const descriptions = (schema: unknown): string[] => {
        const o = object(schema), own = typeof o.description === "string" ? [o.description] : [];
        return [...own, ...Object.values(object(o.properties ?? {})).flatMap(descriptions), ...(o.items ? descriptions(o.items) : [])];
      };
      for (const t of tools) {
        expect(t.description.length, t.name).toBeLessThanOrEqual(MCP_BUDGET.description);
        for (const d of descriptions(t.inputSchema)) expect(d.length, `${t.name}: ${d}`).toBeLessThanOrEqual(MCP_BUDGET.property);
      }
      const list = JSON.stringify({ tools });
      expect(list.length).toBeLessThanOrEqual(MCP_BUDGET.bytes);
      expect(list.toLowerCase()).not.toContain("beanbox");
      expect(list).not.toMatch(/recipe|upload_shot|brew_id|bean_id|water_id/i);
    }
  });
});
