# Instructions for changes to this repository

Bean Journal: a Decaid plugin (`bean-journal.reaplugin`) for the stock Streamline skin. Coffees, shots and dial-in
on the Decent's tablet with no account or cloud: everything lives in Decaid (beans, bean batches, grinders, shots,
its key-value store). Build, test, install and preview steps are in `README.md`; follow them, don't repeat them here.

## Layout

- `src/plugin.ts`: the plugin core (`createPlugin`, events, `handle()` endpoints, the page's `control` actions).
  `PLUGIN_ID` and `VERSION` live here (`package.json`'s `version` follows it).
- `src/core/`: the shared core other plugins build on (`bean-journal/core`, see `README.md`): Decaid data and client,
  shot curves and steps, profiles, Streamline surfaces, the MCP server, `theme.css` (Streamline's tokens). It names no
  product and imports only itself (a test checks); a plugin passes its id, extras key, texts and tools.
- `src/protocol.ts`, `src/coffees.ts`, `src/skin.ts`: Bean Journal's own pure helpers on top of the core (its
  `extras.beanJournal`, notes block and shot summary; coffees from beans and batches; its Streamline button). Unit-test
  them.
- `src/mcp.ts`: Bean Journal's MCP tools; every tool runs one or more of the page's own `control` actions.
- `src/ui.ts`: the whole page (one serialized client function, its CSS and markup); `src/i18n.ts`: every user-facing
  string, in English (the only language).
- `scripts/build.mjs`: the manifest (settings labels come from i18n `settings`) and the ZIP.
- `scripts/release.mjs`, `scripts/release-notes.mjs`, `scripts/check-version.mjs`: releases (see `README.md`) and
  CI's version check; `.github/workflows/release.yml` builds a `v*` tag into a GitHub release.
- `src/*.test.ts`: vitest with a fake Decaid; one test runs the built bundle without a `URL` class, as Decaid does.
- `tools/preview-server.mjs`: fake Decaid (8080) and a Streamline checkout (3000, `SKIN=<folder>`).

## Rules

- **Don't change `VERSION`** (nor `package.json`'s `version`) in feature work: CI refuses it outside a
  `release/X.Y.Z` pull request from `scripts/release.mjs`. Add what changed to the coming `## X.Y.Z` section of
  `CHANGELOG.md`; it becomes the release's "What's new".
- **Never delete the user's data** (Decaid beans, batches, grinders, profiles, shots) without asking first. The
  plugin never deletes beans, batches or grinders; a shot only with an explicit confirmation.
- **Data stays in Decaid, readable by other apps:** coffees as beans + batches, the shot's rating and notes in
  Decaid's own annotation fields, only what Decaid has no field for under `extras.beanJournal`. `PUT /beans/{id}`
  replaces `extras`: merge with what is there (other apps keep their keys).
- Every change: `npm run typecheck; npm test; npm run build`. Add or update tests for plugin behaviour. Check UI
  changes in the preview at tablet size (below).
- Comments explain why, in plain words; no comments that restate the code.

## Repository and Git

- **`main` changes only through a pull request, and only the owner (@pagratios) merges.** Work on your own branch,
  push it, open a PR and stop there. Never push, force-push or commit directly to `main`.
- Don't merge, approve, enable auto-merge, close others' PRs, tag, publish a release, dispatch a workflow, rewrite
  published history, add collaborators, deploy keys or secrets, or change repository settings unless the owner asks
  for that specific action.
- A ruleset on GitHub requires a pull request for `main`, and the `.githooks/pre-push` hook (see `README.md`) refuses
  direct pushes from a clone. Don't bypass either (`--no-verify`) or remove them.
- The repository is public: nothing private goes in (keys, tokens, home network addresses, other private
  repositories' names or code).
- Workflows keep least privilege (`permissions: contents: read` unless a job needs more) and use only GitHub-owned
  actions (the repository allows no others).
- This file is the one source of the rules: `CLAUDE.md` and `.github/copilot-instructions.md` only point here. Update
  a rule here when it changes and remove stale ones; don't copy rules into the pointers.

## Product decisions (keep unless the owner asks otherwise)

- **No scrolling on the tablet.** The owner's tablet is a Samsung Galaxy Tab A11 (1340×800, full screen). Every view
  must fit 1280×800 and 1340×800 without page scrolling; lists and columns scroll inside themselves. Button sizes:
  toggles `2.267rem`, ± steps `1.733×2.4rem`, R2 `1.867rem`; don't enlarge them. The score is a slider in steps of
  5 with ticks and no preset chips. Taste and body share one line as joined buttons.
- Streamline's header button opens the Shot page full screen over the dashboard (overlay `size: "full"`, Streamline
  0.2.15 or newer; the coffee picker when no coffee is chosen). The gear card stays a small overlay. Settings → "When
  I choose a coffee" keeps the settings or loads the coffee's last/best shot.
- The next shot's grinder, RPM and water are chosen only from Streamline's line under Grind (the page's top bar has
  just the coffee). Grinders (put away = archived) and the waters list are kept in Settings.
- Finished bags: listed last and greyed; the picker and the Coffees list show them with the "Finished" switch.
- Bean photos are the plugin's own (taken or chosen on the tablet, in Decaid's store); Streamline's header shows
  no image.
- Taste, body and water are Bean Journal's own (`extras.beanJournal`); other plugins' values are not read.
- Dropdowns are the page's own (`enhanceSelect` in `ui.ts`); use plain `<select>` elements in code.
- The plugin and page are English only; they follow the skin's theme (`?theme=light|dark`, else Streamline's
  `streamlineSettings/theme`).

## Sibling repository: Beanbox

Bean Journal grew out of the owner's Beanbox plugin (a private repository, its `plugin/` folder) and
the two share most of their tablet code. **A change in one that isn't specific to it belongs in both:**

- Shared: Decaid quirks and API use, Streamline surfaces and the overlay protocol, keep ratio, gear keeping,
  brew-temperature write-back, shot reading and editing, the chart, steppers, dropdowns and other page parts, the
  theme, the R2 refractometer, profiles, the MCP machinery, the build, tests' fake Decaid, the preview server.
- Not shared: Bean Journal's coffees in Decaid (beans, batches, photos, waters as text); Beanbox's cloud (account,
  uploads, bags, recipes, suggestions, machines) and its skin fork.
- When a change is shared, make the matching change in the other repository too (its own branch and pull request),
  or, if that isn't possible now, say so in the pull request with what still has to be ported. Name the other
  repository's commit or pull request in each.
- Shared code moves into `src/core/` here, so that Beanbox can depend on `bean-journal/core` instead of keeping a copy.
  Put a shared change there when it fits (product-neutral: ids, extras keys, texts and tools are parameters). Code
  Beanbox already takes from the core needs no port, only a bump of its pinned version.
- Beanbox is private and a client of an unpublished service: never bring its cloud code, URLs, keys or branding
  into this public repository. The dependency runs one way: Beanbox imports Bean Journal, never the reverse.

## Decaid facts

- Plugins have **no `URL` class**; parse by hand. The page (browser) may use it.
- `PUT /shots/{id}` deep-merges and fires `shotUpdated`; profile `DELETE` is soft; `PUT /workflow` merges what it is
  sent (a key goes only when set to null). `workflowUpdated`'s payload isn't guaranteed: read `/workflow` when it
  matters.
- `POST /beans/{id}/batches` ignores `weightRemaining` and `archived`: a `PUT` follows. `GET /beans` and
  `/bean-batches` leave finished ones out without `?includeArchived=true`. Decaid lowers a batch's
  `weightRemaining` by each shot's dose itself.
- Streamline (with DYE2 on) clears the coffee, grinder and RPM after each shot; the plugin keeps the next shot's
  gear in `context.extras.beanJournal.gear` and writes it back. RPM is `context.extras.rpm`, Streamline's key.
- Streamline reads `skin` with a 2 s timeout: answer from the last answer when a fresh one takes over 1 s, then push.
  Only one `header-button` is drawn across plugins (first wins).

## Working locally

- Preview: `npm run build`, then `node tools/preview-server.mjs` (restart it after each build). With
  `SKIN=<stock Streamline checkout>` the skin is on http://localhost:3000/; the page alone is
  http://localhost:8080/api/v1/plugins/bean-journal.reaplugin/ui?view=shot&embed=1. Check at 1340×800 and 1280×800
  that `document.scrollingElement.scrollHeight === innerHeight`.
- The owner's tablet runs Decaid on their home network (its address is in the owner's own instructions, not in this
  public repository). Read from it freely; change data on it only when asked.
- Talk to the owner in the language they write in (often Greek); keep code, commits and docs in English.
