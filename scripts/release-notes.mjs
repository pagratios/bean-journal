#!/usr/bin/env node
// Builds the GitHub release notes: "What's new" from the version's section in CHANGELOG.md, how to install it, then
// every change merged to main since the previous release, each linked to its commit. Merge commits and bare
// "Release X.Y.Z" version commits are left out, and only contributors other than the repository owner are credited.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ASSET = "bean-journal.reaplugin.zip";

// The lines under "## X.Y.Z" (or "## vX.Y.Z", with anything after the version) up to the next "## ".
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r\n?/g, "\n").split("\n");
  const escaped = version.replace(/\./g, "\\.");
  const heading = new RegExp(`^##[ \\t]+v?${escaped}(?![\\w.-])`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) throw new Error(`CHANGELOG.md has no "## ${version}" section.`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##?[ \t]/.test(line));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
  if (!body) throw new Error(`The "## ${version}" section of CHANGELOG.md is empty.`);
  return body;
}

export function whatsNewSection(changelog, version) {
  return `## What's new\n\n${changelogSection(changelog, version)}\n`;
}

// Decaid installs and updates a plugin from a GitHub release whose tag is its vX.Y.Z, by the asset's exact name.
export function installSection(repo = "") {
  const lines = [
    `- Kept up to date by Decaid: Plugins → \`+\` → GitHub Release${repo ? `, repository \`${repo}\`` : ""}, ` +
      `asset \`${ASSET}\`.`,
    `- Or download \`${ASSET}\` below: Decaid → Plugins → \`+\` → ZIP file.`,
  ];
  return `## Install\n\n${lines.join("\n")}\n`;
}

// Tab-separated "sha, author login, parent count, subject" lines, oldest first, as written by the release workflow
// from GitHub's compare API.
export function parseCommits(text) {
  return text.split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter(([sha]) => /^[0-9a-f]{7,40}$/i.test(sha ?? ""))
    .map(([sha, login = "", parents = "1", ...subject]) =>
      ({ sha, login, parents: Number(parents) || 0, subject: subject.join("\t") }));
}

export function changesSection(commits, { repo = "", previousTag = "", tag = "" } = {}) {
  const owner = repo.split("/")[0].toLowerCase();
  const changes = commits
    .filter(({ parents }) => parents <= 1)
    .map((commit) => ({ ...commit, subject: commit.subject.trim().replace(/\s+\(#\d+\)$/, "") }))
    .filter(({ subject }) => subject && !/^Release \d+\.\d+\.\d+$/.test(subject))
    .map(({ sha, login, subject }) => {
      const short = sha.slice(0, 7);
      const link = repo ? `[${short}](https://github.com/${repo}/commit/${sha})` : short;
      const credit = login && login.toLowerCase() !== owner ? ` by @${login}` : "";
      return `* ${subject}${credit} (${link})`;
    });
  const compare = repo && previousTag && tag
    ? `**Full Changelog**: https://github.com/${repo}/compare/${previousTag}...${tag}\n`
    : "";
  if (!changes.length) return compare;
  return `## What's Changed\n\n${changes.join("\n")}\n` + (compare ? `\n${compare}` : "");
}

export function releaseNotes(changelog, version, commits = [], options = {}) {
  return [whatsNewSection(changelog, version), installSection(options.repo), changesSection(commits, options)]
    .filter(Boolean).join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [file, version, commitsFile, repo, previousTag, tag] = process.argv.slice(2);
  try {
    if (!file || !version) {
      throw new Error("Usage: node scripts/release-notes.mjs <CHANGELOG.md> <version> " +
        "[commits file] [owner/repo] [previous tag] [tag]");
    }
    const commits = commitsFile ? parseCommits(await readFile(commitsFile, "utf8")) : [];
    process.stdout.write(releaseNotes(await readFile(file, "utf8"), version, commits, { repo, previousTag, tag }));
  } catch (error) {
    console.error(`Release notes failed: ${error.message}`);
    process.exitCode = 1;
  }
}
