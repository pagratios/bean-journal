# Changelog

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