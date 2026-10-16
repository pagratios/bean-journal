// A plugin's MCP server: AI assistants (Claude, Copilot…) reach the tablet at the plugin's `mcp` endpoint with a
// token. Streamable HTTP without streams: each POST is one JSON-RPC message, answered with JSON. Every tool is one or
// more of the page's own actions, so the rules stay one.
type ObjectData = Record<string, unknown>;

/** What the page's AI tab allows; each level includes the ones before it. */
export const MCP_LEVELS = ["off", "read", "shots", "full"] as const;
export type McpLevel = typeof MCP_LEVELS[number];
/** When the assistant must ask the user first: never, before changes to the machine and profiles, before any change. */
export const MCP_CONFIRMS = ["none", "changes", "all"] as const;
export type McpConfirm = typeof MCP_CONFIRMS[number];
export const MCP_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
/** Clients cut a long tool list without a word (Decenza saw ChatGPT drop 10 of 97 tools): a plugin's tests keep these. */
export const MCP_BUDGET = { tools: 40, description: 500, property: 120, bytes: 40000 };
/** A token as the page makes it: the plugin's prefix, an underscore and 32–128 URL-safe characters. */
export const mcpTokenPattern = (prefix: string) => new RegExp(`^${prefix}_[A-Za-z0-9_-]{32,128}$`);

const isObject = (value: unknown): value is ObjectData => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" ? value : "";
/** {} for nothing; anything but an object is refused, as the page's own reader does. */
function optionalObject(value: unknown): ObjectData {
  if (value == null) return {};
  if (!isObject(value)) throw new Error("invalidData");
  return value;
}

export type McpSchema = ObjectData;
/** One of the page's actions, with the page's argument names; a function body is built from the answers so far. */
export type McpStep = { action: string; body?: ObjectData | ((answer: ObjectData) => ObjectData) };
export type McpTool = {
  name: string; level: Exclude<McpLevel, "off">; title: string; description: string;
  /** read: changes nothing the user would notice; edit: a shot, a coffee or the next shot's coffee and gear; machine: the machine or profiles. */
  kind: "read" | "edit" | "machine";
  alwaysConfirm?: boolean;
  properties?: Record<string, McpSchema>; required?: string[];
  /** The page action(s) it runs, in order; their answers are merged. Throws invalidArguments for a bad combination. */
  call: (a: ObjectData) => McpStep | McpStep[];
  /** What the assistant gets back, when it differs from the page's answer. */
  shape?: (result: unknown, a: ObjectData) => unknown;
};

const allows = (level: McpLevel, need: McpTool["level"]) => MCP_LEVELS.indexOf(level) >= MCP_LEVELS.indexOf(need);
const asks = (confirm: McpConfirm, tool: McpTool) => tool.alwaysConfirm === true || (tool.kind !== "read" && (confirm === "all" || (confirm === "changes" && tool.kind === "machine")));
const CONFIRMED: McpSchema = { type: "boolean", description: "true only after the user agreed to this call (it answered needs_confirmation)." };

/** The tools a level may see, as `tools/list` gives them; those that must be asked first take `confirmed`. */
export function mcpToolList(tools: McpTool[], level: McpLevel, confirm: McpConfirm = "changes") {
  return tools.filter((t) => allows(level, t.level)).map((t) => ({
    name: t.name, title: t.title, description: t.description,
    inputSchema: {
      type: "object", properties: { ...t.properties, ...(asks(confirm, t) ? { confirmed: CONFIRMED } : {}) },
      ...(t.required ? { required: t.required } : {}), additionalProperties: false,
    },
    annotations: { title: t.title, readOnlyHint: t.kind === "read", destructiveHint: t.kind === "machine" || t.alwaysConfirm === true, idempotentHint: t.kind === "read", openWorldHint: false },
  }));
}

/** At most `max` calls in any `windowMs`; only calls that ran count. */
export function rateLimit(max: number, windowMs: number, now: () => number = Date.now) {
  let times: number[] = [];
  return () => {
    const t = now();
    times = times.filter((x) => t - x < windowMs);
    if (times.length >= max) return false;
    times.push(t);
    return true;
  };
}

export type McpContext = {
  level: McpLevel; confirm?: McpConfirm; version: string; instructions: string;
  act: (action: string, body: ObjectData) => Promise<unknown>;
  /** The page's own words for a failure. */
  explain: (e: unknown) => string;
  /** Counts a change; false when there were too many in the last minute. */
  allowChange?: () => boolean;
  says: { notAllowed: string; tooMany: string; confirm: string };
};
/** The plugin's server: its name and title for `initialize`, and its tools. */
export type McpServer = { name: string; title: string; tools: McpTool[] };

const rpcError = (rid: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: rid ?? null, error: { code, message } });
const result = (rid: unknown, value: unknown) => ({ jsonrpc: "2.0", id: rid, result: value });
const toolText = (value: unknown, isError = false) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value ?? null) }],
  ...(isObject(value) && !isError ? { structuredContent: value } : {}),
  isError,
});

/** One JSON-RPC message in, its answer out (null for a notification, which gets none). */
export async function mcpMessage(message: unknown, server: McpServer, ctx: McpContext): Promise<ObjectData | null> {
  // Batches were only ever in 2025-03-26 and are gone since; refused, not answered "method not found".
  if (!isObject(message)) return rpcError(null, -32600, "Invalid Request");
  const m = message;
  const method = text(m.method);
  if (m.jsonrpc !== "2.0") return rpcError(m.id, -32600, "Invalid Request");
  // A client's answer or a notification (initialized, cancelled…): nothing to say back.
  if (!("id" in m) || m.id === null || !method) return null;
  // Params that aren't an object are the client's mistake, not the tablet's: say so instead of failing the request.
  if (m.params != null && !isObject(m.params)) return rpcError(m.id, -32602, "Invalid params");
  const params = optionalObject(m.params);
  const confirm = ctx.confirm ?? "changes";
  switch (method) {
    case "initialize": {
      const asked = text(params.protocolVersion);
      return result(m.id, {
        protocolVersion: MCP_PROTOCOLS.includes(asked) ? asked : MCP_PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, title: server.title, version: ctx.version },
        instructions: ctx.instructions,
      });
    }
    case "ping": return result(m.id, {});
    case "tools/list": return result(m.id, { tools: mcpToolList(server.tools, ctx.level, confirm) });
    case "tools/call": {
      const name = text(params.name);
      const tool = server.tools.find((t) => t.name === name);
      if (!tool) return rpcError(m.id, -32602, `Unknown tool: ${name}`);
      if (!allows(ctx.level, tool.level)) return result(m.id, toolText(ctx.says.notAllowed, true));
      if (params.arguments != null && !isObject(params.arguments)) return result(m.id, toolText("Arguments must be an object", true));
      const { confirmed, ...args } = optionalObject(params.arguments);
      const missing = (tool.required ?? []).filter((k) => !(k in args));
      if (missing.length) return result(m.id, toolText(`Missing: ${missing.join(", ")}`, true));
      const unknown = Object.keys(args).filter((k) => !(k in (tool.properties ?? {})));
      if (unknown.length) return result(m.id, toolText(`Unknown arguments: ${unknown.join(", ")}`, true));
      // Asked in the chat: the call is answered with what it would do, and runs when made again with confirmed.
      if (asks(confirm, tool) && confirmed !== true) {
        return result(m.id, toolText({ needs_confirmation: true, tool: tool.name, title: tool.title, arguments: args, says: ctx.says.confirm }));
      }
      if (tool.kind !== "read" && ctx.allowChange && !ctx.allowChange()) return result(m.id, toolText(ctx.says.tooMany, true));
      try {
        // Every step changes what it names on its own (and again the same way when retried), so they run in order.
        let answer: unknown;
        for (const { action, body } of [tool.call(args)].flat()) {
          const one = await ctx.act(action, { ...(typeof body === "function" ? body(isObject(answer) ? answer : {}) : body), action });
          answer = isObject(answer) && isObject(one) ? { ...answer, ...one } : one;
        }
        return result(m.id, toolText(tool.shape ? tool.shape(answer, args) : answer));
      } catch (e) {
        return result(m.id, toolText(ctx.explain(e), true));
      }
    }
    default: return rpcError(m.id, -32601, `Method not found: ${method}`);
  }
}
