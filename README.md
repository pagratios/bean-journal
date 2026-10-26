# Bean Journal

A [Decaid](https://github.com/decentespresso/decaid) plugin for the [Streamline](https://github.com/decentespresso/streamline-js)
skin on a Decent espresso machine's tablet: your coffees, your shots and dialling in, all on the tablet. No account,
no cloud. Everything is kept in Decaid's own data (beans, bean batches, grinders, shots and its key-value store), so
other apps that read Decaid see it too.

It is also a worked example of what [Streamline's plugin surfaces](https://github.com/decentespresso/streamline-js/blob/main/docs/plugin-surfaces.md)
can do: a header button, tile hints and lines, a step-size pill, a ratio lock, the ratio's numpad, the live shot strip,
a long-press menu item, a screensaver button and overlay pages, from small to full screen.

## What it does

**On Streamline's dashboard**

| Where | What |
| --- | --- |
| Header | The coffee for the next shot (and its roaster). Opens Bean Journal full screen over the dashboard; with no coffee chosen, the coffee picker. |
| Grind | "Last 1.8": the grind of this coffee's last shot, a tap sets it. Under the label: the next shot's grinder · RPM · water, which opens a small card to choose them. |
| Dose | A ±1 / 0.5 / 0.1 g step pill for the − / + buttons, and ⚖ Scale, which sets the dose from the scale. |
| Drink | 🔒 Ratio (Keep ratio: a new dose moves the drink weight with it, in the same write), a step pill, and a tap on "(1:2.2)" opens the numpad for a new ratio. |
| During an espresso | Above the chart: the step, puck temperature, pressure and flow against their goals (with a dot), the weight flow, and the weight against the drink with a bar. |
| Shot history | Long-press → "Rate and edit" opens that shot. |
| Screensaver | A Bean Journal button, to read or rate while the machine sleeps. |

**Its page** (fits the tablet's screen, 1280×800 and 1340×800, without scrolling; light and dark follow Streamline)

- **Shot**: the shot's chart (pressure, flow, weight, weight flow, temperature, targets and steps; full screen with a
  double tap), compare with another shot, Older / Newer / Latest, a score slider (steps of 5), taste (sour, balanced,
  bitter) and body (thin, medium, heavy), notes, dose, yield, TDS and EY (linked), grind, grinder, RPM, water, the
  coffee it was pulled with, a DiFluid R2 measurement through Decaid, **Load for next shot**, **Copy for AI**,
  **Open in Visualizer** and Delete (it asks). Edits are saved on Decaid's shot, and saved before the page closes
  when an espresso starts.
- **Coffees**: your bags, with photo, roaster, origin, process, grams left, roast date and frozen; search and filters.
  A small **5d** on cards and in the picker means resting days since roasting, excluding freezer time. It pauses
  while frozen and resumes after thawing; no age is shown without a valid roast date or with incomplete freezer dates.
  Here and in the picker, the selected unfinished bag comes first, then the last brewed shot (newest first);
  finished bags stay last and greyed, behind the **Finished** switch, even when selected. Equal or missing brew times
  keep the previous order (newest roast, then newest added). **Add coffee**. With 10 or more old bags in use (no
  shot and no roast, purchase, opening or freezer date in the last 3 months, not frozen; an import's, say), the list
  offers once to finish them: you untick any to keep (bags with grams left start unticked), or Keep all.
- **A coffee's page**: every detail, its bags, its shots (last and best marked, load a shot's settings), Use for next
  shot, Edit, Freeze / Thaw, Finished.
- **Add / edit a coffee**: roaster, name, country, region, producer, farm, varieties, altitude, process, decaf, tasting
  notes, the roaster's page; and for the bag: roast date and level, weight and grams left, frozen with its dates,
  opened, best before, notes. A photo taken with the tablet's camera or chosen from its gallery.
- **Next shot** (the bar at the top): the coffee (the picker). Its grinder, RPM and water are chosen from Streamline's
  line under Grind.
- **Settings**: "When I choose a coffee" (keep the settings, or load the coffee's last or best shot), "Add Bean Journal
  details to shot notes" (see Visualizer), the R2 search, Decaid's **grinders** (add, edit, put away, restore) and the
  list of **waters** the water field offers (add, rename, remove).
- **AI**: the MCP endpoint's access level, tokens and connection details (below).

Streamline with DYE2 on clears the coffee, grinder and RPM after each shot; Bean Journal puts the next shot's back.

**Ratio choices follow the coffee and profile.** For example, one coffee can keep Ratio off and an 80 g drink
regardless of dose, while another keeps Ratio on at 1:2.5 (18 g → 45 g; 20 g → 50 g). Switching coffee or profile
restores that combination's mode and target, including after a restart. Bags of the same bean share its choices.
Unseen combinations use the existing settings; no coffee defaults are invented. Choosing "keep the settings" keeps
everything else, but restores a known ratio choice. Loading a last/best shot, or supplying dose, yield, ratio or lock
explicitly with `load_profile`, takes precedence and becomes the new remembered choice.

## Where the data lives

| What | In Decaid |
| --- | --- |
| A coffee | A bean: roaster, name, country, region, producer, varieties, altitude, process, decaf, notes (the tasting notes); species and decaf process (set by assistants). The farm and roaster's page go in its `extras.beanJournal`. |
| A bag | A bean batch: roast date and level, weight, grams left (Decaid takes each shot's dose off), frozen and its dates, opened, best before, notes; harvest, cupping score, price and currency, buy date (set by assistants). Finished = archived. |
| Earlier freezer time | The batch's `extras.beanJournal.pastFrozenDays`: completed calendar days before its latest freeze/thaw interval. Other apps' batch extras are preserved. |
| A photo | The key-value store, `beanJournal-photos/<bean id>`: a resized JPEG, or an https image address an assistant gave (the page shows it from the web). |
| Waters | The next shot's in the workflow (`context.extras.beanJournal.water`), each shot's in its annotations; the list (recent ones first, kept in Settings) in `beanJournal/waters`. |
| Old bags offered | `beanJournal/oldBags` in the key-value store, once answered. |
| Ratio memory | `beanJournal/ratioMemory` in the key-value store: versioned choices by bean id and profile name/design, storing either an unlocked drink weight or a locked, unrounded ratio. Stop weight, brew temperature and notes do not change a profile's identity; a renamed or redesigned profile starts a new combination. |
| A shot's rating | Decaid's own fields: `enjoyment` (score ÷ 10), `espressoNotes`, `drinkTds`, `drinkEy`, actual dose and yield; taste and body in `annotations.extras.beanJournal`. Grinder, grind and RPM (`extras.rpm`) on the shot's workflow context. |

Bean Journal never deletes beans, batches or grinders: a grinder put away in Settings is archived in Decaid (shots
made with it keep it). It deletes a shot only when you confirm it.

**Freeze / Thaw** on a coffee's page applies to the whole bag, dated today on the tablet. Refreezing keeps the last
completed stay in the earlier total and clears the old thaw date. The edit form starts a new stay the same way; its
latest dates remain editable. Changing or clearing both latest dates changes only that stay, never earlier freezer
time. Clearing only one date leaves the age unknown until the pair is repaired. An incomplete earlier stay must be
corrected before refreezing so it is not silently lost. Reversed, overlapping or future freezer dates are refused.
Calendar days, not elapsed 24-hour periods, are counted, so daylight-saving changes do not change the result.

## Visualizer

Decaid's own Visualizer plugin uploads shots and sends later edits. Bean Journal writes the fields it reads (score,
TDS, EY, notes, dose, yield, grinder, grind, coffee and roaster), so a rating on the tablet reaches Visualizer.

- **Open in Visualizer** on the Shot page, once the shot is there (Decaid opens it in the system browser).
- **Add Bean Journal details to shot notes** (Settings, off by default): adds a block to each shot's notes,
  ```
  [Bean Journal]
  Taste: Balanced · Body: Medium
  Water: Lotus Light Roast
  Grinder: 900 RPM
  [/Bean Journal]
  ```
  so Visualizer shows what it has no field for. Your own notes stay as you wrote them (the page shows them without
  the block); a block edited elsewhere is left alone; turning it off leaves existing blocks.

## AI assistants (MCP)

The plugin is an MCP server (Streamable HTTP, JSON answers, no streams) at
`http://<tablet>:8080/api/v1/plugins/bean-journal.reaplugin/mcp`. Every tool runs one of the page's own actions, so
the same checks apply.

- **Off until you choose a level** on the page's **AI** tab: Read only, Shots and coffee, or Everything. No tool
  starts a shot.
- **Tokens:** the page makes one per level when it is first turned on (`bjm_…`, kept in Decaid's secure settings).
  Clients send it as `Authorization: Bearer <token>`, or `?token=` when they can't set headers. Off or a wrong token
  is a bare 404. **New token** cancels the old one.
- **Ask me before:** tools of a gated kind answer `needs_confirmation` and do nothing; the assistant asks you in the
  chat and calls again with `confirmed: true`. `delete_shot` always asks. Tokens, levels and confirmation settings
  can only be changed on the tablet.

| Level | Tools (each level includes the one before) |
| --- | --- |
| Read only | `get_status`, `get_dial_in_context`, `list_coffees`, `get_shot`, `list_shots`, `list_profiles`, `list_equipment`, `get_preferences`, `get_refractometer` |
| Shots and coffee | `rate_shot`, `delete_shot`, `measure_tds`, `set_next_shot`, `add_coffee`, `update_coffee` |
| Everything | `create_profile`, `update_profile`, `update_preferences`, `search_refractometer`, `choose_coffee`, `load_profile`, `load_shot_settings` |

`add_coffee` and `update_coffee` take every field Decaid has for a coffee and its bag, and `photo`: an https image
address (kept as it is and shown from the web; Decaid's plugins can't download an image) or a
`data:image/jpeg|png|webp;base64,…` URL up to 600 000 characters.

- **At home:** Claude Desktop through `mcp-remote`, VS Code or Copilot CLI, with the address and the token.
- **Away, on your own devices (Tailscale serve):** on an always-on computer at home with Tailscale, forward only this
  path to the tablet: `tailscale serve --bg --set-path /bean-journal http://<tablet-ip>:8080/api/v1/plugins/bean-journal.reaplugin/mcp`,
  then use `https://<computer>.<tailnet>.ts.net/bean-journal` with the token.
- **Phone apps (Tailscale Funnel):** Claude's and ChatGPT's custom connectors call from the vendor's servers, so they
  need a public address. Turn on the phone apps' level (keep it low), use `tailscale funnel` instead of `serve`, enter
  the Funnel address on the AI tab and paste the connector URL it shows. Never funnel all of port 8080: Decaid's own
  API has no login.

## Install

- Kept up to date by Decaid: Plugins → `+` → GitHub Release, repository `pagratios/bean-journal`, asset
  `bean-journal.reaplugin.zip`.
- Or download `bean-journal.reaplugin.zip` from the [releases](https://github.com/pagratios/bean-journal/releases)
  (or build it below): Decaid → Plugins → `+` → ZIP file.

Turn it on; Streamline 0.2.15 or newer shows it at its next read of the plugins. The header, screensaver and
shot-history buttons open Bean Journal full screen over the dashboard (an overlay of `size: "full"`, new in 0.2.15;
0.2.14 opens it in its smaller default window).

Bean Journal can be installed beside other plugins. If another plugin also asks for the header button, the first one
in Decaid's plugin list wins.

## Build, test, preview

```sh
git config core.hooksPath .githooks   # once per clone: blocks direct pushes to main (changes go through a PR)
npm install
npm run typecheck
npm test           # vitest, with a fake Decaid; includes a run of the built bundle without a URL class (as in Decaid)
npm run build      # build/bean-journal.reaplugin/ and build/bean-journal.reaplugin-<version>.zip
```

Try it without a machine: build, then

```sh
SKIN=<a checkout of decentespresso/streamline-js> npm run preview     # PowerShell: $env:SKIN="..."; npm run preview
```

and open http://localhost:3000/ (Streamline) or
http://localhost:8080/api/v1/plugins/bean-journal.reaplugin/ui (the page alone; `?view=coffees`, `?theme=dark`…).
A fake Decaid on port 8080 runs the built plugin with sample coffees, grinders and shots. The **☕ Simulate coffee**
button pulls a 32 s shot (stored as Decaid stores shots), Sleep shows the screensaver, and a fake DiFluid R2 measures.
`R2=0` removes the R2, `SCALE=0` the scale. Restart it after a build.

## CI and releases

- **CI** (`.github/workflows/ci.yml`, every pull request and push to `main`): typecheck, tests (the release scripts'
  too), build; the ZIP is kept as a workflow artifact (never a release).
- **The version changes only in releases.** CI refuses a pull request that changes `VERSION` (`src/plugin.ts`),
  except the `release/X.Y.Z` pull request made by `scripts/release.mjs`. Features add their notes to the coming
  `## X.Y.Z` section of `CHANGELOG.md`.
- **A release**, from a checkout whose HEAD equals `origin/main`:
  1. `CHANGELOG.md` has a `## X.Y.Z` section for the new version (on `main`, or written now and left uncommitted).
  2. `node scripts/release.mjs <patch|minor|major|X.Y.Z>`: creates `release/X.Y.Z`, sets `VERSION` and npm's
     `version` to `X.Y.Z`, commits `Release X.Y.Z`, pushes the branch and opens its pull request.
  3. Merge it, then `node scripts/release.mjs tag`: tags the commit on `origin/main` that set the version as
     `vX.Y.Z` and pushes only the tag. (The first release, `0.1.0`, has no release pull request: it tags `main`.)
  4. `.github/workflows/release.yml` tests and builds the tag and creates the GitHub release with
     `bean-journal.reaplugin.zip`: **What's new** from `CHANGELOG.md`, the install steps, then the commits since the
     previous tag. Decaid's "GitHub Release" install finds the file by that exact name at every update. Run by hand
     on a branch, the workflow only leaves a labelled artifact.

## Building another plugin on the core

`src/core/` is the part of Bean Journal that any Decaid plugin for Streamline can share: Decaid's data read safely and
its REST client, a shot's curves and profile steps, "Copy for AI" text, profiles (checked steps, edits, a brew
temperature, AI designs), Streamline's plugin surfaces with Keep ratio, the MCP server (levels, confirmations, rate
limit) and Streamline's theme tokens. It names no product: a plugin passes its own button, extras key, texts and MCP
tools. It also owns persistent coffee/profile ratio memory and dose following. A test keeps it product-neutral and
keeps it importing only itself.

Another plugin pins a version and bundles the core into its own `.reaplugin`:

```sh
npm install github:pagratios/bean-journal#<commit or tag>
```

```ts
import { streamlineSurfaces, mcpMessage, shotCurves, tagIn } from "bean-journal/core";
```

and its build reads the theme with
`readFile(fileURLToPath(import.meta.resolve("bean-journal/core/theme.css")), "utf8")`.

The package is TypeScript source (no build step); a bundler such as esbuild and `"moduleResolution": "bundler"` read
it as is. Only `src/core/` is in the package.

### Coffee ordering and brew history

`sortCoffees`, `createCoffeeHistory`, `CoffeeSortOptions<Coffee>` and `CoffeeHistoryOptions<Shot>` are exported from
`bean-journal/core`. Keep one history runtime per plugin, and pass a stable, unsorted-again source array to the sorter:

```ts
import { createCoffeeHistory, sortCoffees } from "bean-journal/core";

const history = createCoffeeHistory({
  readShots: (offset, limit) => readShotPage(offset, limit),
  readShotIds: () => readAllShotIds(),
  readShot: (id) => readShotOrNullIfMissing(id),
  shotId: (shot) => shot.id,
  coffeeId: (shot) => bagIdForShot(shot),
  brewedAt: (shot) => isActualBrew(shot) ? Date.parse(shot.timestamp) : null,
});

const lastBrewed = await history.lastBrewed();
const ordered = sortCoffees(bags, {
  coffeeId: (bag) => bag.id,
  isFinished: (bag) => bag.finished,
  selectedId: selectedBagId,
  lastBrewed,
});
```

`sortCoffees` returns a new array: unfinished before finished, the selected unfinished bag first, then newest brew
within each group. Ties and bags without history preserve the input's relative order. Finished selection never
promotes a bag. Use stable bag ids, not names or bean ids shared by multiple bags. Bean Journal uses only the shot's
`workflow.context.beanBatchId`; an unlinked/name-only shot does not guess which bag was used.

The host supplies a complete, consistently ordered paginated listing; `readShots(offset, limit)` returns fewer than
`limit` (100) only at the end. **Decaid caps actual pages at 100**, even when its response echoes a larger requested
limit. Do not increase the request size or infer support from that echo. Summaries are sufficient if they carry the original
brew timestamp and enough capture-time identity to assign a bag confidently. `coffeeId` may be asynchronous; return
`null` for an uncertain match. `brewedAt` returns milliseconds, or `null` for cleaning/calibration/non-brews. Non-finite
times are excluded. Never use selection, modification or upload times as a brew time.

The retained index keeps each shot's bag and original brew time, including older uses behind a bag's newest brew.
Call `history.invalidate(shotId)` on shot stored/updated events and after local shot writes/deletions, including
reassignment. The next read refreshes only those IDs; reassignment/deletion removes obsolete uses and exposes the
previous brew without scanning again. An unrelated notes/rating/upload edit cannot promote a bag. Without an ID,
`invalidate()` explicitly requests a full rebuild; reserve this for startup, unload or an unknown change, not polling.

`readShotIds` supplies **all** IDs (Decaid's `/shots/ids`, one lightweight request; response size and local comparison
are proportional to shot count). Every 15 seconds, measured from the previous probe's **completion**, the runtime
reconciles membership: silent deletions remove indexed entries, and missed additions/imports are fetched individually.
It also audits one 100-summary page to recover missed same-ID edits. Unchanged warm reads need no full scan: zero
history requests between probes, and two per due probe regardless of history size. `probeIntervalMs` overrides the
probe interval; it is not an index TTL (`maxAgeMs` is no longer an option).

There is no Decaid modified-since/revision API: an ID-only probe cannot detect edits to existing IDs. Normal events
update immediately on the next read; a missed same-ID edit is found when the rolling audit reaches its page
(43 active refresh periods, about 10m45s, for 4,205 unchanged shots). Audit progress requires reads; this is not a
claim of exact instantaneous change detection. The first read in a new runtime does a complete scan, bracketed by
ID checks; Bean Journal starts this on load, but a view opened before initialization finishes waits for the exact
order. No partial map is shown and no later background initialization reorders visible cards.

Concurrent reads share one operation, including retries. Invalidations during an operation discard its candidate,
retrying at most three times before `coffeeHistoryChanged`. Failed pages/probes/identity lookups reject, preserve
pending work and do not return a stale success or cache partial history; a subsequent call retries. `readShot` returns
null only on confirmed absence, never on network errors. `lastBrewed()` returns a defensive map copy. Hosts must
surface errors, reject reads after unload, and invalidate on unload/reload. Existing consumers must add the three
new identity/membership adapters and pass IDs to event invalidation when updating their pinned core version.

### Resting age and freezer intervals

`coffeeRestingDays`, `coffeeFreezerDays` and `CoffeeAgeInput` are exported from `bean-journal/core`. These are pure
runtime helpers; the host owns bag storage and freeze/thaw writes:

```ts
import { coffeeRestingDays, coffeeFreezerDays } from "bean-journal/core";

const bag = {
  roastDate: "2026-10-01",
  frozen: false,
  freezeDate: "2026-10-06",
  thawDate: "2026-10-16",
  pastFrozenDays: 0,
};
coffeeFreezerDays(bag, "2026-10-20"); // 10
coffeeRestingDays(bag, "2026-10-20"); // 9
```

Dates are real `YYYY-MM-DD` calendar days, not timestamps. Supply today's day in the user's timezone, not a UTC day
from `toISOString()`. `pastFrozenDays` counts completed stays **before** the latest interval; omit it for zero, or
pass `null` for an unknown total. A currently frozen bag counts its latest stay through today and ignores a stale
thaw date; a thawed bag counts through its thaw date. No dates on a thawed bag means no latest interval.
`coffeeFreezerDays` returns only the latest interval's days, **not** the earlier total.

Both helpers return `null` for invalid/incomplete intervals; `coffeeRestingDays` also returns `null` for a missing,
invalid or future roast, a freeze before roasting, or an invalid earlier total. Otherwise it returns a whole
non-negative resting day count (fractional earlier totals are accepted and the result is floored, clamped at zero).
On refreeze, the host adds `coffeeFreezerDays` for the completed stay to the earlier total exactly once, starts a new
freeze date no earlier than the last thaw and clears the thaw date. Edits to the latest dates must not add to the
earlier total. These helpers do not import product-specific identities, APIs or persistence.

### Persistent ratio runtime

`createRatioMemory`, `ratioProfileKey`, `RatioMemoryOptions`, `RatioMemoryData`, `RatioChoice` and `RatioChange` are
exported from `bean-journal/core`. Create one runtime per plugin; the host provides its own persistence and identity
adapters. For example, with an existing Decaid REST client `local`:

```ts
import { createRatioMemory, object, optionalObject, text } from "bean-journal/core";

const slot = "/store/myPlugin/ratioMemory";
const ratios = createRatioMemory({
  readWorkflow: async () => object(await local("/workflow")),
  writeWorkflow: async (patch) => {
    const saved = optionalObject(await local("/workflow", "PUT", patch));
    return saved.context ? saved : null; // null: the runtime reads it again
  },
  readMemory: async () => {
    try { return await local(slot); }
    catch (e) {
      if (e instanceof Error && e.message === "notFound") return null;
      throw e;
    }
  },
  writeMemory: async (data) => { await local(slot, "POST", data); },
  coffeeKey: (workflow) => text(optionalObject(workflow.context).beanBatchId) || null,
});
```

The example uses batch identity; Bean Journal resolves each batch to its bean id so bags share memory. A consumer
with another coffee model supplies its stable id instead (the adapter may be asynchronous). Return `null` when
there is no coffee, not a display name or a prior coffee's fallback. `profileKey` is optional: by default
`ratioProfileKey` uses the profile's name/design, excluding notes, stop weight and step temperatures (Decaid's record
hash includes mutable settings, and the workflow does not carry that record's id). Same-named different designs
stay separate; same-named designs differing only in temperature share memory. A consumer with a stable profile id
can supply `profileKey` to distinguish these or preserve identity across renames.

| Host path | Runtime call |
| --- | --- |
| Startup and every `workflowUpdated` | `await ratios.follow()`; handle/log rejections. It reads the current workflow; do not replay event payloads. Also call it after restoring coffee during shot clean-up and on a missed-event reconciliation. |
| Ordinary coffee/profile choice | `await ratios.change(patch)`. New combinations keep the patch's normal settings; known ones restore memory. |
| Shot/recipe load, or explicit dose/yield/lock input | `await ratios.change(patch, { explicit: true })`. Supply the full intended target settings. Explicit loads update memory and never restore an old choice over them. |
| Typed ratio | `await ratios.change(patch, { ratio: 2.5 })`. The runtime computes the yield from the resulting dose and preserves this exact ratio, rather than deriving it from rounded grams. |
| Streamline surfaces | Pass `kept: ratios.kept` into `streamlineSurfaces` after following the current workflow. |

`change` also accepts a synchronous `(currentWorkflow) => patch` factory for calculations that need the freshest
numbers. Route coffee and explicit settings together in one change, rather than selecting the coffee and then
changing its lock. Keep normal profile defaults in an ordinary profile-load patch; reserve `explicit` for deliberate
target inputs. Shot loads should carry the shot's lock if recorded, else the current flag. Recipe targets always
count as explicit. This runtime replaces, rather than supplements, a consumer's old Keep ratio event loop.

The runtime serializes its own loads/events, rereads before applying a delayed identity lookup, ignores write echoes,
and retries a workflow that moved during planning (then rejects with `workflowChanged` if it stays busy). Yield
updates send only `profile.target_weight`, not stale temperatures or steps. Workflow adapters must preserve Decaid's
deep-merge semantics. No compare-and-swap is available in Decaid: hosts should serialize their own load paths and
avoid separate writers for ratio targets. Storage errors reject; only a genuinely missing key starts empty. A
malformed/unknown store version is rejected without overwriting it. `readMemory`/`writeMemory` own one versioned
JSON value; do not let a second runtime write the same slot concurrently. Host adapters should reject after unload.

## Things learned about Decaid's plugin engine

- There is no `URL` class in plugin code; parse addresses by hand. The page runs in the browser and may use it.
- `PUT /shots/{id}` deep-merges; `PUT /workflow` merges what it is sent; `PUT /beans/{id}` replaces `extras` whole
  (merge with what is there first). `POST /beans/{id}/batches` ignores `weightRemaining` and `archived`: a `PUT`
  follows. `GET /beans` leaves archived ones out without `?includeArchived=true`.
- Streamline reads `skin` with a 2 s timeout: answer from the last answer when a fresh one is slow, and push the fresh
  one on the plugin's websocket.
- Streamline's overlay frame is sandboxed without popups; a plain link to an outside address opens in the system
  browser.

## License

[MIT](LICENSE)