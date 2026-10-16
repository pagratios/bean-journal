import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The only place the version changes; main is never pushed to directly.
//   node scripts/release.mjs <patch|minor|major|X.Y.Z>
//     From an up-to-date origin/main whose CHANGELOG.md has a "## X.Y.Z" section for the new version (written by the
//     features as they landed, or now, uncommitted): sets the version on branch release/X.Y.Z, pushes it and opens
//     the release pull request.
//   node scripts/release.mjs tag
//     After that pull request is merged: tags the merge vX.Y.Z and pushes the tag, which starts the release workflow
//     (.github/workflows/release.yml). The first release has no release pull request: it tags main as it is.

export const CHANGELOG = "CHANGELOG.md";
export const RELEASE_BRANCH_PREFIX = "release/";
export const PLUGIN_FILE = "src/plugin.ts";
/** npm's copies of the version, kept equal to the plugin's (a test checks package.json). */
export const PACKAGE_FILES = ["package.json", "package-lock.json"];
const PLUGIN_LINE = /^export const VERSION = "(\d+)\.(\d+)\.(\d+)";/m;
const USAGE = "Usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> | tag";

export function parsePluginVersion(source) {
  const match = PLUGIN_LINE.exec(source);
  if (!match) throw new Error(`${PLUGIN_FILE} needs an 'export const VERSION = "X.Y.Z";' line.`);
  const [major, minor, patch] = match.slice(1).map(Number);
  return { major, minor, patch, name: `${major}.${minor}.${patch}` };
}

export function pluginVersionLine(version) {
  return `export const VERSION = "${version.name}";`;
}

export function setPluginVersion(source, version) {
  parsePluginVersion(source);
  return source.replace(PLUGIN_LINE, pluginVersionLine(version));
}

/** package.json or package-lock.json (its root package too) at `version`, as npm writes them. */
export function setPackageVersion(json, version) {
  const data = JSON.parse(json);
  data.version = version.name;
  if (data.packages?.[""]) data.packages[""].version = version.name;
  return `${JSON.stringify(data, null, 2)}${/\n$/.test(json) ? "\n" : ""}`;
}

export function compareNames(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function nextVersion(current, bump) {
  let [major, minor, patch] = [current.major, current.minor, current.patch];
  if (bump === "major") [major, minor, patch] = [major + 1, 0, 0];
  else if (bump === "minor") [minor, patch] = [minor + 1, 0];
  else if (bump === "patch") patch += 1;
  else {
    const explicit = /^(\d+)\.(\d+)\.(\d+)$/.exec(bump ?? "");
    if (!explicit) throw new Error(USAGE);
    [major, minor, patch] = explicit.slice(1).map(Number);
    if (compareNames({ major, minor, patch }, current) <= 0) {
      throw new Error(`${bump} is not newer than ${current.name}.`);
    }
  }
  return { major, minor, patch, name: `${major}.${minor}.${patch}` };
}

// Only the release notes may be edited before preparing a release.
export function checkWorkingTree(changedPaths) {
  const unexpected = changedPaths.filter((path) => path !== CHANGELOG);
  if (unexpected.length) {
    throw new Error(`Commit or discard these changes first: ${unexpected.join(", ")}`);
  }
}

export function hasChangelogSection(changelog, name) {
  const escaped = name.replace(/\./g, "\\.");
  return new RegExp(`^##[ \\t]+v?${escaped}(?![\\w.-])`, "m").test(changelog);
}

// CI: pull requests keep the version, except release/X.Y.Z, which must raise it to exactly X.Y.Z.
export function checkVersionChange(base, head, headRef) {
  const from = parsePluginVersion(base), to = parsePluginVersion(head);
  if (from.name === to.name) return;
  if (!headRef.startsWith(RELEASE_BRANCH_PREFIX)) {
    throw new Error(`Do not change the version in a pull request (${from.name} -> ${to.name}); ` +
      "releases change it with scripts/release.mjs.");
  }
  const expected = headRef.slice(RELEASE_BRANCH_PREFIX.length);
  if (to.name !== expected) throw new Error(`Release branch ${headRef} must set version ${expected}, not ${to.name}.`);
  if (compareNames(to, from) <= 0) throw new Error(`Release ${to.name} must be newer than ${from.name}.`);
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function changedPaths(root) {
  const status = execFileSync("git", ["status", "--porcelain", "-z"], { cwd: root, encoding: "utf8" });
  return status.split("\0").filter(Boolean).map((entry) => entry.slice(3));
}

function ghPullRequest(root, { branch, title, body }) {
  return execFileSync("gh", ["pr", "create", "--base", "main", "--head", branch,
    "--title", title, "--body", body], { cwd: root, encoding: "utf8" }).trim();
}

export async function prepare(root, bump, { log = console.log, openPullRequest = ghPullRequest } = {}) {
  git(root, "fetch", "--quiet", "--tags", "origin", "main");
  const main = git(root, "rev-parse", "origin/main");
  if (git(root, "rev-parse", "HEAD") !== main) {
    throw new Error("Prepare a release from an up-to-date origin/main: HEAD must equal origin/main.");
  }
  const changed = changedPaths(root);
  checkWorkingTree(changed);
  const pluginPath = resolve(root, PLUGIN_FILE);
  const pluginSource = await readFile(pluginPath, "utf8");
  const version = nextVersion(parsePluginVersion(pluginSource), bump);
  const tag = `v${version.name}`;
  const branch = `${RELEASE_BRANCH_PREFIX}${version.name}`;
  if (git(root, "tag", "--list", tag)) throw new Error(`Tag ${tag} already exists.`);
  if (git(root, "ls-remote", "--heads", "origin", branch)) {
    throw new Error(`Branch ${branch} already exists on origin.`);
  }
  const changelog = await readFile(resolve(root, CHANGELOG), "utf8").catch(() => "");
  if (!hasChangelogSection(changelog, version.name)) {
    throw new Error(`${CHANGELOG} needs a "## ${version.name}" section first ` +
      "(the GitHub release shows it as What's new).");
  }

  const startBranch = git(root, "branch", "--show-current");
  git(root, "switch", "--quiet", "-c", branch);
  await writeFile(pluginPath, setPluginVersion(pluginSource, version));
  for (const file of PACKAGE_FILES) {
    const path = resolve(root, file);
    await writeFile(path, setPackageVersion(await readFile(path, "utf8"), version));
  }
  git(root, "add", "--", PLUGIN_FILE, ...PACKAGE_FILES, ...changed);
  git(root, "commit", "--quiet", "-m", `Release ${version.name}`);
  git(root, "push", "--quiet", "-u", "origin", branch);
  // Return to the starting point; an uncommitted section now lives on the release branch.
  git(root, "switch", "--quiet", ...(startBranch ? [startBranch] : ["--detach", main]));
  const body = `Sets Bean Journal to \`${version.name}\`, with its ${CHANGELOG} notes.\n\n` +
    `After merging, run \`node scripts/release.mjs tag\` to tag \`${tag}\` and start the release workflow.`;
  try {
    log(`Opened ${openPullRequest(root, { branch, title: `Release ${version.name}`, body })}`);
  } catch {
    log(`Pushed ${branch}; open its pull request on GitHub (gh pr create failed).`);
  }
  log("After it is merged, run: node scripts/release.mjs tag");
  return { version };
}

export async function tagRelease(root, { log = console.log } = {}) {
  git(root, "fetch", "--quiet", "--tags", "origin", "main");
  const version = parsePluginVersion(git(root, "show", `origin/main:${PLUGIN_FILE}`));
  const tag = `v${version.name}`;
  if (git(root, "tag", "--list", tag)) throw new Error(`${tag} is already tagged; nothing to release.`);
  if (!hasChangelogSection(git(root, "show", `origin/main:${CHANGELOG}`), version.name)) {
    throw new Error(`${CHANGELOG} on origin/main has no "## ${version.name}" section.`);
  }
  // Tag the commit that set this version, not later merges. The first release never had one: main as it is.
  const first = !git(root, "tag", "--list", "v[0-9]*");
  const commit = first ? git(root, "rev-parse", "origin/main")
    : git(root, "log", "-1", "--format=%H", "-S", pluginVersionLine(version), "origin/main", "--", PLUGIN_FILE);
  if (!commit) throw new Error(`No commit on origin/main sets version ${version.name}.`);
  git(root, "tag", "-a", tag, commit, "-m", `Bean Journal ${version.name}`);
  git(root, "push", "--quiet", "origin", `refs/tags/${tag}`);
  log(`Tagged ${commit.slice(0, 7)} as ${tag} and pushed it; the release workflow builds it.`);
  return { tag, commit };
}

const script = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === script) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const [command] = process.argv.slice(2);
  try {
    if (command !== "tag" && !/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(command ?? "")) {
      throw new Error(USAGE);
    }
    if (command === "tag") await tagRelease(root);
    else await prepare(root, command);
  } catch (error) {
    console.error(`Release failed: ${error.message}`);
    process.exitCode = 1;
  }
}
