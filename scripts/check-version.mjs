import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkVersionChange, PLUGIN_FILE } from "./release.mjs";

// CI: node scripts/check-version.mjs <base git ref> <head branch>
// Compares the plugin version of the working tree with the one at the base ref.
const script = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === script) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const [baseRef, headRef] = process.argv.slice(2);
  try {
    if (!baseRef || headRef === undefined) {
      throw new Error("Usage: node scripts/check-version.mjs <base git ref> <head branch>");
    }
    const base = execFileSync("git", ["show", `${baseRef}:${PLUGIN_FILE}`], { cwd: root, encoding: "utf8" });
    checkVersionChange(base, await readFile(resolve(root, PLUGIN_FILE), "utf8"), headRef);
    console.log("Version check passed.");
  } catch (error) {
    console.log(`::error file=${PLUGIN_FILE}::${error.message}`);
    process.exitCode = 1;
  }
}
