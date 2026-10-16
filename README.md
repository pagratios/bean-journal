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
| Grind | "Last 1.8": the grind of this coffee's last shot, a tap sets it. Under the label: the next shot's grinder · RPM · water, which opens a small card to change them. |
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
- **Coffees**: your bags, with photo, roaster, origin, process, grams left, roast date and frozen; search and filters;
  finished bags last and greyed, behind the **Finished** switch. **Add coffee**. With 10 or more old bags in use (no
  shot and no roast, purchase, opening or freezer date in the last 3 months, not frozen; an import's, say), the list
  offers once to finish them: you untick any to keep (bags with grams left start unticked), or Keep all.
- **A coffee's page**: every detail, its bags, its shots (last and best marked, load a shot's settings), Use for next
  shot, Edit, Freeze / Thaw, Finished.
- **Add / edit a coffee**: roaster, name, country, region, producer, farm, varieties, altitude, process, decaf, tasting
  notes, the roaster's page; and for the bag: roast date and level, weight and grams left, frozen with its dates,
  opened, best before, notes. A photo taken with the tablet's camera or chosen from its gallery.
- **Next shot** (the bar at the top): the coffee (the picker) and the grinder, RPM and water.
- **Settings**: "When I choose a coffee" (keep the settings, or load the coffee's last or best shot), "Add Bean Journal
  details to shot notes" (see Visualizer), and the R2 search.
- **AI**: the MCP endpoint's access level, tokens and connection details (below).

Streamline with DYE2 on clears the coffee, grinder and RPM after each shot; Bean Journal puts the next shot's back.

## Where the data lives

| What | In Decaid |
| --- | --- |
| A coffee | A bean: roaster, name, country, region, producer, varieties, altitude, process, decaf, notes (the tasting notes); species and decaf process (set by assistants). The farm and roaster's page go in its `extras.beanJournal`. |
| A bag | A bean batch: roast date and level, weight, grams left (Decaid takes each shot's dose off), frozen and its dates, opened, best before, notes; harvest, cupping score, price and currency, buy date (set by assistants). Finished = archived. |
| A photo | The key-value store, `beanJournal-photos/<bean id>`: a resized JPEG, or an https image address an assistant gave (the page shows it from the web). |
| Waters | The next shot's in the workflow (`context.extras.beanJournal.water`), each shot's in its annotations; the recent ones in `beanJournal/waters`. |
| Old bags offered | `beanJournal/oldBags` in the key-value store, once answered. |
| A shot's rating | Decaid's own fields: `enjoyment` (score ÷ 10), `espressoNotes`, `drinkTds`, `drinkEy`, actual dose and yield; taste and body in `annotations.extras.beanJournal`. Grinder, grind and RPM (`extras.rpm`) on the shot's workflow context. |

Bean Journal never deletes beans, batches or grinders. It deletes a shot only when you confirm it.

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

1. Download `bean-journal.reaplugin-<version>.zip` (a release, or build it below).
2. Decaid → Plugins → `+` → ZIP file, and turn it on.
3. Streamline (after 0.2.14, with plugin surfaces) shows it at its next read of the plugins.

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