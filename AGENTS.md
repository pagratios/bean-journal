# Instructions for changes to this repository

Bean Journal: a Decaid plugin (`bean-journal.reaplugin`) for the stock Streamline skin. Coffees, shots and dial-in
on the Decent's tablet with no account or cloud: everything lives in Decaid (beans, bean batches, grinders, shots,
its key-value store). Build, test, install and preview steps are in `README.md`; follow them, don't repeat them here.

## Layout

- `src/plugin.ts`: the plugin core (`createPlugin`, events, `handle()` endpoints, the page's `control` actions).
  `PLUGIN_ID` and `VERSION` live here.
- `src/protocol.ts`, `src/coffees.ts`, `src/skin.ts`: pure helpers (shots, coffees from beans and batches, the
  Streamline surfaces). Unit-test them.
- `src/mcp.ts`: the MCP server; every tool runs one or more of the page's own `control` actions.
- `src/ui.ts`: the whole page (one serialized client function, its CSS and markup); `src/theme.css`: Streamline's
  tokens; `src/i18n.ts`: every user-facing string, in English (the only language).
- `scripts/build.mjs`: the manifest (settings labels come from i18n `settings`) and the ZIP.
- `src/*.test.ts`: vitest with a fake Decaid; one test runs the built bundle without a `URL` class, as Decaid does.
- `tools/preview-server.mjs`: fake Decaid (8080) and a Streamline checkout (3000, `SKIN=<folder>`).

## Rules

- **Don't change `VERSION`** in feature work; add what changed to the coming `## X.Y.Z` section of `CHANGELOG.md`.
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
- GitHub Free has no branch protection for this private repository, so these rules are what protects `main`, together
  with the `.githooks/pre-push` hook (see `README.md`). Don't bypass it (`--no-verify`) or remove it.
- Workflows keep least privilege (`permissions: contents: read` unless a job needs more) and use only GitHub-owned
  actions (the repository allows no others).
- This file is the one source of the rules: `CLAUDE.md` and `.github/copilot-instructions.md` only point here. Update
  a rule here when it changes and remove stale ones; don't copy rules into the pointers.

## Product decisions (keep unless the owner asks otherwise)

- **No scrolling on the tablet.** The owner's tablet is a Samsung Galaxy Tab A11 (1340×800, full screen). Every view
  must fit 1280×800 and 1340×800 without page scrolling; lists and columns scroll inside themselves. Button sizes:
  toggles `2.267rem`, ± steps `1.733×2.4rem`, R2 `1.867rem`; don't enlarge them. The score is a slider in steps of
  5 with ticks and no preset chips. Taste and body share one line as joined buttons.
- Streamline's header button opens the Shot page full screen over the dashboard (the coffee picker when no coffee is
  chosen). Settings → "When I choose a coffee" keeps the settings or loads the coffee's last/best shot.
- Finished bags: listed last and greyed; the picker and the Coffees list show them with the "Finished" switch.
- Bean photos are the plugin's own (taken or chosen on the tablet, in Decaid's store); Streamline's header shows
  no image.
- Taste, body and water are Bean Journal's own (`extras.beanJournal`); other plugins' values are not read.
- Dropdowns are the page's own (`enhanceSelect` in `ui.ts`); use plain `<select>` elements in code.
- The plugin and page are English only; they follow the skin's theme (`?theme=light|dark`, else Streamline's
  `streamlineSettings/theme`).

## Sibling repository: Beanbox

Bean Journal grew out of the Beanbox plugin (`pagratios/decentespresso-beanbox`, private, its `plugin/` folder) and
the two share most of their tablet code. **A change in one that isn't specific to it belongs in both:**

- Shared: Decaid quirks and API use, Streamline surfaces and the overlay protocol, keep ratio, gear keeping,
  brew-temperature write-back, shot reading and editing, the chart, steppers, dropdowns and other page parts, the
  theme, the R2 refractometer, profiles, the MCP machinery, the build, tests' fake Decaid, the preview server.
- Not shared: Bean Journal's coffees in Decaid (beans, batches, photos, waters as text); Beanbox's cloud (account,
  uploads, bags, recipes, suggestions, machines) and its skin fork.
- When a change is shared, make the matching change in the other repository too (its own branch and pull request),
  or, if that isn't possible now, say so in the pull request with what still has to be ported. Name the other
  repository's commit or pull request in each.
- Beanbox is private and a client of an unpublished service: never bring its cloud code, URLs, keys or branding
  into this public repository.

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
- The owner's tablet runs Decaid at http://192.168.2.34:8080. Read from it freely; change data on it only when asked.
- Talk to the owner in the language they write in (often Greek); keep code, commits and docs in English.
