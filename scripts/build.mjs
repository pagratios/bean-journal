// Builds bean-journal.reaplugin: bundles src/plugin.ts with the texts and theme, writes
// build/bean-journal.reaplugin/{manifest.json,plugin.js} and build/bean-journal.reaplugin-<version>.zip, the ZIP that
// Decaid's Plugins → + → ZIP file installs.
import { build } from "esbuild";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { zipSync, strToU8 } from "fflate";

const texts = await build({
  entryPoints: [resolve("src", "i18n.ts")], bundle: true, write: false, format: "iife", globalName: "Texts",
});
const textContext = {};
runInNewContext(texts.outputFiles[0].text, textContext);
const copy = textContext.Texts.texts;
const theme = await readFile(resolve("src", "core", "theme.css"), "utf8");
const compiled = await build({
  entryPoints: [resolve("src", "plugin.ts")],
  bundle: true, write: false, format: "iife", globalName: "BeanJournal", target: "es2020",
  define: { __DECAID_COPY__: JSON.stringify(copy), __DECAID_THEME__: JSON.stringify(theme) },
  footer: { js: "function createPlugin(host) { return BeanJournal.createPlugin(host); }" },
});
const javascript = compiled.outputFiles[0].text;
const sandbox = {};
runInNewContext(javascript, sandbox);
const { PLUGIN_ID: id, VERSION: version } = sandbox.BeanJournal;
const fields = {
  OnCoffeeChoice: { type: "enum", values: ["keep", "last", "best"], default: "keep" },
  VisualizerNotes: { type: "boolean", default: false },
  McpAccess: { type: "enum", values: ["off", "read", "shots", "full"], default: "off" },
  McpToken: { type: "string", secure: true },
  McpConfirm: { type: "enum", values: ["none", "changes", "all"], default: "changes" },
  McpPublicAccess: { type: "enum", values: ["off", "read", "shots", "full"], default: "off" },
  McpPublicToken: { type: "string", secure: true },
  McpPublicUrl: { type: "string" },
};
const manifest = {
  id, version, author: "pagratios", name: "Bean Journal",
  description: copy.intro, apiVersion: 1,
  // events.workflow: Keep ratio and the next shot's gear follow the skin's changes; events.shots: a new shot.
  permissions: ["log", "api", "emit", "pluginStorage", "events.shots", "events.workflow"],
  settings: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, {
    ...value, label: copy.settings[key][0], description: copy.settings[key][1],
  }])),
  api: [
    // skin and ratio: Streamline's plugin surfaces (what the dashboard shows, and its Ratio and Keep ratio).
    ...["ui", "control", "mcp", "skin", "ratio"].map((id) => ({ id, type: "http", data: {} })),
    // The skin repaints (and reads `skin` again) when the plugin changed the next shot's workflow.
    { id: "changed", type: "websocket", data: { what: { type: "string", description: "What changed: workflow, or skin (only the surfaces)" } } },
  ],
};
const json = JSON.stringify(manifest, null, 2) + "\n";
const destination = resolve("build", id);
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, "manifest.json"), json);
await writeFile(resolve(destination, "plugin.js"), javascript);
// A fixed date keeps the ZIP the same from one build to the next.
const stamp = new Date("2026-10-16T00:00:00Z");
const archive = zipSync({
  [`${id}/manifest.json`]: [strToU8(json), { mtime: stamp }],
  [`${id}/plugin.js`]: [strToU8(javascript), { mtime: stamp }],
}, { level: 9 });
// The version in the file name tells builds apart; Decaid reads the version from the manifest inside.
await writeFile(resolve("build", `${id}-${version}.zip`), archive);
console.log(`Built ${id} ${version}: ${javascript.length} characters, ${archive.length} bytes ZIP`);
