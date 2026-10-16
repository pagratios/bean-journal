import { describe, expect, it } from "vitest";
import { changelogSection, changesSection, installSection, parseCommits, releaseNotes } from "./release-notes.mjs";

const changelog = [
  "# Changelog",
  "",
  "## 0.2.0 — 2026-10-20",
  "",
  "- Coffees from photos.",
  "",
  "### Streamline",
  "- The header shows the roaster.",
  "",
  "## 0.1.0",
  "",
  "- First version.",
  "",
].join("\r\n");

describe("release notes", () => {
  it("take What's new from the version's CHANGELOG section", () => {
    expect(changelogSection(changelog, "0.2.0")).toBe("- Coffees from photos.\n\n### Streamline\n- The header shows the roaster.");
    expect(changelogSection(changelog, "0.1.0")).toBe("- First version.");
    expect(() => changelogSection(changelog, "0.0.9")).toThrow(/no "## 0.0.9" section/);
    expect(() => changelogSection("## 0.3.0\n\n## 0.2.0\n- x\n", "0.3.0")).toThrow(/empty/);
    expect(() => changelogSection(changelog, "0.2")).toThrow(/no "## 0.2" section/);
  });

  it("say how Decaid installs and updates it", () => {
    expect(installSection("pagratios/bean-journal")).toMatch(
      /^## Install\n\n- Kept up to date by Decaid: Plugins → `\+` → GitHub Release, repository `pagratios\/bean-journal`, asset `bean-journal\.reaplugin\.zip`\.\n- Or download/);
  });

  it("list each commit on main and credit only other contributors", () => {
    const sha = (c) => c.repeat(40);
    const commits = parseCommits([
      `${sha("a")}\tpagratios\t1\tCoffees from photos (#13)`,
      `${sha("b")}\thelper\t1\tFix units (#18)`,
      `${sha("c")}\tPaGratios\t2\tMerge origin/main into a branch`,
      `${sha("d")}\t\t1\tTweak\twith a tab`,
      `${sha("e")}\tpagratios\t1\tRelease 0.2.0 (#17)`,
      "",
      "not-a-sha\tx\t1\tIgnored",
    ].join("\r\n"));
    expect(commits.length).toBe(5);
    expect(commits[3]).toEqual({ sha: sha("d"), login: "", parents: 1, subject: "Tweak\twith a tab" });

    const repo = "pagratios/bean-journal";
    const link = (c) => `[${c.repeat(7)}](https://github.com/${repo}/commit/${sha(c)})`;
    const options = { repo, previousTag: "v0.1.0", tag: "v0.2.0" };
    const notes = releaseNotes(changelog, "0.2.0", commits, options);
    expect(notes.startsWith("## What's new\n\n- Coffees from photos.\n")).toBe(true);
    expect(notes).toContain("\n\n## Install\n\n- Kept up to date by Decaid");
    expect(notes.endsWith([
      "## What's Changed",
      "",
      `* Coffees from photos (${link("a")})`,
      `* Fix units by @helper (${link("b")})`,
      `* Tweak\twith a tab (${link("d")})`,
      "",
      `**Full Changelog**: https://github.com/${repo}/compare/v0.1.0...v0.2.0`,
      "",
    ].join("\n"))).toBe(true);

    expect(changesSection(commits.slice(1, 2))).toBe("## What's Changed\n\n* Fix units by @helper (bbbbbbb)\n");
    expect(changesSection([], options)).toBe(`**Full Changelog**: https://github.com/${repo}/compare/v0.1.0...v0.2.0\n`);
    expect(changesSection([])).toBe("");
  });
});
