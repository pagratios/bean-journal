# Changelog

## 0.1.6

- Keep a per-shot coffee-use index instead of rereading the entire shot history every 15 seconds or after each edit.
  Refresh changed shots by ID; preserve older brews when a shot is reassigned or deleted.
- Detect silent deletions and missed additions with a lightweight ID probe, and audit one page per refresh period
  for missed edits. Keep Decaid's actual 100-shot page cap; surface failed probes rather than returning stale success.
- Start exact history initialization when the plugin loads, reading at most four 100-item pages concurrently without
  showing partial order. Export retained history and its identity/probe adapters from `bean-journal/core` for other plugins.

## 0.1.5

- Show compact resting-age labels, such as 5d, on coffee cards, in the picker and in bag details. Count calendar
  days since roasting outside the freezer; hide unknown or inconsistent ages.
- Keep earlier freezer time across repeated whole-bag Freeze / Thaw actions. Start a fresh interval when refreezing,
  preserve other apps' batch extras, and let the latest dates be edited or cleared without changing earlier time.
- Export product-neutral resting-age and freezer-interval runtime helpers from `bean-journal/core`.

## 0.1.4

- Show the selected unfinished bag first in Coffees and the picker, then bags by their last brewed shot (newest
  first), with finished bags always last. Equal or missing brew times keep the previous order. Selecting, editing
  or uploading a shot does not count as brewing; reassignment and deletion refresh the history.
- Export stable coffee sorting and refreshable, adapter-driven brew history from `bean-journal/core`.

## 0.1.3

- Remember Keep ratio and its target separately for each coffee and espresso profile, across plugin/tablet restarts.
  Unlocked keeps a fixed drink weight; locked keeps the exact ratio as the dose changes. New bags of the same bean
  share the choice. Unseen combinations keep existing settings; explicit profile numbers and loaded shots win.
- Export the product-neutral persistent ratio runtime and identity helper from `bean-journal/core`, so other plugins
  can supply their own coffee identities and storage without copying the workflow/event logic.

## 0.1.2

- Needs Streamline 0.2.15 or newer: the header, screensaver and shot-history pages open full screen over the dashboard
  again (Streamline's overlay `size: "full"`), so going back no longer reloads Streamline.

## 0.1.1

- Open the header, screensaver and shot-history pages full screen on Streamline 0.2.14 too, using page navigation
  instead of an overlay size that release ignores. Done or × returns to Streamline; the small gear overlay is unchanged.

## 0.1.0

First version: Beanbox's tablet features without an account or cloud, on stock Streamline.

- Coffees as Decaid beans and bean batches: list, add, edit, photos, bags, frozen, finished; a coffee's page with its
  shots. A long list of old bags (an import's, say) is offered for finishing once: bags not frozen, with no shot and
  no date of their own in the last 3 months, those with grams left unticked.
- The Shot page: chart, compare, Older / Newer / Latest, score, taste, body, notes, TDS / EY with the DiFluid R2,
  grinder, grind, RPM, water, coffee, Load for next shot, Copy for AI, Open in Visualizer, Delete.
- The next shot's coffee (keep the settings, or load its last / best shot), grinder, RPM and water (text). The bar at
  the top has the coffee; the grinder, RPM and water are chosen from Streamline's line under Grind, whose lists open
  right under their field.
- Settings keeps Decaid's grinders (add, edit name, burrs and steps, put away = archived, restore; never deleted) and
  the list of waters the water field offers (add, rename, remove; shots keep theirs).
- Streamline's surfaces: header button, screensaver button, Grind / Dose / Drink pills and lines, Keep ratio, the
  ratio's numpad, the live shot strip, "Rate and edit" in the shot history.
- Optional Bean Journal block in shot notes for Visualizer.
- MCP endpoint for AI assistants with three access levels and confirmations. `add_coffee` and `update_coffee` set
  every field Decaid has for a coffee and its bag (also species, decaf process, harvest, cupping score, price and buy
  date, which the page doesn't show) and its photo, as an https image address or a data URL.
- For other plugins: `bean-journal/core` (`src/core/`), the product-neutral part of Bean Journal (Decaid data and
  client, shot curves and steps, profiles, Streamline's surfaces with Keep ratio, the MCP server, the theme), as
  TypeScript source to pin from GitHub and bundle.
- Released on GitHub: Decaid installs Bean Journal and keeps it up to date from its releases (Plugins → `+` → GitHub
  Release, repository `pagratios/bean-journal`, asset `bean-journal.reaplugin.zip`).