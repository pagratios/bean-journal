import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkVersionChange, checkWorkingTree, hasChangelogSection, nextVersion, parsePluginVersion, prepare,
  setPackageVersion, setPluginVersion, tagRelease,
} from "./release.mjs";

const plugin = (name) => `export const PLUGIN_ID = "bean-journal.reaplugin";\nexport const VERSION = "${name}";\n`;
const pkg = (name) => `${JSON.stringify({ name: "bean-journal", version: name, private: true }, null, 2)}\n`;
const lock = (name) => `${JSON.stringify({ name: "bean-journal", version: name, lockfileVersion: 3, requires: true,
  packages: { "": { name: "bean-journal", version: name }, "node_modules/x": { version: "1.0.0" } } }, null, 2)}\n`;

describe("release versions", () => {
  it("bumps the plugin version", () => {
    const current = parsePluginVersion(plugin("0.4.4"));
    expect(current).toEqual({ major: 0, minor: 4, patch: 4, name: "0.4.4" });
    expect(nextVersion(current, "patch").name).toBe("0.4.5");
    expect(nextVersion(current, "minor").name).toBe("0.5.0");
    expect(nextVersion(current, "major").name).toBe("1.0.0");
    expect(nextVersion(current, "0.6.2").name).toBe("0.6.2");
    for (const bump of ["0.4.4", "0.4.3", "v0.5.0", "next", "tags", undefined]) expect(() => nextVersion(current, bump)).toThrow();
    expect(setPluginVersion(plugin("0.4.4"), nextVersion(current, "minor"))).toBe(plugin("0.5.0"));
    expect(() => parsePluginVersion("export const VERSION = '0.4.4';\n")).toThrow();
  });

  it("sets npm's copies, the lock's root package too, and leaves the rest as npm wrote it", async () => {
    const v = nextVersion(parsePluginVersion(plugin("0.4.4")), "patch");
    expect(setPackageVersion(pkg("0.4.4"), v)).toBe(pkg("0.4.5"));
    expect(setPackageVersion(lock("0.4.4"), v)).toBe(lock("0.4.5"));
    const own = parsePluginVersion(await readFile(resolve("src", "plugin.ts"), "utf8"));
    for (const file of ["package.json", "package-lock.json"]) {
      const text = (await readFile(resolve(file), "utf8")).replace(/\r\n/g, "\n");
      expect(setPackageVersion(text, own), file).toBe(text);
    }
  });

  it("lets only the changelog be edited before a release", () => {
    checkWorkingTree([]);
    checkWorkingTree(["CHANGELOG.md"]);
    expect(() => checkWorkingTree(["CHANGELOG.md", "src/ui.ts"])).toThrow(/src\/ui.ts/);
  });

  it("needs a changelog section for exactly the new version", () => {
    expect(hasChangelogSection("# Changes\n\n## 0.5.0\n\n- New\n", "0.5.0")).toBe(true);
    expect(hasChangelogSection("## v0.5.0 — 2026-10-09\r\n- New\r\n", "0.5.0")).toBe(true);
    for (const other of ["## 0.5.0.1\n", "## 0.5.01\n", "### 0.5.0\n", "## 0x5y0\n"]) expect(hasChangelogSection(other, "0.5.0")).toBe(false);
  });

  it("keeps the version in pull requests unless they are its release branch", () => {
    checkVersionChange(plugin("0.4.4"), plugin("0.4.4"), "my-feature");
    checkVersionChange(plugin("0.4.4"), plugin("0.4.4"), "release/0.5.0");
    checkVersionChange(plugin("0.4.4"), plugin("0.5.0"), "release/0.5.0");
    expect(() => checkVersionChange(plugin("0.4.4"), plugin("0.5.0"), "my-feature")).toThrow(/Do not change the version.*0\.4\.4 -> 0\.5\.0/);
    expect(() => checkVersionChange(plugin("0.4.4"), plugin("0.5.0"), "release/0.6.0")).toThrow(/must set version 0.6.0/);
    expect(() => checkVersionChange(plugin("0.4.4"), plugin("0.4.3"), "release/0.4.3")).toThrow(/must be newer/);
  });
});

const gitEnv = {
  GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_COUNT: "4",
  GIT_CONFIG_KEY_0: "commit.gpgsign", GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_KEY_1: "tag.gpgsign", GIT_CONFIG_VALUE_1: "false",
  GIT_CONFIG_KEY_2: "core.autocrlf", GIT_CONFIG_VALUE_2: "false",
  // The test repositories have no hooks; a global hooksPath would run this repository's own.
  GIT_CONFIG_KEY_3: "core.hooksPath", GIT_CONFIG_VALUE_3: "no-hooks",
};
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...gitEnv } }).trim();
async function writeTree(dir, files) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), text);
  }
}

describe("a release from start to tag", () => {
  const saved = Object.fromEntries(Object.keys(gitEnv).map((key) => [key, process.env[key]]));
  let base = "";
  beforeAll(async () => {
    Object.assign(process.env, gitEnv);
    base = await mkdtemp(join(tmpdir(), "bean-journal-release-test-"));
  });
  afterAll(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(base, { recursive: true, force: true });
  });

  it("tags main for the first release, then opens release branches and tags their merges", async () => {
    const origin = join(base, "origin.git"), repo = join(base, "repo"), owner = join(base, "owner");
    git(base, "init", "--quiet", "--bare", "-b", "main", origin);
    git(base, "clone", "--quiet", origin, repo);
    git(repo, "switch", "--quiet", "-c", "main");
    await writeTree(repo, {
      "src/plugin.ts": plugin("0.1.0"), "package.json": pkg("0.1.0"), "package-lock.json": lock("0.1.0"),
      "CHANGELOG.md": "# Changelog\n",
    });
    git(repo, "add", ".");
    git(repo, "commit", "--quiet", "-m", "Initial");
    git(repo, "push", "--quiet", "-u", "origin", "main");
    git(base, "clone", "--quiet", origin, owner);
    const quiet = { log: () => {}, openPullRequest: () => "https://example.invalid/pull/1" };
    // The owner lands a change on main (a feature with its notes, or a squash-merged release pull request).
    const land = async (title, files, branch) => {
      git(owner, "fetch", "--quiet", "origin");
      git(owner, "reset", "--quiet", "--hard", "origin/main");
      if (branch) git(owner, "merge", "--quiet", "--squash", `origin/${branch}`);
      await writeTree(owner, files);
      git(owner, "add", ".");
      git(owner, "commit", "--quiet", "-m", title);
      git(owner, "push", "--quiet", "origin", "main");
      git(repo, "pull", "--quiet", "--ff-only");
      return git(owner, "rev-parse", "HEAD");
    };

    // The first release: 0.1.0 was never tagged and needs its notes on main; then main is tagged as it is.
    await expect(tagRelease(repo, quiet)).rejects.toThrow(/no "## 0\.1\.0" section/);
    const first = await land("Notes", { "CHANGELOG.md": "# Changelog\n\n## 0.1.0\n\n- First\n" });
    expect(await tagRelease(repo, quiet)).toEqual({ tag: "v0.1.0", commit: first });
    expect(git(origin, "rev-parse", "v0.1.0^{commit}")).toBe(first);
    await expect(tagRelease(repo, quiet)).rejects.toThrow(/already tagged/);

    // The features wrote the coming section on main; nothing else may be changed here.
    await land("A feature (#2)", { "src/ui.ts": "// feature\n", "CHANGELOG.md": "# Changelog\n\n## 0.1.1\n\n- Faster\n\n## 0.1.0\n\n- First\n" });
    await writeFile(join(repo, "src/other.ts"), "// unrelated\n");
    await expect(prepare(repo, "patch", quiet)).rejects.toThrow(/src\/other.ts/);
    await rm(join(repo, "src/other.ts"));
    await expect(prepare(repo, "minor", quiet)).rejects.toThrow(/## 0\.2\.0/);
    let opened;
    const patch = await prepare(repo, "patch", { ...quiet, openPullRequest: (_, pr) => (opened = pr, "url") });
    expect(patch.version.name).toBe("0.1.1");
    expect(opened).toMatchObject({ branch: "release/0.1.1", title: "Release 0.1.1" });
    expect(opened.body).toMatch(/node scripts\/release.mjs tag/);
    expect(git(repo, "branch", "--show-current")).toBe("main");
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(git(repo, "show", "origin/release/0.1.1:src/plugin.ts")).toBe(plugin("0.1.1").trim());
    expect(git(repo, "show", "origin/release/0.1.1:package.json")).toBe(pkg("0.1.1").trim());
    expect(git(repo, "show", "origin/release/0.1.1:package-lock.json")).toBe(lock("0.1.1").trim());
    expect(await readFile(join(repo, "src/plugin.ts"), "utf8")).toBe(plugin("0.1.0"));

    // Squash-merged, then another change lands before the tag: the tag goes on the release.
    const released = await land("Release 0.1.1 (#3)", {}, "release/0.1.1");
    await land("Later (#4)", { "src/later.ts": "// later\n" });
    expect(await tagRelease(repo, quiet)).toEqual({ tag: "v0.1.1", commit: released });

    // Notes written now, uncommitted, go with the release branch.
    await writeTree(repo, { "CHANGELOG.md": "# Changelog\n\n## 0.2.0\n\n- New\n" });
    expect((await prepare(repo, "minor", quiet)).version.name).toBe("0.2.0");
    expect(git(repo, "show", "origin/release/0.2.0:CHANGELOG.md")).toMatch(/## 0\.2\.0/);
    expect(git(repo, "status", "--porcelain")).toBe("");
  }, 120000);
});
