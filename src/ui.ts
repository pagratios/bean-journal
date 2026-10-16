import type { Copy } from "./i18n";

export type { Copy };
declare const __DECAID_COPY__: Copy;
declare const __DECAID_THEME__: string;
export function copy(): Copy {
  return __DECAID_COPY__;
}

// Serialized into the page: browser helpers must remain inside this function.
function client(t: Copy) {
  type Data = Record<string, unknown>;
  type Coffee = {
    id: string; beanId: string; batchId: string | null; roaster: string; name: string;
    country: string; region: string; producer: string; farm: string; varieties: string[]; altitude: number[];
    process: string; decaf: boolean; tastingNotes: string; link: string; photo: string | null;
    roastDate: string | null; roastLevel: string; weight: number | null; remaining: number | null;
    frozen: boolean; freezeDate: string | null; thawDate: string | null; openDate: string | null; bestBefore: string | null;
    bagNotes: string; finished: boolean; createdAt: string;
  };
  type Series = { t: number[]; pressure: (number | null)[]; flow: (number | null)[]; weight: (number | null)[]; temp: (number | null)[];
    weightFlow?: (number | null)[]; targetPressure?: (number | null)[]; targetFlow?: (number | null)[]; targetTemp?: (number | null)[] };
  type Step = { t: number; frame: number; name: string };
  type Shot = {
    id: string; timestamp: string; profile: string; kind: string; brew: boolean; coffeeName: string; coffeeRoaster: string;
    coffeeId: string | null; beanId: string | null; dose: number | null; yield: number | null; duration: number | null;
    grind: string; score: number | null; balance: string | null; body: string | null; notes: string; tds: number | null;
    ey: number | null; grinderId: string | null; grinderModel: string; rpm: number | null; water: string | null;
    visualizerId?: string | null; series: Series; steps?: Step[];
  };
  type Grinder = { id: string; model: string; settingType: string; settingValues: string[]; settingSmallStep: number | null; rpmSmallStep: number | null };
  const $ = (id: string) => document.getElementById(id)!;
  const locale = "en-GB";
  const str = (v: unknown) => typeof v === "string" ? v : "";
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
  const fmt = (v: number | null, digits = 1) => v === null ? "—" : v.toLocaleString(locale, { maximumFractionDigits: digits });
  const params = new URLSearchParams(location.search);
  const embedded = params.get("embed") === "1";
  // Stock Streamline opens the page full screen with the skin's address to go back to.
  const returnTo = (() => {
    if (embedded) return "";
    try {
      const back = new URL(params.get("returnTo") || "");
      return /^https?:$/.test(back.protocol) && !back.username && !back.password ? back.href : "";
    } catch { return ""; }
  })();
  // In the skin's overlay or opened full screen from it: the page closes itself (Cancel / Done, an espresso).
  const fromSkin = embedded || !!returnTo;
  // The skin passes its own theme; without one, Streamline's own choice is in Decaid's store (the device's until read).
  const wantedTheme = params.get("theme");
  document.documentElement.dataset.theme = wantedTheme === "dark" || wantedTheme === "light" ? wantedTheme
    : window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  if (wantedTheme !== "dark" && wantedTheme !== "light") {
    void fetch("/api/v1/store/streamlineSettings/theme").then((r) => r.ok ? r.json() : null).then((theme) => {
      if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
    }).catch(() => { /* the device's */ });
  }
  // The Grind line opens the gear card alone in the skin's overlay: the page behind it isn't drawn, and the card is
  // what the overlay fits (streamline:size). A dark color-scheme on the page would paint an opaque canvas behind it.
  if (embedded && params.get("view") === "next") {
    document.documentElement.classList.add("gear-only");
    document.querySelector('meta[name="color-scheme"]')?.remove();
  }
  let status: Data = {};
  let coffees: Coffee[] = [];
  let coffeesLoaded = false;
  let offset = 0;
  let shot: Shot | null = null;
  let detail: Coffee | null = null;
  let busy = false;
  let pickFor: "next" | "shot" = "next";
  // Opened straight from the skin (?view=pick): a coffee picked there closes the overlay.
  let pickOnly = false;
  // Decaid's grinders and the waters typed before: read again after a minute, or when the page comes back to the
  // screen; not on every Older / Newer.
  const LIST_MS = 60000;
  let grinders: Grinder[] = [];
  let grindersAt = 0;
  async function loadGrinders() {
    if (Date.now() - grindersAt < LIST_MS) return;
    try {
      grinders = list((await api("grinders")).grinders).map((g) => ({
        id: str(g.id), model: str(g.model), settingType: str(g.settingType),
        settingValues: Array.isArray(g.settingValues) ? g.settingValues.map(str).filter(Boolean) : [],
        settingSmallStep: num(g.settingSmallStep), rpmSmallStep: num(g.rpmSmallStep),
      })).filter((g) => g.id && g.model);
      grindersAt = Date.now();
    } catch { grinders = []; grindersAt = 0; }
  }
  let waters: string[] = [];
  let watersAt = 0;
  async function loadWaters() {
    if (Date.now() - watersAt < LIST_MS) return;
    try {
      const value = (await api("waters")).waters;
      waters = Array.isArray(value) ? value.map(str).filter(Boolean) : [];
      watersAt = Date.now();
    } catch { waters = []; watersAt = 0; }
  }
  const same = (a: string, b: string) => a.trim().toLocaleLowerCase(locale) === b.trim().toLocaleLowerCase(locale);
  const grinderNamed = (text: string) => text.trim() ? grinders.find((g) => same(g.model, text)) ?? null : null;
  const grinderText = (id: string | null, model: string) => model || grinders.find((g) => g.id === id)?.model || "";
  // The shot on screen has edits that Done hasn't stored yet (renderShot clears it).
  let unsaved = false;
  let saveShot: (() => Promise<boolean>) | null = null;
  // Which shots Older / Newer walk through, from the shot on screen when it was chosen; and the one compared with.
  type ShotSet = "all" | "coffee" | "profile" | "both";
  let shotSet: ShotSet = "all";
  let setFilter: Data = {};
  // Streamline's history menu (and a coffee's page) open the page at one shot (?shotId=), among all shots.
  let wantShot = params.get("shotId") || "";
  let compared: Shot | null = null;
  // The compare list for the shot on screen: saving a rating draws the shot again without reading the others again.
  let compareFor: { key: string; value: Promise<Data> } | null = null;
  let chartDrawn: { series: Series; compare: Series | null; node: HTMLElement } | null = null;
  const compareListOf = (s: Shot) => {
    const key = `${s.id}|${JSON.stringify(setFilter)}`;
    if (!compareFor || compareFor.key !== key) {
      const value = api("shots", { filter: setFilter, except: s.id });
      compareFor = { key, value };
      value.catch(() => { if (compareFor?.value === value) compareFor = null; });
    }
    return compareFor.value;
  };
  // The same coffee is the same Decaid bean (any of its bags); a shot with only a name goes by its name.
  const filterFor = (set: ShotSet, s: Shot | null): Data => !s || set === "all" ? {} : {
    ...(set !== "profile" ? (s.beanId ? { beanId: s.beanId } : { coffeeName: s.coffeeName, coffeeRoaster: s.coffeeRoaster }) : {}),
    ...(set !== "coffee" ? { profileTitle: s.profile } : {}),
  };
  // A shot from an answer ({ shot } or the shot itself); an edit's answer may leave out the curves the page has.
  const emptySeries = (): Series => ({ t: [], pressure: [], flow: [], weight: [], temp: [] });
  function shotFrom(value: Data, prev?: Shot | null): Shot {
    const got = (value.shot && typeof value.shot === "object" ? value.shot : value) as Shot;
    const series = got.series && Array.isArray(got.series.t) ? got.series : prev?.series ?? emptySeries();
    return { ...got, notes: str(got.notes), grind: str(got.grind), grinderModel: str(got.grinderModel), series, steps: got.steps ?? prev?.steps };
  }
  // Leaving a shot with unsaved edits asks Discard / Stay / Save: true once it may be left.
  async function leaveShot() {
    if (!unsaved) return true;
    const answer = await ask(t.unsavedChanges, [
      { label: t.discard, value: "discard", kind: "secondary discard" },
      { label: t.stay, value: "stay", kind: "secondary" },
      { label: t.save, value: "save" },
    ], "stay");
    if (answer === "stay") return false;
    if (answer === "save") return saving();
    renderShot();
    return true;
  }
  // Saves the shot's edits, through run() unless a task is already running (it then is that task's part).
  async function saving() {
    const save = saveShot;
    if (!save) return false;
    if (busy) return save();
    let ok = false;
    await run(async () => { ok = await save(); });
    return ok;
  }
  // The user is in the middle of something on the shot: typing in a field, a list or a message open.
  const interacting = () => {
    const a = document.activeElement;
    return !!document.querySelector(".dd-layer,dialog[open]") || (!!a && $("shot-body").contains(a) && a.matches("input:not([type=range]),textarea"));
  };
  // In the skin's overlay the page closes itself (Cancel / Done); stock Streamline draws its own ×. Full screen it
  // goes back to the skin.
  const toParent = (message: Data) => { try { window.parent?.postMessage(message, "*"); } catch { /* not embedded */ } };
  const closeOverlay = () => {
    if (returnTo) { backToSkin(); return; }
    toParent({ type: "streamline:close" });
  };
  // Back in history rather than to the address: the browser then shows the dashboard as it was left (its back/forward
  // cache) when it can, and loads it as before when it can't. Only when the page was opened from the skin (the
  // referrer, cross-origin, is the skin's origin); else, and if going back didn't leave the page, the address.
  function backToSkin() {
    let cameFromSkin = false;
    try { cameFromSkin = history.length > 1 && new URL(document.referrer).origin === new URL(returnTo).origin; } catch { /* no referrer */ }
    if (!cameFromSkin) { location.assign(returnTo); return; }
    const fallback = setTimeout(() => location.assign(returnTo), 1500);
    addEventListener("pagehide", () => clearTimeout(fallback), { once: true });
    history.back();
  }
  function updateFooter() {
    const onShot = !$("view-shot").hidden;
    const note = $("unsaved-note"), cancel = $("act-cancel") as HTMLButtonElement, done = $("act-done") as HTMLButtonElement;
    const dirty = onShot && unsaved;
    note.hidden = !dirty;
    done.classList.toggle("attention", dirty);
    // Standalone the footer is the shot's Save / Cancel; in the overlay it also closes it.
    $("actions").hidden = !fromSkin && !onShot;
    cancel.hidden = !onShot;
    // A coffee's page: Back to the list. The footer shows for it even outside the overlay.
    const onDetail = !$("view-coffees").hidden && !!detail;
    $("act-back").hidden = !onDetail;
    if (onDetail) $("actions").hidden = false;
    cancel.disabled = !fromSkin && !dirty;
    done.textContent = fromSkin ? t.done : t.save;
    done.disabled = !fromSkin && !dirty;
    done.hidden = !fromSkin && !onShot;
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function https(value: unknown) {
    try {
      const url = new URL(str(value));
      return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }
  // An outside page: a plain link. Streamline's overlay is sandboxed without popups (a new tab would never open), and
  // Decaid's web view sends any outside address to the system browser by itself.
  function outside(href: string, text: string, className = "", title = "") {
    const a = el("a", className, text) as HTMLAnchorElement;
    a.href = href; a.rel = "noopener noreferrer";
    if (title) a.title = title;
    return a;
  }
  const date = (value: unknown, time = false) => {
    const d = new Date(str(value));
    if (Number.isNaN(d.getTime())) return "—";
    return time ? d.toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  };
  async function api(action: string, data: Data = {}) {
    const response = await fetch("./control", {
      method: "POST", headers: { "x-bean-journal-ui": "1", "content-type": "application/json" },
      // The page's no-referrer policy would send "Origin: null"; same-origin keeps the real origin on our own calls.
      referrerPolicy: "same-origin",
      body: JSON.stringify({ action, ...data }),
    });
    // A failure without a JSON body (a proxy's page, an empty 404) still says what happened.
    const value = await response.json().catch(() => ({})) as Data;
    if (!response.ok) throw new Error(str(value.error) || `HTTP ${response.status}`);
    return value;
  }
  function say(text: string, kind: "info" | "error" = "info") {
    const n = $("notice");
    n.textContent = text;
    n.className = `notice ${kind}`;
    if (kind === "info" && text) setTimeout(() => { if (n.textContent === text) n.textContent = ""; }, 4000);
  }
  async function run(task: () => Promise<void>) {
    if (busy) return;
    busy = true;
    document.body.classList.add("busy");
    try { await task(); } catch (e) { say(e instanceof Error ? e.message : t.failed, "error"); }
    finally { busy = false; document.body.classList.remove("busy"); }
  }
  function button(label: string, action: () => Promise<void>, kind = "") {
    const b = el("button", kind, label);
    b.type = "button";
    b.onclick = () => { void run(action); };
    return b;
  }
  const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is Data => typeof x === "object" && x !== null) : [];

  // ── Photos: Decaid's store keeps each coffee's photo (a JPEG data URL, or an https address an assistant gave); read
  // lazily, kept by the coffee's stamp. ──
  const photoCache = new Map<string, Promise<string | null>>();
  function photoOf(beanId: string, stamp: string | null | undefined): Promise<string | null> {
    if (!beanId || stamp === null) return Promise.resolve(null);
    // No stamp known (a shot's coffee not in the list): read it all the same; forgetPhoto() drops it after a change.
    const key = `${beanId}|${stamp ?? "?"}`;
    let value = photoCache.get(key);
    if (!value) {
      value = fetch(`/api/v1/store/beanJournal-photos/${encodeURIComponent(beanId)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((v) => typeof v === "string" && (v.startsWith("data:image/") || v.startsWith("https://")) ? v : null)
        .catch(() => { photoCache.delete(key); return null; });
      photoCache.set(key, value);
    }
    return value;
  }
  const forgetPhoto = (beanId: string) => { for (const key of [...photoCache.keys()]) if (key.startsWith(`${beanId}|`)) photoCache.delete(key); };
  // The cards' photos are read as they come into sight: a long list doesn't read every photo at once.
  let seen: IntersectionObserver | null = null;
  const onSeen = new WeakMap<Element, () => void>();
  function whenSeen(node: Element, load: () => void) {
    if (typeof IntersectionObserver !== "function") { load(); return; }
    seen ??= new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen!.unobserve(e.target);
        onSeen.get(e.target)?.();
        onSeen.delete(e.target);
      }
    }, { rootMargin: "200px" });
    onSeen.set(node, load);
    seen.observe(node);
  }
  function photo(beanId: string | null | undefined, stamp: string | null | undefined, className: string) {
    const box = el("div", className);
    const fallback = el("span", "nophoto", "☕");
    fallback.setAttribute("aria-label", t.noPhoto);
    box.append(fallback);
    if (beanId && stamp !== null) {
      whenSeen(box, () => {
        void photoOf(beanId, stamp).then((src) => {
          if (!src || !fallback.isConnected) return;
          const img = el("img") as HTMLImageElement;
          img.alt = ""; img.decoding = "async"; img.src = src;
          img.onerror = () => img.replaceWith(fallback);
          fallback.replaceWith(img);
        });
      });
    }
    return box;
  }

  // ── Dropdowns: the page's own list, in its theme, instead of the system's. ──
  // A <select> stays (hidden) and keeps the value, the options and the change events the rest of the page uses; a
  // button shows it. A typed field with choices (a combo: grinder, water…) opens the same list from its arrow.
  const CHEVRON = `<svg viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  function closeDropdown() {
    document.querySelector(".dd-layer")?.remove();
    document.querySelectorAll("[data-open]").forEach((n) => { n.removeAttribute("data-open"); n.setAttribute("aria-expanded", "false"); });
  }
  type MenuItem = { label: string; value: string; selected?: boolean; disabled?: boolean; hint?: boolean };
  function openMenu(anchor: HTMLElement, toggle: HTMLElement, items: MenuItem[], onPick: (value: string) => void) {
    closeDropdown();
    const layer = el("div", "dd-layer");
    const menu = el("div", "dd-menu");
    menu.setAttribute("role", "listbox");
    for (const o of items) {
      if (o.hint) { menu.append(el("p", "dd-hint", o.label)); continue; }
      const item = el("button", "dd-item", o.label) as HTMLButtonElement;
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(!!o.selected));
      item.disabled = !!o.disabled;
      item.onclick = (e) => { e.stopPropagation(); closeDropdown(); onPick(o.value); };
      menu.append(item);
    }
    // A tap outside closes the list and does nothing else.
    layer.addEventListener("pointerdown", (e) => { if (e.target === layer) { e.preventDefault(); closeDropdown(); } });
    layer.append(menu);
    // Inside a modal dialog the list must be in the dialog to be on top.
    (anchor.closest("dialog[open]") ?? document.body).append(layer);
    toggle.setAttribute("aria-expanded", "true");
    toggle.dataset.open = "1";
    const r = anchor.getBoundingClientRect(), gap = 4, margin = 8;
    const below = innerHeight - r.bottom - gap - margin, above = r.top - gap - margin;
    const down = below >= Math.min(menu.scrollHeight, 240) || below >= above;
    menu.style.minWidth = `${r.width}px`;
    menu.style.maxHeight = `${Math.max(120, down ? below : above)}px`;
    menu.style.left = `${Math.max(margin, Math.min(r.left, innerWidth - margin - Math.max(r.width, menu.offsetWidth)))}px`;
    if (down) menu.style.top = `${r.bottom + gap}px`; else menu.style.bottom = `${innerHeight - r.top + gap}px`;
    // The gear card alone in Streamline's overlay is the whole frame: a list there uses all of its height.
    if (document.documentElement.classList.contains("gear-only")) {
      menu.style.top = `${margin}px`; menu.style.bottom = "";
      menu.style.maxHeight = `${innerHeight - 2 * margin}px`;
    }
    (menu.querySelector<HTMLElement>("[aria-selected=true]") ?? menu.firstElementChild as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
  }
  function enhanceSelect(sel: HTMLSelectElement) {
    if (sel.dataset.dd) return;
    sel.dataset.dd = "1";
    const face = el("button", "dd") as HTMLButtonElement;
    face.type = "button";
    face.setAttribute("aria-haspopup", "listbox");
    face.setAttribute("aria-expanded", "false");
    const text = el("span", "dd-text"), chevron = el("span", "dd-chevron");
    chevron.innerHTML = CHEVRON;
    face.append(text, chevron);
    sel.classList.add("dd-native");
    sel.tabIndex = -1;
    sel.after(face);
    const refresh = () => {
      face.className = ["dd", ...Array.from(sel.classList).filter((c) => c !== "dd-native"), sel.id ? `dd-${sel.id}` : ""].filter(Boolean).join(" ");
      text.textContent = sel.selectedOptions[0]?.textContent ?? "";
      face.disabled = sel.disabled;
      face.hidden = sel.hidden;
      face.title = sel.title || text.textContent;
      const label = sel.getAttribute("aria-label");
      if (label) face.setAttribute("aria-label", `${label}: ${text.textContent}`);
    };
    // Setting .value or .selectedIndex in code fires nothing: the button follows them all the same.
    for (const key of ["value", "selectedIndex"] as const) {
      const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, key)!;
      Object.defineProperty(sel, key, { configurable: true, get() { return d.get!.call(sel); }, set(v) { d.set!.call(sel, v); refresh(); } });
    }
    new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true });
    refresh();
    face.onclick = () => {
      if (face.dataset.open) { closeDropdown(); return; }
      openMenu(face, face, Array.from(sel.options).map((o) => ({ label: o.textContent ?? "", value: o.value, selected: o.selected, disabled: o.disabled })), (value) => {
        if (sel.value === value) return;
        sel.value = value;
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
  }
  // A text field with an arrow that lists choices (recent waters, Decaid's grinders, known roasters…); anything can
  // still be typed. A choice fills the field and fires input and change, as typing does.
  function combo(input: HTMLInputElement, choices: () => string[], label: string) {
    const box = el("div", "combo");
    const face = el("button", "combo-open") as HTMLButtonElement;
    face.type = "button";
    face.innerHTML = CHEVRON;
    face.setAttribute("aria-label", label);
    face.title = label;
    face.setAttribute("aria-haspopup", "listbox");
    face.setAttribute("aria-expanded", "false");
    face.onclick = () => {
      if (face.dataset.open) { closeDropdown(); return; }
      const values = choices();
      openMenu(box, face, values.length ? values.map((v) => ({ label: v, value: v, selected: same(v, input.value) }))
        : [{ label: t.noChoices, value: "", hint: true }], (value) => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };
    box.append(input, face);
    return box;
  }
  new MutationObserver((records) => {
    for (const r of records) for (const n of Array.from(r.addedNodes)) {
      if (n instanceof HTMLSelectElement) enhanceSelect(n);
      else if (n instanceof HTMLElement) n.querySelectorAll("select").forEach(enhanceSelect);
    }
  }).observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll("select").forEach(enhanceSelect);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.querySelector(".dd-layer")) { e.stopPropagation(); e.preventDefault(); closeDropdown(); } }, true);
  addEventListener("resize", closeDropdown);

  // ── Messages: the page's own dialog, in its theme, instead of the system's confirm(). ──
  // Resolves with the chosen value; Esc or a tap outside the box gives `dismiss`.
  type Choice = { label: string; value: string; kind?: string };
  function ask(text: string, choices: Choice[], dismiss: string) {
    closeDropdown();
    return new Promise<string>((resolve) => {
      const d = el("dialog", "msg") as HTMLDialogElement;
      d.setAttribute("role", "alertdialog");
      const box = el("div", "msg-box"), p = el("p", "msg-text", text), row = el("div", "msg-actions");
      let answer = dismiss;
      for (const c of choices) {
        const b = el("button", c.kind ?? "", c.label) as HTMLButtonElement;
        b.type = "button";
        b.onclick = () => { answer = c.value; d.close(); };
        row.append(b);
      }
      box.append(p, row);
      d.append(box);
      // The box fills the dialog, so a pointer on the dialog itself is on the backdrop.
      d.addEventListener("pointerdown", (e) => { if (e.target === d) { e.preventDefault(); d.close(); } });
      d.addEventListener("close", () => { d.remove(); resolve(answer); });
      document.body.append(d);
      d.showModal();
    });
  }
  const confirmIt = async (text: string, ok: string) =>
    (await ask(text, [{ label: t.cancel, value: "no", kind: "secondary" }, { label: ok, value: "yes" }], "no")) === "yes";
  const closeMessages = () => document.querySelectorAll<HTMLDialogElement>("dialog.msg").forEach((d) => d.close());

  // ── Refractometer: Decaid connects a DiFluid R2 itself and offers it as a sensor with a "measure" command. ──
  // The page is served by Decaid, so its Sensors API is on this same origin.
  const R2_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="8" y="1" width="16" height="30" rx="8" fill="currentColor" fill-opacity=".12"/><circle cx="16" cy="8" r="4.7"/><path d="M13.63 6.16A3 3 0 0 1 18.13 5.88"/><rect x="11" y="15" width="10" height="7" rx=".8" fill="currentColor" fill-opacity=".8" stroke="none"/><circle cx="16" cy="26" r="2.2"/></svg>`;
  let r2: string | null = null;
  let r2Measuring = false;
  async function findR2() {
    let read = true;
    try {
      const response = await fetch("/api/v1/sensors");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const sensors = list(await response.json());
      // Any sensor that measures TDS will do; an R2 first. Decaid's docs name the channels dataChannels, Decaid sends data.
      const fits = sensors.filter((s) => {
        const info = (s.info ?? {}) as Data;
        const channels = [...list(info.dataChannels), ...list(info.data)];
        return list(info.commands).some((c) => c.id === "measure") && channels.some((c) => c.key === "tds");
      });
      const best = fits.find((s) => /\bR2\b/i.test(str(((s.info ?? {}) as Data).name))) ?? fits[0];
      r2 = best ? str(best.id) || null : null;
    } catch (e) {
      r2 = null;
      read = false;
      say(t.r2SearchFailed.replace("{why}", e instanceof Error ? e.message : t.failed), "error");
    }
    document.querySelectorAll<HTMLButtonElement>("button.r2").forEach((b) => { b.hidden = !r2; });
    return read;
  }
  // Await the same full scan as Settings: a quick scan returns before the R2 is discovered.
  // The cooldown is for this page only, so an earlier visit cannot suppress a scan from the screensaver.
  let r2SearchedAt = 0;
  let r2Search: Promise<boolean> | null = null;
  function searchR2(): Promise<boolean> {
    if (r2Search) return r2Search;
    r2SearchedAt = Date.now();
    const pending = (async () => {
      try {
        const response = await fetch("/api/v1/devices/scan?connect=false");
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!(await findR2())) { r2SearchedAt = 0; return false; }
        // Sensor registration/connection may finish just after the scan.
        for (const wait of [1500, 3000, 4000]) {
          if (r2) break;
          await new Promise((resolve) => setTimeout(resolve, wait));
          if (!(await findR2())) { r2SearchedAt = 0; return false; }
        }
        if (r2 && !$("view-shot").hidden) say(t.r2Appeared);
        return true;
      } catch (e) {
        r2SearchedAt = 0;
        say(t.r2SearchFailed.replace("{why}", e instanceof Error ? e.message : t.failed), "error");
        return false;
      } finally {
        r2Search = null;
      }
    })();
    r2Search = pending;
    return pending;
  }
  async function searchR2IfMissing() {
    if (!(await findR2())) return;
    if (r2 || r2Measuring || r2Search || $("view-shot").hidden) return;
    try {
      if (r2SearchedAt && Date.now() - r2SearchedAt < 120000) return;
      const response = await fetch("/api/v1/machine/state");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const machine = await response.json() as Data;
      if (!["idle", "sleeping"].includes(str(((machine.state ?? {}) as Data).state))) return;
      await searchR2();
    } catch (e) {
      say(t.r2SearchFailed.replace("{why}", e instanceof Error ? e.message : t.failed), "error");
    }
  }
  async function measureR2(): Promise<number> {
    const response = await fetch(`/api/v1/sensors/${encodeURIComponent(r2 ?? "")}/execute`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ commandId: "measure", params: { timeout: 30 } }),
    });
    const value = await response.json().catch(() => ({})) as Data;
    if (!response.ok || value.status === "error") {
      throw new Error(str(value.message ?? value.error).replace(/^\w*Exception:\s*/, "") || `HTTP ${response.status}`);
    }
    const reading = ((value.result ?? {}) as Data).reading;
    const tds = num(typeof reading === "object" && reading !== null ? (reading as Data).tds : null);
    if (tds === null || tds <= 0 || tds > 30) throw new Error(t.failed);
    return tds;
  }
  // Settings: Decaid connects a sensor as soon as a Bluetooth scan finds it; there is no R2 setting in Decaid.
  async function loadR2() {
    await findR2();
    let state = "";
    try {
      const response = await fetch("/api/v1/devices");
      const devices = response.ok ? list(await response.json()) : [];
      const device = devices.find((d) => d.type === "sensor" && (str(d.id) === r2 || /\bR2\b|difluid/i.test(str(d.name))));
      state = device ? str(device.state) : "";
    } catch { /* an older Decaid */ }
    $("r2-state").textContent = state === "connected" ? t.r2Connected : r2 ? t.r2Found : t.r2None;
  }

  // ── Tabs ──
  const views = ["shot", "coffees", "settings", "ai"] as const;
  type View = typeof views[number];
  function show(view: View) {
    for (const v of views) {
      $(`view-${v}`).hidden = v !== view;
      $(`tab-${v}`).setAttribute("aria-selected", String(v === view));
    }
    $("next-coffee").hidden = view === "settings" || view === "ai";
    document.body.dataset.view = view;
    updateFooter();
    syncAddress();
    if (view === "shot") { void loadShot(); void searchR2IfMissing(); }
    if (view === "coffees") void loadCoffees();
    if (view === "settings") void loadSettings();
    if (view === "ai") void loadMcp();
  }
  // The address says what is on screen (a coffee's page by its id), so a reload opens the same place.
  function syncAddress() {
    const view = document.body.dataset.view ?? "shot";
    params.set("view", view === "coffees" && detail ? "coffee" : view);
    if (view === "coffees" && detail) params.set("id", detail.id); else params.delete("id");
    if (!wantShot) params.delete("shotId");
    try { history.replaceState(null, "", `?${params}`); } catch { /* a sandboxed frame may refuse */ }
  }

  // ── Status and the next shot's bar ──
  const onChoice = () => ["keep", "last", "best"].includes(str(status.onCoffeeChoice)) ? str(status.onCoffeeChoice) : "keep";
  const nextCoffee = () => status.coffee && typeof status.coffee === "object" ? asCoffee(status.coffee) : null;
  const nextId = () => nextCoffee()?.id ?? "";
  async function refreshStatus(quiet = false) {
    try { status = await api("status"); } catch (e) { if (!quiet) say(e instanceof Error ? e.message : t.failed, "error"); }
    renderNext();
  }
  const gearLine = (next: Data) => [str(next.grinderModel), num(next.rpm) ? t.skin.rpm.replace("{rpm}", fmt(num(next.rpm), 0)) : "", str(next.water)]
    .filter(Boolean).join(" · ");
  function renderNext() {
    const box = $("next-coffee");
    box.replaceChildren();
    const coffee = nextCoffee();
    const name = coffee?.name || str(status.coffeeName), roaster = coffee?.roaster || str(status.coffeeRoaster);
    // The coffee opens the list to choose the next shot's; the gear opens its card; × stops using the coffee.
    const pickIt = el("button", "next-pick") as HTMLButtonElement;
    pickIt.type = "button";
    pickIt.onclick = () => { void run(async () => { await openPicker("next"); }); };
    const label = el("span", "eyebrow", t.nextShot);
    if (!name) {
      const hint = el("span", "muted ellipsis", t.noCoffeeShort);
      pickIt.title = t.noCoffee;
      pickIt.append(label, hint);
    } else {
      const text = el("span", "ellipsis next-name");
      text.append(el("strong", "", name), el("span", "muted", roaster ? ` · ${roaster}` : ""));
      pickIt.title = [name, roaster].filter(Boolean).join(" · ");
      pickIt.append(label, photo(coffee?.beanId, coffee ? coffee.photo : null, "thumb"), text);
    }
    const gear = el("button", "next-gear-btn ellipsis") as HTMLButtonElement;
    gear.type = "button";
    const line = gearLine((status.next ?? {}) as Data);
    gear.textContent = line || t.gearNone;
    gear.classList.toggle("muted", !line);
    gear.title = t.nextGear;
    gear.onclick = () => { void run(openNextGear); };
    box.append(pickIt, gear);
    if (name) {
      const stop = button("✕", async () => {
        if (!(await confirmIt(t.confirmClearCoffee.replace("{name}", name), t.clearCoffee))) return;
        await api("select", { coffeeId: null });
        await refreshStatus();
        say(t.coffeeCleared);
      }, "secondary icon");
      stop.title = t.clearCoffee;
      stop.setAttribute("aria-label", t.clearCoffee);
      box.append(stop);
    }
  }

  // ── Shot view ──
  async function loadShot(afterDelete = false) {
    const root = $("shot-body");
    if (!shot) root.replaceChildren(el("p", "muted", t.loading));
    compareFor = null;
    try {
      let [value] = await Promise.all([api("shot", { offset, filter: setFilter, ...(wantShot ? { shotId: wantShot } : {}) }), loadGrinders(), loadWaters()]);
      if (wantShot) { wantShot = ""; offset = num(value.offset) ?? offset; syncAddress(); }
      // Deleting the oldest shot leaves its offset empty; show its newer neighbour instead.
      if (afterDelete && !value.shot && offset > 0) { offset--; value = await api("shot", { offset, filter: setFilter }); }
      const before = shot?.id;
      shot = value.shot && typeof value.shot === "object" ? shotFrom(value) : null;
      if (shot?.id !== before) compared = null;
      ($("older") as HTMLButtonElement).disabled = !value.older;
      ($("newer") as HTMLButtonElement).disabled = offset === 0;
      ($("latest") as HTMLButtonElement).disabled = offset === 0;
      renderShot();
    } catch (e) { root.replaceChildren(el("p", "notice error", e instanceof Error ? e.message : t.failed)); }
  }
  // A shot of any set, from a coffee's page: shown among all shots.
  function openShot(id: string) {
    wantShot = id;
    offset = 0;
    shotSet = "all";
    setFilter = {};
    ($("shot-set") as HTMLSelectElement).value = "all";
    show("shot");
  }
  // Streamline's chart: one 0–10 axis for bar, ml/s and g/s; weight and temperature at a tenth, the targets dashed,
  // each line named at its end, a dotted line where each profile step starts. Touch or drag it to read every value at
  // that second (as ReBloom's chart does).
  // `width`: the drawing's width for its 400 of height (the full-screen chart is wider); a double tap calls `onDoubleTap`.
  // `compare`: another shot's curves, drawn thin and dashed under these (its targets left out).
  function chart(series: Series, steps: Step[], options: { width?: number; onDoubleTap?: () => void; compare?: Series | null } = {}) {
    const other = options.compare && options.compare.t.length > 1 ? options.compare : null;
    const ns = "http://www.w3.org/2000/svg";
    const W = Math.round(options.width ?? 600), H = 400, L = 26, R = 84, T = 10, B = 24;
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t.curves);
    const make = (tag: string, attrs: Record<string, string | number>, text = "") => {
      const node = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      if (text) node.textContent = text;
      return node;
    };
    const values = (key: keyof Series) => (series[key] ?? []) as (number | null)[];
    const otherValues = (key: keyof Series) => ((other?.[key] ?? []) as (number | null)[]);
    const peak = Math.max(0, ...(["pressure", "flow", "weightFlow"] as const).flatMap((k) => [...values(k), ...otherValues(k)].filter((v): v is number => v !== null)));
    const top = peak > 10.5 ? Math.min(16, Math.ceil(peak)) : 10;
    const end = Math.max(5, ...series.t, ...(other?.t ?? []));
    const x = (s: number) => L + (s / end) * (W - L - R);
    const y = (v: number) => H - B - (Math.min(top * 1.02, Math.max(0, v)) / top) * (H - T - B);
    const grid = make("g", {});
    for (let v = 0; v <= top; v += top > 12 ? 2 : 1) {
      grid.append(make("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "gridline" }), make("text", { x: L - 8, y: y(v) + 4, "text-anchor": "end" }, String(v)));
    }
    const every = end > 60 ? 10 : 5;
    for (let s = 0; s <= end; s += every) {
      grid.append(make("line", { x1: x(s), x2: x(s), y1: T, y2: H - B, class: "gridline" }), make("text", { x: x(s), y: H - 6, "text-anchor": "middle" }, String(s)));
    }
    // Step changes: the first step starts with the shot, so only the ones after it get a line.
    for (const step of steps.slice(1)) {
      if (step.t <= 0 || step.t > end) continue;
      grid.append(make("line", { x1: x(step.t), x2: x(step.t), y1: T, y2: H - B, class: "step-line" }));
    }
    svg.append(grid);
    type Line = { key: keyof Series; colour: string; scale: number; target?: boolean; name?: string };
    const lines: Line[] = [
      { key: "targetTemp", colour: "var(--c-temp)", scale: 0.1, target: true },
      { key: "targetFlow", colour: "var(--c-flow)", scale: 1, target: true },
      { key: "targetPressure", colour: "var(--c-pressure)", scale: 1, target: true },
      { key: "temp", colour: "var(--c-temp)", scale: 0.1, name: "°C" },
      { key: "weight", colour: "var(--c-weight)", scale: 0.1, name: t.chartWeight },
      { key: "weightFlow", colour: "var(--c-weight-flow)", scale: 1, name: t.chartWeightFlow },
      { key: "flow", colour: "var(--c-flow)", scale: 1, name: t.chartFlow },
      { key: "pressure", colour: "var(--c-pressure)", scale: 1, name: t.chartPressure },
    ];
    const labels: { y: number; text: string; colour: string }[] = [];
    // The shot compared with, first, so this one's curves are on top.
    if (other) {
      for (const line of lines) {
        if (line.target) continue;
        let d = "";
        otherValues(line.key).forEach((v, i) => {
          if (v === null) return;
          d += `${d ? "L" : "M"}${x(other.t[i]).toFixed(1)},${y(v * line.scale).toFixed(1)}`;
        });
        if (d) svg.append(make("path", { d, style: `stroke:${line.colour}`, class: "curve compare" }));
      }
    }
    for (const line of lines) {
      // Comparing: the targets would only crowd the two shots.
      if (other && line.target) continue;
      let d = "", last: number | null = null;
      values(line.key).forEach((v, i) => {
        if (v === null) { if (line.target) d += " "; return; }
        const point = `${x(series.t[i]).toFixed(1)},${y(v * line.scale).toFixed(1)}`;
        d += `${!d || d.endsWith(" ") ? "M" : "L"}${point}`;
        last = v * line.scale;
      });
      if (!d.trim()) continue;
      svg.append(make("path", { d: d.replace(/ +/g, ""), style: `stroke:${line.colour}`, class: line.target ? "target" : "curve" }));
      if (line.name && last !== null) labels.push({ y: y(last), text: line.name, colour: line.colour });
    }
    // Names at the right end, pushed apart so they don't overlap.
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + 15);
    const overflow = labels.length ? labels[labels.length - 1].y - (H - B) : 0;
    for (const label of labels) {
      svg.append(make("text", { x: W - R + 6, y: label.y - Math.max(0, overflow) + 4, class: "end-label", style: `fill:${label.colour}` }, label.text));
    }

    // Touch read-out
    const box = el("div", "chart-box");
    box.append(svg);
    if (series.t.length < 2) return box;
    const cursor = make("g", { class: "cursor", visibility: "hidden" });
    const cursorLine = make("line", { y1: T, y2: H - B });
    cursor.append(cursorLine);
    const shown = lines.filter((l) => !l.target);
    const dots = shown.map((l) => { const dot = make("circle", { r: 4, style: `fill:${l.colour}` }); cursor.append(dot); return dot; });
    svg.append(cursor);
    const card = el("div", "readout");
    card.hidden = true;
    box.append(card);
    const rows: [keyof Series, string, string][] = [
      ["pressure", t.chartPressure, "bar"], ["flow", t.chartFlow, "ml/s"], ["weightFlow", t.chartWeightFlow, "g/s"],
      ["weight", t.chartWeight, "g"], ["temp", t.temperatureShort, "°C"],
    ];
    const colours: Partial<Record<keyof Series, string>> = Object.fromEntries(shown.map((l) => [l.key, l.colour]));
    const nearest = (time: number, ts: number[] = series.t) => {
      let lo = 0, hi = ts.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ts[mid] < time) lo = mid; else hi = mid; }
      return Math.abs(ts[lo] - time) <= Math.abs(ts[hi] - time) ? lo : hi;
    };
    const select = (clientX: number) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const vx = (clientX - rect.left) / rect.width * W;
      const i = nearest(Math.max(0, Math.min(end, (vx - L) / (W - L - R) * end)));
      const time = series.t[i], cx = x(time);
      cursor.setAttribute("visibility", "visible");
      cursorLine.setAttribute("x1", String(cx)); cursorLine.setAttribute("x2", String(cx));
      shown.forEach((l, k) => {
        const v = values(l.key)[i];
        dots[k].setAttribute("visibility", v === null || v === undefined ? "hidden" : "visible");
        if (v !== null && v !== undefined) { dots[k].setAttribute("cx", String(cx)); dots[k].setAttribute("cy", String(y(v * l.scale))); }
      });
      const step = [...steps].reverse().find((s) => s.t <= time + 0.05);
      const head = el("div", "readout-time", `${fmt(time, 1)} s`);
      if (step) head.append(el("span", "muted", ` · ${step.name || `${t.step} ${step.frame + 1}`}`));
      const rowsBox = el("div", "readout-rows");
      // Comparing: the other shot at the same second, after this one's value (nothing once it had ended).
      const j = other && time <= other.t[other.t.length - 1] + 0.3 ? nearest(time, other.t) : -1;
      if (other) {
        const head2 = el("div", "readout-row readout-cols");
        head2.append(el("span", ""), el("span", "muted", t.thisShot), el("span", "muted", t.otherShot));
        rowsBox.append(head2);
      }
      for (const [key, label, unit] of rows) {
        const v = values(key)[i];
        const w = j >= 0 ? otherValues(key)[j] : null;
        if ((v === null || v === undefined) && (w === null || w === undefined)) continue;
        const digits = key === "temp" || key === "weight" ? 1 : 2;
        const name = el("span", "", label), dot = el("i", "dot");
        dot.style.background = colours[key] ?? "";
        name.prepend(dot);
        if (other) {
          const row = el("div", "readout-row readout-cols");
          row.append(name, el("strong", "", v === null || v === undefined ? "—" : `${fmt(v, digits)} ${unit}`), el("span", "", w === null || w === undefined ? "—" : fmt(w, digits)));
          rowsBox.append(row);
          continue;
        }
        if (v === null || v === undefined) continue;
        const row = el("div", "readout-row");
        row.append(name, el("strong", "", `${fmt(v, digits)} ${unit}`));
        rowsBox.append(row);
      }
      card.replaceChildren(head, rowsBox);
      card.hidden = false;
      // The card sits on the side away from the finger.
      const left = cx / W > 0.5;
      card.classList.toggle("left", left);
      card.classList.toggle("right", !left);
    };
    let dragging = false;
    let lastTap = { at: 0, x: 0, y: 0 };
    // Touch screens send moves faster than the screen draws: the readout follows once a frame.
    let pendingX: number | null = null;
    const selectSoon = (clientX: number) => {
      if (pendingX === null) requestAnimationFrame(() => { const at = pendingX; pendingX = null; if (at !== null) select(at); });
      pendingX = clientX;
    };
    svg.addEventListener("pointerdown", (e) => {
      // Two taps within a third of a second, close together: full screen (or back).
      const now = performance.now();
      if (options.onDoubleTap && now - lastTap.at < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
        lastTap = { at: 0, x: 0, y: 0 };
        options.onDoubleTap();
        return;
      }
      lastTap = { at: now, x: e.clientX, y: e.clientY };
      dragging = true; svg.setPointerCapture(e.pointerId); select(e.clientX);
    });
    svg.addEventListener("pointermove", (e) => { if (dragging || e.pointerType === "mouse") selectSoon(e.clientX); });
    const stop = () => { dragging = false; };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    return box;
  }
  // Touch-friendly number field: − value + (the tablet's keyboard is a last resort).
  function stepper(v: number | null, step: number | (() => number), digits: number, label: string) {
    const stepNow = () => typeof step === "number" ? step : step();
    const input = el("input") as HTMLInputElement;
    input.type = "number"; input.min = "0"; input.step = typeof step === "number" ? String(step) : "any"; input.inputMode = "decimal";
    input.value = v === null ? "" : String(Math.round(v * 10 ** digits) / 10 ** digits);
    input.setAttribute("aria-label", label);
    const nudge = (direction: number) => {
      const current = Number(input.value.replace(",", ".")) || 0;
      input.value = String(Math.max(0, Math.round((current + direction * stepNow()) * 10 ** digits) / 10 ** digits));
      input.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const minus = el("button", "step", "−") as HTMLButtonElement, plus = el("button", "step", "+") as HTMLButtonElement;
    for (const [b, direction, name] of [[minus, -1, "−"], [plus, 1, "+"]] as const) {
      b.type = "button"; b.setAttribute("aria-label", `${label} ${name}`);
      b.onclick = () => nudge(direction);
    }
    const box = el("div", "stepper");
    box.append(minus, input, plus);
    return { box, input, nudge, minus, plus };
  }
  const readNum = (input: HTMLInputElement) => {
    const v = input.value.trim() === "" ? null : Number(input.value.replace(",", "."));
    return v !== null && Number.isFinite(v) ? v : null;
  };
  // A grinder: one of Decaid's (picked from the list, or typed as it is named there), or any model typed.
  function grinderInput(value: string) {
    const input = el("input") as HTMLInputElement;
    input.type = "text"; input.maxLength = 80; input.value = value; input.placeholder = t.grinderPlaceholder;
    input.autocomplete = "off"; input.setAttribute("aria-label", t.grinder);
    return { input, box: combo(input, () => grinders.map((g) => g.model), t.grinderList) };
  }
  function waterInput(value: string) {
    const input = el("input") as HTMLInputElement;
    input.type = "text"; input.maxLength = 80; input.value = value; input.placeholder = t.waterPlaceholder;
    input.autocomplete = "off"; input.setAttribute("aria-label", t.water);
    return { input, box: combo(input, () => waters, t.waterList) };
  }
  // What a grinder field says, as the plugin takes it: Decaid's grinder by its id, or a model with no id.
  const grinderPatch = (typed: string) => {
    const g = grinderNamed(typed);
    return { grinderId: g ? g.id : null, grinderModel: g ? g.model : typed.trim() || null };
  };
  function renderShot() {
    closeDropdown();
    const root = $("shot-body");
    // The shot's name and time head the right pane.
    const meta = el("div", "shot-meta");
    unsaved = false;
    saveShot = null;
    root.replaceChildren();
    // A cleaning or calibration run has nothing to load.
    $("load-this").hidden = !shot?.brew;
    if (!shot) { root.append(el("p", "empty", t.noShots)); updateFooter(); return; }
    const s = shot;
    // "Same coffee" needs a coffee on the shot on screen (unless that set is the one being walked).
    for (const o of Array.from(($("shot-set") as HTMLSelectElement).options)) {
      o.disabled = (o.value === "coffee" || o.value === "both") && !s.beanId && !s.coffeeName && shotSet !== o.value;
    }
    meta.append(el("strong", "ellipsis", s.profile || "—"), el("span", "muted", date(s.timestamp, true)));
    // The profile's beverage type, when it isn't espresso (filter, other, cleaning, calibration).
    if (s.kind && s.kind !== "espresso") meta.append(el("span", "pill kind", (t.kinds as Record<string, string>)[s.kind] ?? s.kind));
    // Decaid's Visualizer plugin uploaded it: its page there.
    if (str(s.visualizerId)) {
      meta.append(outside(`https://visualizer.coffee/shots/${encodeURIComponent(str(s.visualizerId))}`, t.openVisualizer, "button secondary small visualizer", t.openVisualizerTitle));
    }
    // The shot as text for any AI chat; what the page shows (unsaved edits aside) is what Decaid has.
    if (s.brew) {
      const copyIt = button(t.copyForAi, async () => {
        const value = await api("shot-text", { shotId: s.id, when: date(s.timestamp, true) });
        await copyText(str(value.text));
      }, "secondary small copy-ai");
      copyIt.title = t.copyForAiTitle;
      meta.append(copyIt);
    }
    const remove = button("", async () => {
      const question = t.confirmDeleteShot.replace("{profile}", s.profile || "—").replace("{when}", date(s.timestamp, true));
      const answer = await ask(question, [
        { label: t.cancel, value: "no", kind: "secondary" },
        { label: t.deleteShot, value: "yes", kind: "secondary discard" },
      ], "no");
      if (answer !== "yes") return;
      await api("delete-shot", { shotId: s.id, confirmed: true });
      unsaved = false;
      saveShot = null;
      shot = null;
      compared = null;
      compareFor = null;
      showNewerShot(false);
      renderShot();
      await loadShot(true);
      say(t.shotDeleted);
    }, "secondary small delete-shot");
    remove.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2-10h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
    remove.title = t.deleteShot;
    remove.setAttribute("aria-label", t.deleteShot);
    meta.append(remove);
    // Left: the curves, about half the width.
    const left = el("div", "panel chart-wrap");
    if (s.series.t.length > 1) {
      const legend = el("div", "legend");
      for (const [cls, label] of [["p", t.pressure], ["f", t.flow], ["wf", t.weightFlow], ["w", t.weight], ["c", t.temperature], ["dash", t.targets], ["dots", t.stepsKey]]) legend.append(el("span", `key ${cls}`, label));
      const expand = el("button", "chart-expand", "⤢") as HTMLButtonElement;
      expand.type = "button"; expand.title = t.fullScreen; expand.setAttribute("aria-label", t.fullScreen);
      expand.onclick = () => openFullChart(s);
      const slot = el("div", "chart-slot");
      // The drawing is kept while its curves are the same (a save draws the shot again with the same series): 9 lines
      // of 240 points aren't drawn again for a new score.
      const draw = () => {
        const compare = compared?.series ?? null;
        if (!chartDrawn || chartDrawn.series !== s.series || chartDrawn.compare !== compare) {
          chartDrawn = { series: s.series, compare, node: chart(s.series, s.steps ?? [], { onDoubleTap: () => { if (shot) openFullChart(shot); }, compare }) };
        }
        slot.replaceChildren(chartDrawn.node);
      };
      draw();
      // Compare with another shot of the same set: drawn thin and dashed under this one.
      const pick = el("select", "compare-select") as HTMLSelectElement;
      pick.setAttribute("aria-label", t.compareWith);
      const none = el("option", "", t.compareWith) as HTMLOptionElement;
      none.value = "";
      pick.append(none);
      const compareKey = el("span", "key cmp");
      compareKey.hidden = !compared;
      if (compared) compareKey.textContent = `${t.comparedWith} ${date(compared.timestamp, true)}`;
      void compareListOf(s).then((value) => {
        for (const o of list(value.shots)) {
          const opt = el("option", "", [date(o.timestamp, true), str(o.profile), str(o.coffeeName), num(o.score) !== null ? `★ ${num(o.score)}` : ""].filter(Boolean).join(" · ")) as HTMLOptionElement;
          opt.value = str(o.id);
          pick.append(opt);
        }
        if (compared) pick.value = compared.id;
      }).catch(() => { /* the list is a convenience */ });
      pick.onchange = () => { void run(async () => {
        compared = pick.value ? shotFrom(await api("shot-by-id", { shotId: pick.value })) : null;
        compareKey.hidden = !compared;
        compareKey.textContent = compared ? `${t.comparedWith} ${date(compared.timestamp, true)}` : "";
        draw();
      }); };
      legend.append(compareKey);
      left.append(expand, slot, legend, pick);
    } else left.append(el("p", "muted", t.noCurves));

    // Right: coffee, numbers, rating. A cleaning or calibration run has nothing to rate.
    if (!s.brew) {
      const side = el("div", "shot-side");
      side.append(meta, el("p", "not-brew", (t.notABrew as Record<string, string>)[s.kind] ?? ""));
      root.append(left, side);
      updateFooter();
      return;
    }
    const right = el("div", "shot-side");
    const coffeeRow = el("div", "panel coffee-row");
    if (s.coffeeId || s.coffeeName) {
      const text = el("div", "grow ellipsis");
      text.append(el("strong", "", s.coffeeName || "—"), el("span", "muted", s.coffeeRoaster ? ` · ${s.coffeeRoaster}` : ""));
      // The photo's stamp is the coffee's in the list; a coffee not in it (finished, say) is read without one.
      const known = coffees.find((c) => c.id === s.coffeeId || (!!s.beanId && c.beanId === s.beanId));
      coffeeRow.append(photo(s.beanId, known ? known.photo : undefined, "thumb"), text);
    } else coffeeRow.append(el("div", "grow muted", t.noCoffeeOnShot));
    coffeeRow.append(button(s.coffeeId || s.coffeeName ? t.change : t.chooseCoffee, async () => { if (await leaveShot()) await openPicker("shot"); }, s.coffeeId || s.coffeeName ? "secondary small" : "small"));

    const doseField = stepper(s.dose, 0.1, 1, t.dose), yieldField = stepper(s.yield, 0.1, 1, t.yield);
    const tdsField = stepper(s.tds, 0.01, 2, t.tds), eyField = stepper(s.ey, 0.1, 1, t.ey);
    const doseIn = doseField.input, yieldIn = yieldField.input, tds = tdsField.input, ey = eyField.input;
    const ratioOut = el("output", "", "—");
    const refreshRatio = () => {
      const d = readNum(doseIn), y = readNum(yieldIn);
      ratioOut.textContent = d && y ? `1:${fmt(y / d, 1)}` : "—";
    };
    const facts = el("div", "numbers panel");
    const cell = (label: string, node: Node, wide = false) => {
      // Not a <label>: tapping a caption would press the cell's first button (its −).
      const c = el("div", wide ? "cell wide" : "cell");
      c.append(el("span", "label", label), node);
      facts.append(c);
      return c;
    };
    cell(`${t.dose} (g)`, doseField.box);
    cell(`${t.yield} (g)`, yieldField.box);
    const tdsCell = cell(t.tds, tdsField.box);
    cell(t.ey, eyField.box);

    // Grinder: one of Decaid's or a typed model; its setting and RPM step by that grinder's steps.
    const grinderStart = grinderText(s.grinderId, s.grinderModel);
    const grinder = grinderInput(grinderStart);
    const grinderNow = () => grinderNamed(grinder.input.value) ?? (grinder.input.value.trim() === grinderStart && s.grinderId ? grinders.find((g) => g.id === s.grinderId) ?? null : null);
    const presets = () => {
      const g = grinderNow();
      return g?.settingType === "preset" ? g.settingValues : [];
    };
    const decimals = (step: number) => Math.min(3, (String(step).split(".")[1] ?? "").length);
    const grindField = stepper(null, 1, 0, t.grind);
    const grindIn = grindField.input;
    grindIn.type = "text"; grindIn.maxLength = 60; grindIn.value = s.grind; grindIn.inputMode = "decimal";
    grindIn.removeAttribute("min"); grindIn.removeAttribute("step");
    // A preset grinder steps through its positions; a numeric one by its small step (0.1 when it has none).
    const nudgeGrind = (direction: number) => {
      const values = presets();
      const current = grindIn.value.trim();
      if (values.length) {
        const i = values.indexOf(current);
        grindIn.value = values[Math.max(0, Math.min(values.length - 1, i < 0 ? 0 : i + direction))];
      } else {
        const value = current === "" ? 0 : Number(current.replace(",", "."));
        if (!Number.isFinite(value)) return;
        const step = grinderNow()?.settingSmallStep || 0.1, d = decimals(step);
        grindIn.value = String(Math.max(0, Math.round((value + direction * step) * 10 ** d) / 10 ** d));
      }
      grindIn.dispatchEvent(new Event("input", { bubbles: true }));
    };
    grindField.minus.onclick = () => nudgeGrind(-1);
    grindField.plus.onclick = () => nudgeGrind(1);
    const rpmField = stepper(s.rpm, () => grinderNow()?.rpmSmallStep || 10, 0, t.rpm);
    const rpmIn = rpmField.input;
    rpmIn.inputMode = "numeric";
    cell(t.grinder, grinder.box, true);
    cell(t.grind, grindField.box);
    cell(t.rpm, rpmField.box);

    // Water: free text, with the waters typed before to pick from.
    const waterStart = str(s.water);
    const water = waterInput(waterStart);
    cell(t.water, water.box, true);

    const readouts = el("div", "readouts");
    for (const [label, node] of [[t.ratio, ratioOut], [t.time, el("output", "", s.duration === null ? "—" : `${fmt(s.duration, 0)} s`)]] as const) {
      const r = el("span");
      r.append(el("span", "muted", `${label} `), node);
      readouts.append(r);
    }
    facts.append(readouts);

    // TDS and EY: one follows the other (EY = TDS × yield ÷ dose). Empty or 0 means no reading.
    let last: "tds" | "ey" = s.tds === null && s.ey ? "ey" : "tds";
    const relink = () => {
      refreshRatio();
      const d = readNum(doseIn), y = readNum(yieldIn);
      if (!d || !y) return;
      if (last === "tds") { const v = readNum(tds); ey.value = v ? (Math.round(v * y / d * 10) / 10).toString() : ""; }
      else { const v = readNum(ey); tds.value = v ? (Math.round(v * d / y * 100) / 100).toString() : ""; }
    };
    doseIn.oninput = relink; yieldIn.oninput = relink;
    tds.oninput = () => { last = "tds"; relink(); };
    ey.oninput = () => { last = "ey"; relink(); };
    relink();

    // R2 next to TDS (what it measures): the reading fills TDS (EY follows); like any edit, it is kept on Done.
    const r2Button = el("button", "r2") as HTMLButtonElement;
    r2Button.type = "button";
    r2Button.innerHTML = R2_ICON;
    r2Button.title = t.r2Measure;
    r2Button.setAttribute("aria-label", t.r2Measure);
    r2Button.hidden = !r2;
    r2Button.onclick = async () => {
      if (r2Measuring || !r2) return;
      r2Measuring = true;
      r2Button.disabled = true;
      r2Button.classList.add("measuring");
      try {
        say(t.r2Measuring);
        const value = await measureR2();
        if (!tds.isConnected) return;
        tds.value = String(Math.round(value * 100) / 100);
        tds.dispatchEvent(new Event("input", { bubbles: true }));
        say(t.r2Reading.replace("{tds}", fmt(value, 2)));
      } catch (e) {
        say(t.r2Failed.replace("{why}", e instanceof Error ? e.message : t.failed), "error");
      } finally {
        r2Measuring = false;
        r2Button.disabled = false;
        r2Button.classList.remove("measuring");
      }
    };
    // Beside the "TDS %" caption, so the field keeps its width.
    tdsCell.append(r2Button);

    // Rating
    const form = el("div", "panel rate");
    let score = s.score;
    let balance = s.balance;
    const scoreRow = el("div", "score-row");
    const scoreValue = el("output", "score-value", score === null ? t.noScore : String(score));
    const range = el("input") as HTMLInputElement;
    // Steps of 5, as Rebloom's: a drag goes 60 → 65 → 70. A score saved between steps (87) is shown as it is
    // until the slider moves.
    range.type = "range"; range.min = "0"; range.max = "100"; range.step = "5"; range.value = String(score ?? 80);
    range.setAttribute("aria-label", t.score);
    const ticks = el("div", "score-ticks");
    for (let v = 0; v <= 100; v += 5) ticks.append(el("i", v % 10 === 0 ? "major" : ""));
    const slider = el("div", "score-slider");
    slider.append(range, ticks);
    // The number and the slider take the score's colour.
    const paintScore = () => {
      scoreRow.style.setProperty("--h", String(score === null ? 210 : scoreHue(score)));
      scoreRow.classList.toggle("unscored", score === null);
    };
    range.oninput = () => { score = Number(range.value); scoreValue.textContent = String(score); paintScore(); };
    scoreRow.append(el("span", "label", t.score), scoreValue, slider);
    paintScore();
    // Taste and body side by side on one line, each a row of joined buttons.
    const tasteRow = el("div", "taste-row");
    const group = (label: string) => {
      const g = el("div", "tb-group"), seg = el("div", "seg");
      g.append(el("span", "label", label), seg);
      tasteRow.append(g);
      return seg;
    };
    const tasteSeg = group(t.taste);
    const tastes = ["sour", "balanced", "bitter"] as const;
    const tasteButtons = tastes.map((value) => {
      const b = el("button", "toggle", t[value]) as HTMLButtonElement;
      b.type = "button";
      b.setAttribute("aria-pressed", String(balance === value));
      b.onclick = () => {
        balance = balance === value ? null : value;
        tasteButtons.forEach((x, i) => x.setAttribute("aria-pressed", String(balance === tastes[i])));
      };
      tasteSeg.append(b);
      return b;
    });
    let body = s.body;
    const bodySeg = group(t.body);
    const bodies = ["thin", "medium", "heavy"] as const;
    const bodyButtons = bodies.map((value) => {
      const b = el("button", "toggle", t.bodies[value]) as HTMLButtonElement;
      b.type = "button";
      b.setAttribute("aria-pressed", String(body === value));
      b.onclick = () => {
        body = body === value ? null : value;
        bodyButtons.forEach((x, i) => x.setAttribute("aria-pressed", String(body === bodies[i])));
      };
      bodySeg.append(b);
      return b;
    });
    const notes = el("textarea") as HTMLTextAreaElement;
    notes.value = s.notes; notes.rows = 4; notes.maxLength = 10000; notes.placeholder = t.notesPlaceholder;
    notes.setAttribute("aria-label", t.notes);
    const extra = el("div", "extra-row");
    const notesBox = el("label", "grow");
    notesBox.append(el("span", "label", t.notes), notes);
    extra.append(notesBox);
    // Saves the edits (Done in the footer): true once they are stored.
    saveShot = async () => {
      const d = readNum(doseIn), y = readNum(yieldIn);
      const tdsRaw = readNum(tds), eyRaw = readNum(ey);
      const tdsValue = tdsRaw && tdsRaw > 0 ? Math.round(tdsRaw * 100) / 100 : null;
      const eyValue = eyRaw && eyRaw > 0 ? Math.round(eyRaw * 10) / 10 : null;
      const rpmRaw = readNum(rpmIn);
      const rpmValue = rpmRaw && rpmRaw > 0 ? Math.round(rpmRaw) : null;
      if (!d || !y || d > 200 || y > 2000 || (tdsValue !== null && tdsValue > 30) || (eyValue !== null && eyValue > 100) || (rpmValue !== null && rpmValue > 5000)) { say(t.badNumbers, "error"); return false; }
      const patch: Data = { shotId: s.id, score, balance, body };
      // Only when changed: notes from another app may be longer than this field takes, and are left as they are.
      if (notes.value !== s.notes) patch.notes = notes.value;
      // A reading is sent only when there is one; an empty or 0 field clears a reading the shot had, else it says nothing.
      if (tdsValue !== null) patch.tds = tdsValue; else if (s.tds !== null) patch.tds = null;
      if (eyValue !== null) patch.ey = eyValue; else if (s.ey !== null) patch.ey = null;
      if (s.dose === null || Math.abs(d - s.dose) > 0.001) patch.dose = d;
      if (s.yield === null || Math.abs(y - s.yield) > 0.001) patch.yield = y;
      if (grinder.input.value.trim() !== grinderStart.trim()) Object.assign(patch, grinderPatch(grinder.input.value));
      if (grindIn.value.trim() !== s.grind) patch.grind = grindIn.value.trim() || null;
      if (rpmValue !== s.rpm) patch.rpm = rpmValue;
      if (water.input.value.trim() !== waterStart.trim()) patch.water = water.input.value.trim() || null;
      shot = shotFrom(await api("rate-shot", patch), s);
      // A water typed here is one of the recent ones now.
      if (patch.water) watersAt = 0;
      renderShot();
      say(t.saved);
      return true;
    };
    const touched = () => {
      unsaved = true;
      updateFooter();
    };
    for (const part of [facts, form]) {
      part.addEventListener("input", touched);
      part.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest(".toggle,.step")) touched(); });
    }
    form.append(scoreRow, tasteRow, extra);
    right.append(meta, coffeeRow, facts, form);
    root.append(left, right);
    updateFooter();
  }
  // ── The chart on the whole screen: double tap, × or Esc to close. ──
  function openFullChart(s: Shot) {
    closeFullChart();
    const box = el("div", "full-chart");
    box.id = "full-chart";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", t.curves);
    const head = el("div", "full-head");
    const title = el("div", "grow ellipsis");
    title.append(el("strong", "", s.profile || "—"), el("span", "muted", `  ${date(s.timestamp, true)}`));
    const close = el("button", "secondary chart-close", "×") as HTMLButtonElement;
    close.type = "button"; close.title = t.close; close.setAttribute("aria-label", t.close);
    close.onclick = closeFullChart;
    head.append(title, close);
    const legend = el("div", "legend");
    for (const [cls, label] of [["p", t.pressure], ["f", t.flow], ["wf", t.weightFlow], ["w", t.weight], ["c", t.temperature], ["dash", t.targets], ["dots", t.stepsKey]]) legend.append(el("span", `key ${cls}`, label));
    const area = el("div", "full-area");
    box.append(head, area, legend);
    document.body.append(box);
    // As wide as the screen allows for the drawing's 400 of height.
    const rect = area.getBoundingClientRect();
    const width = Math.max(600, Math.min(1400, 400 * rect.width / Math.max(200, rect.height)));
    area.append(chart(s.series, s.steps ?? [], { width, onDoubleTap: closeFullChart, compare: shot?.id === s.id ? compared?.series ?? null : null }));
    document.addEventListener("keydown", escClose);
  }
  function escClose(e: KeyboardEvent) { if (e.key === "Escape") closeFullChart(); }
  function closeFullChart() {
    document.getElementById("full-chart")?.remove();
    document.removeEventListener("keydown", escClose);
  }

  // ── Coffee picker (dialog) ──
  async function openPicker(target: "next" | "shot") {
    pickFor = target;
    await ensureCoffees();
    // Each time a fresh list: no search or filter left over from the last choice.
    ($("picker-search") as HTMLInputElement).value = "";
    for (const key of Object.keys(pickerFilter)) delete pickerFilter[key];
    renderFilters();
    ($("picker-finished") as HTMLInputElement).checked = showFinished;
    $("picker-hint").hidden = target !== "next";
    renderPicker();
    const d = $("picker") as HTMLDialogElement;
    if (!d.open) d.showModal();
    $("picker-list").scrollTop = 0;
  }
  // A tap on a coffee for the next shot does what Settings → "When I choose a coffee" says; holding it asks, this once.
  function holdToAsk(node: HTMLElement, c: Coffee, enabled: () => boolean, onHeld: () => void, chosen: (how: string) => Promise<void>) {
    let timer: ReturnType<typeof setTimeout> | undefined, x = 0, y = 0;
    const stop = () => { clearTimeout(timer); timer = undefined; };
    node.addEventListener("pointerdown", (e) => {
      stop();
      if (!enabled() || busy) return;
      x = e.clientX; y = e.clientY;
      timer = setTimeout(() => {
        timer = undefined;
        onHeld();
        void askHow(c).then((how) => { if (how) void run(() => chosen(how)); });
      }, 600);
    });
    node.addEventListener("pointermove", (e) => { if (timer && Math.hypot(e.clientX - x, e.clientY - y) > 10) stop(); });
    for (const type of ["pointerup", "pointerleave", "pointercancel"]) node.addEventListener(type, stop);
    // No browser menu on a long press.
    node.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  // Current settings, its last shot's or its best shot's: the usual one (Settings) stands out. "" when cancelled.
  function askHow(c: Coffee) {
    const usual = onChoice();
    return ask(t.holdChoose.replace("{name}", c.name), [
      { label: t.cancel, value: "", kind: "secondary" },
      ...([["keep", t.holdKeep], ["last", t.holdLast], ["best", t.holdBest]] as const)
        .map(([value, label]) => ({ label, value, kind: value === usual ? "" : "secondary" })),
    ], "");
  }
  function renderPicker() {
    const box = $("picker-list");
    box.replaceChildren();
    const query = ($("picker-search") as HTMLInputElement).value;
    $("picker-clear").hidden = !narrowed(query, pickerFilter);
    const shown = matching(query, pickerFilter);
    if (!shown.length) { box.append(el("p", "empty", coffees.length ? t.noMatches : t.emptyShelf)); return; }
    for (const c of withFinishedLast(shown)) box.append(cardFor(c, true));
  }
  // Coffees with coffee left first (the next shot's first of all); finished ones (when asked for) after them, greyed.
  const withFinishedLast = (all: Coffee[]) => [...nextFirst(all.filter((c) => !c.finished)), ...all.filter((c) => c.finished)];
  // What choosing did, in words: the settings it kept, or the shot whose settings came with it.
  function chosenSaid(c: Coffee, how: string, value: Data) {
    if (how === "keep") return t.coffeeSet.replace("{name}", c.name);
    const loaded = value.loaded ?? value.loadedShot ?? null;
    if (!loaded) return t.coffeeSetNoShot.replace("{name}", c.name);
    const at = typeof loaded === "object" ? str((loaded as Data).timestamp) : "";
    const when = at ? t.whenSuffix.replace("{when}", date(at, true)) : "";
    return (how === "best" ? t.coffeeSetBest : t.coffeeSetLast).replace("{name}", c.name).replace("{when}", when);
  }
  // The next shot's coffee, with the settings the user's choice (or Settings) says. Returns the chosen coffee.
  async function chooseNext(c: Coffee, how?: string) {
    const value = await api("choose-coffee", { coffeeId: c.id, ...(how ? { settings: how } : {}) });
    // A coffee without a bag got one: the list has a new card.
    if (!c.batchId) coffeesLoaded = false;
    await refreshStatus();
    say(chosenSaid(c, how ?? onChoice(), value));
    return value.coffee && typeof value.coffee === "object" ? asCoffee(value.coffee) : c;
  }
  async function pick(c: Coffee, how?: string) {
    if (pickFor === "shot" && shot) {
      const s = shot;
      shot = shotFrom(await api("assign-coffee", { shotId: s.id, coffeeId: c.id }), s);
      if (!c.batchId) coffeesLoaded = false;
      ($("picker") as HTMLDialogElement).close();
      renderShot();
      say(t.coffeeAssigned);
    } else {
      ($("picker") as HTMLDialogElement).close();
      await chooseNext(c, how);
      if (pickOnly) { pickOnly = false; closeOverlay(); }
    }
  }

  // ── Coffees ──
  // Every bag of coffee is a card; finished ones too when asked. The filters sit on the search line.
  let showFinished = false;
  // The Coffees list and the picker search and filter apart, so a filter left on one doesn't hide coffees on the other.
  const coffeeFilter: Record<string, string> = {};
  const pickerFilter: Record<string, string> = {};
  const FILTERS: [string, string, (c: Coffee) => string[]][] = [
    ["origin", t.filterCountry, (c) => [c.country]], ["process", t.filterProcess, (c) => [c.process]],
    ["variety", t.filterVariety, (c) => c.varieties], ["roaster", t.filterRoaster, (c) => [c.roaster]],
  ];
  const matching = (query: string, filter: Record<string, string>) => {
    const q = query.trim().toLocaleLowerCase(locale);
    return coffees.filter((c) => (!q || [c.name, c.roaster, c.country, c.region, c.process, c.producer, c.farm, c.tastingNotes, ...c.varieties]
      .some((v) => v.toLocaleLowerCase(locale).includes(q))) &&
      FILTERS.every(([key, , values]) => !filter[key] || values(c).some((v) => v.trim() === filter[key])));
  };
  const narrowed = (query: string, filter: Record<string, string>) => !!query.trim() || Object.values(filter).some(Boolean);
  // Clear: the search and every filter of that list at once.
  function clearFilters(search: string, filter: Record<string, string>, render: () => void) {
    ($(search) as HTMLInputElement).value = "";
    for (const key of Object.keys(filter)) delete filter[key];
    renderFilters();
    render();
  }
  function asCoffee(v: unknown): Coffee {
    const o = (v && typeof v === "object" ? v : {}) as Data;
    const opt = (x: unknown) => str(x) || null;
    return {
      id: str(o.id), beanId: str(o.beanId), batchId: opt(o.batchId), roaster: str(o.roaster), name: str(o.name),
      country: str(o.country), region: str(o.region), producer: str(o.producer), farm: str(o.farm),
      varieties: Array.isArray(o.varieties) ? o.varieties.map(str).filter(Boolean) : [],
      altitude: Array.isArray(o.altitude) ? o.altitude.map(num).filter((n): n is number => n !== null) : [],
      process: str(o.process), decaf: o.decaf === true, tastingNotes: str(o.tastingNotes), link: str(o.link), photo: opt(o.photo),
      roastDate: opt(o.roastDate), roastLevel: str(o.roastLevel), weight: num(o.weight), remaining: num(o.remaining),
      frozen: o.frozen === true, freezeDate: opt(o.freezeDate), thawDate: opt(o.thawDate), openDate: opt(o.openDate),
      bestBefore: opt(o.bestBefore), bagNotes: str(o.bagNotes), finished: o.finished === true, createdAt: str(o.createdAt),
    };
  }
  async function ensureCoffees(force = false) {
    if (coffeesLoaded && !force) return;
    const value = await api("coffees", { includeFinished: showFinished });
    coffees = list(value.coffees).map(asCoffee).filter((c) => c.id);
    coffeesLoaded = true;
    renderFilters();
    void offerOldBags();
  }
  // ── Old bags: a long imported list is offered for finishing once, the bags with grams left unticked. ──
  let oldBagsOffered = false;
  async function offerOldBags() {
    if (oldBagsOffered) return;
    oldBagsOffered = true;
    let bags: { coffee: Coffee; lastDate: string | null }[];
    try { bags = list((await api("old-bags")).bags).map((o) => ({ coffee: asCoffee(o), lastDate: str(o.lastDate) || null })).filter((x) => x.coffee.id); }
    catch { return; /* asked again next time the page opens */ }
    if (!bags.length) return;
    closeDropdown();
    const d = el("dialog", "msg old-bags") as HTMLDialogElement;
    const box = el("div", "msg-box"), rows = el("div", "old-list"), actions = el("div", "msg-actions");
    const chosen = new Set<string>();
    const finish = el("button", "", "") as HTMLButtonElement;
    finish.type = "button";
    const count = () => { finish.textContent = t.oldBagsFinish.replace("{n}", String(chosen.size)); finish.disabled = !chosen.size; };
    for (const { coffee: c, lastDate } of bags) {
      const row = el("label", "old-row"), sw = el("input", "sw") as HTMLInputElement;
      sw.type = "checkbox";
      sw.checked = !(c.remaining && c.remaining > 0);
      if (sw.checked) chosen.add(c.id);
      sw.onchange = () => { if (sw.checked) chosen.add(c.id); else chosen.delete(c.id); count(); };
      const name = el("span", "old-name", [c.roaster, c.name].filter(Boolean).join(" · "));
      const facts = [lastDate ? date(lastDate) : t.oldBagsNoDate, c.remaining && c.remaining > 0 ? t.oldBagsLeft.replace("{g}", String(c.remaining)) : ""];
      row.append(sw, name, el("span", "old-when muted", facts.filter(Boolean).join(" · ")));
      rows.append(row);
    }
    let finished = false;
    const keep = el("button", "secondary", t.oldBagsKeep) as HTMLButtonElement;
    keep.type = "button";
    keep.onclick = () => d.close();
    finish.onclick = () => { void run(async () => {
      const value = await api("finish-old-bags", { ids: [...chosen], confirmed: true });
      finished = true;
      d.close();
      say(t.oldBagsDone.replace("{n}", String(num(value.finished) ?? 0)));
      await ensureCoffees(true);
      renderCoffees();
      if (($("picker") as HTMLDialogElement).open) renderPicker();
    }); };
    count();
    actions.append(keep, finish);
    box.append(el("h2", "", t.oldBagsTitle), el("p", "msg-text", t.oldBagsText.replace("{n}", String(bags.length))), rows, actions);
    d.append(box);
    // Kept all (the button or Esc): not asked again. A tap beside the box does nothing, so it isn't lost by accident.
    d.addEventListener("close", () => {
      d.remove();
      if (!finished) void api("finish-old-bags", { ids: [] }).catch(() => { /* asked again next time */ });
    });
    document.body.append(d);
    d.showModal();
  }
  function renderFilters() {
    fillFilters($("coffee-filters"), coffeeFilter, renderCoffees);
    fillFilters($("picker-filters"), pickerFilter, renderPicker);
  }
  function fillFilters(box: HTMLElement, filter: Record<string, string>, render: () => void) {
    box.replaceChildren();
    for (const [key, label, of] of FILTERS) {
      const values = [...new Set(coffees.flatMap((c) => of(c).map((v) => v.trim())).filter(Boolean))].sort((a, b) => a.localeCompare(b, locale));
      if (values.length < 2 && !filter[key]) continue;
      const sel = el("select") as HTMLSelectElement;
      sel.setAttribute("aria-label", label);
      const any = el("option", "", label) as HTMLOptionElement;
      any.value = "";
      sel.append(any, ...values.map((v) => { const o = el("option", "", v) as HTMLOptionElement; o.value = v; return o; }));
      sel.value = values.includes(filter[key] ?? "") ? filter[key] : "";
      sel.classList.toggle("active", !!sel.value);
      sel.onchange = () => { filter[key] = sel.value; sel.classList.toggle("active", !!sel.value); render(); };
      box.append(sel);
    }
  }
  // Red to green, as the grams bar: a share from 0 to 1 gives a hue; scores run 50 (red) to 100 (green).
  const hue = (share: number) => Math.round(Math.max(0, Math.min(1, share)) * 125);
  const scoreHue = (score: number) => hue((score - 50) / 50);
  // "10 Sep", with the year when it isn't this year's.
  const shortDate = (value: unknown) => {
    const d = new Date(`${str(value).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(locale, { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  };
  const longDate = (value: unknown) => str(value) ? date(`${str(value).slice(0, 10)}T12:00:00`) : "";
  // What's left in a bag, and its share of the bag as bought (when its weight is known).
  const amountLeft = (c: Coffee) => {
    if (c.remaining === null) return null;
    const share = c.weight && c.weight > 0 ? Math.max(0, Math.min(1, c.remaining / c.weight)) : null;
    return { text: c.weight ? `${fmt(c.remaining, 0)} / ${fmt(c.weight, 0)} g` : `${fmt(c.remaining, 0)} g ${t.remaining}`, share };
  };
  // The coffee for the next shot comes first.
  const nextFirst = (all: Coffee[]) => {
    const id = nextId();
    return id ? [...all.filter((c) => c.id === id), ...all.filter((c) => c.id !== id)] : all;
  };
  // What's left and its bar, from red (empty) to green (full): on the cards and on a coffee's page.
  function stockLine(amount: { text: string; share: number | null }) {
    const stock = el("div", "stock");
    stock.append(el("span", "stock-text", amount.text));
    if (amount.share !== null) {
      const bar = el("div", "stock-bar"), fill = el("i");
      fill.style.width = `${Math.round(amount.share * 100)}%`;
      fill.style.background = `hsl(${hue(amount.share)} 62% 44%)`;
      bar.append(fill);
      stock.append(bar);
    }
    return stock;
  }
  // Roasted, and the freezer: in it since, or out since.
  function bagDates(c: Coffee) {
    const dates = el("div", "card-dates");
    if (c.roastDate) dates.append(el("span", "", `${t.roasted} ${shortDate(c.roastDate)}`));
    if (c.frozen) dates.append(el("span", "frozen", c.freezeDate ? `❄ ${shortDate(c.freezeDate)}` : `❄ ${t.frozen}`));
    else if (c.thawDate) dates.append(el("span", "", `${t.thawed} ${shortDate(c.thawDate)}`));
    return dates;
  }
  function card(c: Coffee, picking = false) {
    const node = el("button", "card");
    node.type = "button";
    const current = nextId() === c.id;
    if (current) node.classList.add("current");
    if (c.finished) node.classList.add("finished");
    const body = el("div", "card-body");
    body.append(el("div", "eyebrow", c.roaster || t.unknownRoaster), el("strong", "name", c.name));
    const meta = [c.country, c.process].filter(Boolean).join(" · ");
    if (meta) body.append(el("div", "muted", meta));
    const amount = amountLeft(c);
    if (amount) body.append(stockLine(amount));
    const dates = bagDates(c);
    if (dates.childNodes.length) body.append(dates);
    const badges = el("div", "badges");
    if (current) badges.append(el("span", "badge ok", `✓ ${t.nextShot}`));
    if (c.decaf) badges.append(el("span", "badge", t.decafBadge));
    if (c.finished) badges.append(el("span", "badge", t.finished));
    if (badges.childNodes.length) body.append(badges);
    node.append(photo(c.beanId, c.photo, "photo"), body);
    // A long press already asked: the click that ends it does nothing.
    let held = false;
    if (picking) holdToAsk(node, c, () => pickFor === "next", () => { held = true; }, (how) => pick(c, how));
    node.onclick = () => { if (held) { held = false; return; } void run(async () => { if (picking) await pick(c); else await openDetail(c.id); }); };
    return node;
  }
  // A card is made once per coffee and list, and reused while the coffee (replaced as a whole on each load) and the
  // coffee for the next shot stay the same: typing in a search filters the cards instead of drawing every one again.
  const cards = { list: new WeakMap<Coffee, { current: boolean; node: HTMLElement }>(), pick: new WeakMap<Coffee, { current: boolean; node: HTMLElement }>() };
  function cardFor(c: Coffee, picking = false) {
    const cache = picking ? cards.pick : cards.list;
    const current = nextId() === c.id;
    const known = cache.get(c);
    if (known && known.current === current) return known.node;
    const node = card(c, picking);
    cache.set(c, { current, node });
    return node;
  }
  async function loadCoffees(force = false) {
    const grid = $("grid");
    if (!coffeesLoaded || force) grid.replaceChildren(el("p", "muted", t.loading));
    try { await ensureCoffees(force); renderCoffees(); } catch (e) { grid.replaceChildren(el("p", "notice error", e instanceof Error ? e.message : t.failed)); }
  }
  function renderCoffees() {
    if (detail) return;
    const grid = $("grid");
    grid.replaceChildren();
    const query = ($("search") as HTMLInputElement).value;
    $("coffee-clear").hidden = !narrowed(query, coffeeFilter);
    const shown = matching(query, coffeeFilter);
    if (!shown.length) { grid.append(el("p", "empty", coffees.length ? t.noMatches : t.emptyShelf)); return; }
    for (const c of withFinishedLast(shown)) grid.append(cardFor(c));
  }

  // ── A coffee's page: its photo and details, its bags, its shots. ──
  let detailTicket = 0;
  function closeDetail() {
    detail = null;
    detailTicket++;
    $("coffee-detail").hidden = true;
    $("coffee-list").hidden = false;
    updateFooter();
    syncAddress();
    renderCoffees();
  }
  async function openDetail(id: string) {
    const ticket = ++detailTicket;
    detail = coffees.find((c) => c.id === id) ?? asCoffee({ id });
    $("coffee-list").hidden = true;
    const root = $("coffee-detail");
    root.hidden = false;
    root.replaceChildren(el("p", "muted", t.loading));
    updateFooter();
    syncAddress();
    try {
      const value = await api("coffee", { id });
      if (ticket !== detailTicket) return;
      renderDetail(value);
    } catch (e) {
      if (ticket === detailTicket) root.replaceChildren(el("p", "notice error", e instanceof Error ? e.message : t.failed));
    }
  }
  function renderDetail(value: Data) {
    const c = asCoffee(value.coffee);
    detail = c;
    syncAddress();
    const root = $("coffee-detail");
    root.replaceChildren();
    const top = el("div", "detail-top");
    const info = el("div", "grow detail-info");
    // The coffee's name opens the roaster's page, when there is one.
    const page = https(c.link);
    const title = el("h2", "");
    if (page) title.append(outside(page, `${c.name} ↗`, "coffee-link", t.productPage));
    else title.textContent = c.name;
    info.append(el("div", "eyebrow", c.roaster || t.unknownRoaster), title);
    const facts = el("dl", "facts");
    const amount = amountLeft(c);
    const rows: [string, string | HTMLElement][] = [
      [t.origin, [c.country, c.region].filter(Boolean).join(", ")], [t.producer, c.producer], [t.farm, c.farm],
      [t.altitude, c.altitude.length ? `${c.altitude.map((a) => fmt(a, 0)).join("–")} m` : ""],
      [t.variety, c.varieties.join(", ")], [t.process, c.process], [t.decaf, c.decaf ? "✓" : ""], [t.roast, c.roastLevel],
      [t.roastDate, longDate(c.roastDate)],
      // The freezer: in since (❄ while still in), and out since.
      [t.frozen, c.freezeDate ? `${c.frozen ? "❄ " : ""}${longDate(c.freezeDate)}` : c.frozen ? "❄" : ""],
      [t.thawed, !c.frozen && c.thawDate ? longDate(c.thawDate) : ""],
      [t.opened, longDate(c.openDate)], [t.bestBefore, longDate(c.bestBefore)],
      [t.remainingLabel, amount ? stockLine(amount) : ""],
    ];
    for (const [k, v] of rows) {
      if (!v) continue;
      const d = el("div"), dd = el("dd");
      dd.append(v);
      d.append(el("dt", "", k), dd);
      facts.append(d);
    }
    info.append(facts);
    if (c.tastingNotes) { const n = el("div", "tasting"); n.append(el("strong", "", t.tasting), el("p", "", c.tastingNotes)); info.append(n); }
    const actions = el("div", "actions");
    if (nextId() === c.id) actions.append(el("span", "pill ok", `✓ ${t.nextShot}`));
    else {
      // A tap does what Settings says; holding it asks, as in the picker.
      let held = false;
      const use = button(t.useForNext, async () => {
        if (held) { held = false; return; }
        const chosen = await chooseNext(c);
        await openDetail(chosen.id || c.id);
      });
      holdToAsk(use, c, () => true, () => { held = true; }, async (how) => { const chosen = await chooseNext(c, how); await openDetail(chosen.id || c.id); });
      actions.append(use);
    }
    actions.append(button(t.edit, async () => { openForm("edit", c, async (saved) => { await openDetail(saved.id); }); }, "secondary"));
    // A bag's freezer and finished state; a coffee without a bag has neither.
    const bagChange = (fields: Data, said: string) => async () => {
      const saved = asCoffee((await api("save-coffee", { id: c.id, fields })).coffee);
      coffeesLoaded = false;
      say(said);
      await openDetail(saved.id || c.id);
    };
    if (c.batchId) {
      actions.append(button(c.frozen ? t.thaw : t.freeze, bagChange({ frozen: !c.frozen }, c.frozen ? t.thawedSaid : t.frozenSaid), "secondary"));
      const done = button(c.finished ? t.markNotFinished : t.markFinished, bagChange({ finished: !c.finished }, c.finished ? t.unfinishedSaid : t.finishedSaid), "secondary");
      if (!c.finished) done.title = t.markFinishedTitle;
      actions.append(done);
    }
    info.append(actions);
    top.append(photo(c.beanId, c.photo, "hero"), info);

    // The bean's bags, newest first, finished ones last; and this coffee's shots. Side by side, each scrolling on its own.
    const bagsBox = el("section", "recipes coffee-bags");
    const bagsHead = el("h3", "with-action", t.bags);
    bagsHead.append(button(`+ ${t.addBag}`, async () => { openForm("bag", c, async (saved) => { await openDetail(saved.id); }); }, "secondary small"));
    bagsBox.append(bagsHead);
    const bags = list(value.bags).map(asCoffee).filter((b) => b.batchId);
    if (!bags.length) bagsBox.append(el("p", "muted", t.noBags));
    for (const b of withFinishedLast(bags)) {
      const row = el("div", `recipe bag${b.id === c.id ? " shown" : ""}${b.finished ? " finished" : ""}`);
      const text = el("div", "grow");
      const head = el("div", "suggestion-head");
      head.append(el("strong", "", b.roastDate ? `${t.roasted} ${shortDate(b.roastDate)}` : t.noBagDate));
      if (b.roastLevel) head.append(el("span", "muted", b.roastLevel));
      if (b.id === c.id) head.append(el("span", "badge", t.thisBag));
      if (nextId() === b.id) head.append(el("span", "badge ok", `✓ ${t.nextShot}`));
      if (b.frozen) head.append(el("span", "badge frozen", `❄ ${t.frozen}`));
      if (b.finished) head.append(el("span", "badge", t.finished));
      text.append(head);
      const left = amountLeft(b);
      if (left) text.append(stockLine(left));
      if (b.bagNotes) text.append(el("div", "muted small", b.bagNotes));
      row.append(text);
      if (b.id !== c.id) {
        text.classList.add("tappable");
        text.onclick = () => { void run(() => openDetail(b.id)); };
      }
      if (!b.finished && nextId() !== b.id) {
        const tools = el("div", "actions");
        tools.append(button(t.useBag, async () => { await chooseNext(b); await openDetail(c.id); }, "secondary"));
        row.append(tools);
      }
      bagsBox.append(row);
    }

    // This coffee's shots on the tablet, newest first: Last and Best marked, each one's settings loadable for the next shot.
    const pulled = el("section", "recipes coffee-shots");
    pulled.append(el("h3", "", t.coffeeShots));
    const shots = list(value.shots).filter((x) => !["cleaning", "calibration"].includes(str(x.kind)));
    if (!shots.length) pulled.append(el("p", "muted", t.noCoffeeShots));
    const scored = shots.filter((x) => num(x.score) !== null);
    const lastId = str(value.last) || str(shots[0]?.id);
    const bestId = str(value.best) || str(scored.reduce<Data | null>((a, b) => !a || num(b.score)! > num(a.score)! ? b : a, null)?.id);
    for (const x of shots) {
      const id = str(x.id);
      const row = el("div", "recipe");
      const text = el("div", "grow tappable");
      text.title = t.openShotTitle;
      text.onclick = () => openShot(id);
      const head = el("div", "suggestion-head");
      head.append(el("strong", "", date(x.timestamp, true)));
      if (id === lastId) head.append(el("span", "badge", t.lastShotBadge));
      if (id === bestId) head.append(el("span", "badge ok", `✓ ${t.bestShotBadge}`));
      if (num(x.score) !== null) {
        const sc = el("span", "badge scored", `★ ${num(x.score)}`);
        sc.style.setProperty("--h", String(scoreHue(num(x.score)!)));
        head.append(sc);
      }
      const stop = num(x.targetYield) ?? num(x.yield);
      text.append(head, el("div", "muted", [
        str(x.profile), num(x.dose) !== null ? `${fmt(num(x.dose))} g` : "", stop !== null ? `→ ${fmt(stop)} g` : "",
        str(x.grind) ? `${t.grind} ${str(x.grind)}${str(x.grinder) ? ` (${str(x.grinder)})` : ""}` : "",
      ].filter(Boolean).join(" · ")));
      const tools = el("div", "actions");
      tools.append(button(t.loadSettings, async () => {
        if (!(await confirmIt(t.confirmLoadShot.replace("{when}", date(x.timestamp, true)), t.loadSettings))) return;
        await api("load-shot", { shotId: id, coffeeId: c.id });
        await refreshStatus();
        say(t.loadedShot);
      }, id === lastId || id === bestId ? "" : "secondary"));
      row.append(text, tools);
      pulled.append(row);
    }
    const cols = el("div", "detail-cols");
    cols.append(bagsBox, pulled);
    root.append(top, cols);
  }

  // ── Add / edit a coffee, or add a bag to one: a dialog of three columns that fits without scrolling. ──
  const BAG_KEYS = ["roastDate", "roastLevel", "weight", "remaining", "frozen", "freezeDate", "thawDate", "openDate", "bestBefore", "bagNotes"];
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const day = (v: unknown) => /^\d{4}-\d{2}-\d{2}/.test(str(v)) ? str(v).slice(0, 10) : "";
  const known = (of: (c: Coffee) => string, extra: string[] = []) => {
    const seenNames = new Map<string, string>();
    for (const v of [...extra, ...coffees.map(of)]) { const k = v.trim().toLocaleLowerCase(locale); if (k && !seenNames.has(k)) seenNames.set(k, v.trim()); }
    return [...seenNames.values()].sort((a, b) => a.localeCompare(b, locale));
  };
  // A photo from the camera or the gallery, made small enough for Decaid's store: at most 800 px on its long edge, JPEG.
  async function resizePhoto(file: File): Promise<string> {
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(t.photoFailed));
      reader.readAsDataURL(file);
    });
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error(t.photoFailed)); img.src = source; });
    const scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = el("canvas") as HTMLCanvasElement;
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(t.photoFailed);
    // A transparent PNG would turn black as a JPEG.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    // The plugin refuses more than 600 000 characters: a busy photo goes down in quality until it fits.
    for (const quality of [0.8, 0.65, 0.5, 0.35]) {
      const out = canvas.toDataURL("image/jpeg", quality);
      if (out.length <= 590000) return out;
    }
    throw new Error(t.errors.photoTooLarge);
  }
  type FormMode = "new" | "edit" | "bag";
  function openForm(mode: FormMode, base: Coffee | null, saved: (c: Coffee) => Promise<void>, cancelled?: () => void) {
    closeDropdown();
    const d = el("dialog", `form-dialog${mode === "bag" ? " bag-only" : ""}`) as HTMLDialogElement;
    d.id = "coffee-form";
    const head = el("div", "dialog-head");
    const cancel = el("button", "secondary", t.cancel) as HTMLButtonElement, save = el("button", "", t.save) as HTMLButtonElement;
    cancel.type = save.type = "button";
    head.append(el("h2", "", mode === "new" ? t.formNew : mode === "edit" ? t.formEdit : t.formBag.replace("{name}", base?.name ?? "")), cancel, save);
    const inputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
    const field = (col: HTMLElement, label: string, node: HTMLElement, wide = false) => {
      const f = el("div", wide ? "field wide" : "field");
      f.append(el("span", "label", label), node);
      col.append(f);
    };
    const input = (key: string, label: string, value: string, type = "text", placeholder = "") => {
      const i = el("input") as HTMLInputElement;
      i.type = type; i.value = value; i.placeholder = placeholder; i.autocomplete = "off";
      if (type === "text") i.maxLength = 120;
      if (type === "number") { i.min = "0"; i.step = "any"; i.inputMode = "decimal"; }
      i.setAttribute("aria-label", label);
      inputs[key] = i;
      return i;
    };
    const area = (key: string, label: string, value: string, placeholder = "") => {
      const a = el("textarea") as HTMLTextAreaElement;
      a.value = value; a.placeholder = placeholder; a.rows = 3; a.maxLength = 2000;
      a.setAttribute("aria-label", label);
      inputs[key] = a;
      return a;
    };
    const toggle = (key: string, label: string, on: boolean) => {
      const box = el("label", "switch-field");
      const i = el("input") as HTMLInputElement;
      i.type = "checkbox"; i.className = "sw"; i.checked = on;
      inputs[key] = i;
      box.append(i, el("span", "", label));
      return box;
    };
    const b = base ?? asCoffee({});
    const bagBase = mode === "bag" ? asCoffee({}) : b;
    // Coffee
    const coffeeCol = el("div", "form-col coffee-col");
    coffeeCol.append(el("h3", "", t.groupCoffee));
    field(coffeeCol, t.roaster, combo(input("roaster", t.roaster, b.roaster), () => known((c) => c.roaster), t.roaster));
    field(coffeeCol, t.name, input("name", t.name, b.name));
    field(coffeeCol, t.country, combo(input("country", t.country, b.country), () => known((c) => c.country), t.country));
    field(coffeeCol, t.region, input("region", t.region, b.region));
    field(coffeeCol, t.producer, input("producer", t.producer, b.producer));
    field(coffeeCol, t.farm, input("farm", t.farm, b.farm));
    field(coffeeCol, t.varieties, input("varieties", t.varieties, b.varieties.join(", "), "text", t.varietiesPlaceholder));
    field(coffeeCol, `${t.altitude} (m)`, input("altitude", t.altitude, b.altitude.join("-"), "text", t.altitudePlaceholder));
    field(coffeeCol, t.process, combo(input("process", t.process, b.process), () => known((c) => c.process, t.processes), t.process));
    field(coffeeCol, " ", toggle("decaf", t.decaf, b.decaf));
    // Bag
    const bagCol = el("div", "form-col bag-col");
    bagCol.append(el("h3", "", t.groupBag));
    field(bagCol, t.roastDate, input("roastDate", t.roastDate, day(bagBase.roastDate), "date"));
    field(bagCol, t.roastLevel, combo(input("roastLevel", t.roastLevel, bagBase.roastLevel), () => known((c) => c.roastLevel, t.roastLevels), t.roastLevel));
    field(bagCol, t.bagWeight, input("weight", t.bagWeight, bagBase.weight === null ? "" : String(bagBase.weight), "number"));
    field(bagCol, t.bagRemaining, input("remaining", t.bagRemaining, bagBase.remaining === null ? "" : String(bagBase.remaining), "number", mode === "edit" ? "" : t.bagRemainingPlaceholder));
    field(bagCol, " ", toggle("frozen", t.inFreezer, bagBase.frozen), true);
    field(bagCol, t.freezeDate, input("freezeDate", t.freezeDate, day(bagBase.freezeDate), "date"));
    field(bagCol, t.thawDate, input("thawDate", t.thawDate, day(bagBase.thawDate), "date"));
    field(bagCol, t.openDate, input("openDate", t.openDate, day(bagBase.openDate), "date"));
    field(bagCol, t.bestBefore, input("bestBefore", t.bestBefore, day(bagBase.bestBefore), "date"));
    field(bagCol, t.bagNotes, area("bagNotes", t.bagNotes, bagBase.bagNotes), true);
    // Into the freezer or out of it: the day is today unless one is typed.
    inputs.frozen.addEventListener("change", () => {
      const on = (inputs.frozen as HTMLInputElement).checked;
      if (on && !inputs.freezeDate.value) inputs.freezeDate.value = today();
      if (!on && bagBase.frozen && !inputs.thawDate.value) inputs.thawDate.value = today();
    });
    // Photo and notes
    const photoCol = el("div", "form-col photo-col");
    photoCol.append(el("h3", "", t.groupPhoto));
    // undefined: the photo stays as it is; null: removed; a data URL: the new one.
    let newPhoto: string | null | undefined;
    const preview = el("div", "photo-edit");
    const removeIt = el("button", "secondary small", t.photoRemove) as HTMLButtonElement;
    removeIt.type = "button";
    const showPhoto = (src: string | null) => {
      preview.replaceChildren();
      removeIt.hidden = !src;
      if (src) { const img = el("img") as HTMLImageElement; img.alt = ""; img.src = src; preview.append(img); }
      else { const none = el("span", "nophoto", "☕"); none.setAttribute("aria-label", t.noPhoto); preview.append(none); }
    };
    showPhoto(null);
    if (mode === "edit" && b.beanId && b.photo) void photoOf(b.beanId, b.photo).then((src) => { if (newPhoto === undefined) showPhoto(src); });
    removeIt.onclick = () => { newPhoto = null; showPhoto(null); };
    const photoButtons = el("div", "actions photo-actions");
    for (const [label, camera] of [[t.photoCamera, true], [t.photoGallery, false]] as const) {
      const file = el("input") as HTMLInputElement;
      file.type = "file"; file.accept = "image/*"; file.hidden = true;
      if (camera) file.setAttribute("capture", "environment");
      file.onchange = () => {
        const chosen = file.files?.[0];
        file.value = "";
        if (chosen) void run(async () => { newPhoto = await resizePhoto(chosen); showPhoto(newPhoto); });
      };
      const open = el("button", "secondary small", label) as HTMLButtonElement;
      open.type = "button";
      open.onclick = () => file.click();
      photoButtons.append(open, file);
    }
    photoButtons.append(removeIt);
    photoCol.append(preview, photoButtons);
    field(photoCol, t.tastingNotes, area("tastingNotes", t.tastingNotes, b.tastingNotes, t.tastingPlaceholder), true);
    field(photoCol, t.link, input("link", t.link, b.link, "url", "https://…"), true);
    const cols = el("div", "form-cols");
    cols.append(coffeeCol, bagCol, photoCol);
    d.append(head, cols);

    const text = (key: string) => inputs[key].value.trim() || null;
    const checked = (key: string) => (inputs[key] as HTMLInputElement).checked;
    const grams = (key: string) => {
      const raw = inputs[key].value.trim();
      if (!raw) return null;
      const v = Number(raw.replace(",", "."));
      return Number.isFinite(v) && v >= 0 && v <= 100000 ? Math.round(v * 10) / 10 : NaN;
    };
    const read = (): Data => ({
      roaster: text("roaster"), name: text("name"), country: text("country"), region: text("region"),
      producer: text("producer"), farm: text("farm"),
      varieties: inputs.varieties.value.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean),
      // "1,800" is a thousand and eight hundred metres, not one point eight.
      altitude: (inputs.altitude.value.replace(/(\d)[.,](?=\d{3}\b)/g, "$1").match(/\d+/g) ?? []).map(Number).slice(0, 2),
      process: text("process"), decaf: checked("decaf"), tastingNotes: text("tastingNotes"), link: text("link"),
      roastDate: text("roastDate"), roastLevel: text("roastLevel"), weight: grams("weight"), remaining: grams("remaining"),
      frozen: checked("frozen"), freezeDate: text("freezeDate"), thawDate: text("thawDate"), openDate: text("openDate"),
      bestBefore: text("bestBefore"), bagNotes: text("bagNotes"),
    });
    const original: Data = {
      roaster: b.roaster || null, name: b.name || null, country: b.country || null, region: b.region || null,
      producer: b.producer || null, farm: b.farm || null, varieties: b.varieties, altitude: b.altitude, process: b.process || null,
      decaf: b.decaf, tastingNotes: b.tastingNotes || null, link: b.link || null, roastDate: day(b.roastDate) || null,
      roastLevel: b.roastLevel || null, weight: b.weight, remaining: b.remaining, frozen: b.frozen, freezeDate: day(b.freezeDate) || null,
      thawDate: day(b.thawDate) || null, openDate: day(b.openDate) || null, bestBefore: day(b.bestBefore) || null, bagNotes: b.bagNotes || null,
    };
    // An empty list clears, as an empty field does.
    const sent = (v: unknown) => Array.isArray(v) && !v.length ? null : v;
    // Editing: only what changed (null clears); adding: only what is filled in.
    const changed = (now: Data) => Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(original[k])).map(([k, v]) => [k, sent(v)]));
    const filled = (now: Data, keys?: string[]) => Object.fromEntries(Object.entries(now)
      .filter(([k, v]) => (!keys || keys.includes(k)) && v !== null && v !== false && !(Array.isArray(v) && !v.length)));

    let closedBySave = false;
    cancel.onclick = () => d.close();
    d.addEventListener("close", () => { d.remove(); closeDropdown(); if (!closedBySave) cancelled?.(); });
    save.onclick = () => { void run(async () => {
      const now = read();
      if (mode !== "bag" && (!now.roaster || !now.name)) { say(t.errors.missingName, "error"); return; }
      if (Number.isNaN(now.weight) || Number.isNaN(now.remaining)) { say(t.badBagNumbers, "error"); return; }
      if (now.link && !https(now.link)) { say(t.badLink, "error"); return; }
      let result: Coffee;
      if (mode === "bag") {
        result = asCoffee((await api("add-bag", { beanId: b.beanId, fields: filled(now, BAG_KEYS) })).coffee);
      } else if (mode === "edit") {
        const fields = changed(now);
        result = Object.keys(fields).length ? asCoffee((await api("save-coffee", { id: b.id, fields })).coffee) : b;
      } else {
        const fields = filled(now);
        let value = await api("save-coffee", { fields });
        // That roaster and name are already a coffee here: a new bag of it, or a coffee of its own.
        const twins = list(value.duplicates).map(asCoffee).filter((x, i, all) => x.beanId && all.findIndex((y) => y.beanId === x.beanId) === i).slice(0, 3);
        if (twins.length) {
          const first = twins[0];
          const answer = await ask(t.duplicateAsk.replace("{name}", first.name).replace("{roaster}", first.roaster || t.unknownRoaster), [
            { label: t.cancel, value: "", kind: "secondary" },
            { label: t.saveNew, value: "new", kind: "secondary" },
            ...twins.map((x) => ({
              label: t.addBagTo.replace("{name}", twins.length > 1 ? `${x.name} (${shortDate(x.roastDate ?? x.createdAt)})` : x.name),
              value: `bean:${x.beanId}`,
            })),
          ], "");
          if (!answer) return;
          const target = twins.find((x) => `bean:${x.beanId}` === answer);
          value = await api("save-coffee", target ? { fields, addToBeanId: target.beanId } : { fields, saveNew: true });
          // A new bag of a coffee that has its photo keeps that photo.
          if (target?.photo) newPhoto = undefined;
        }
        result = asCoffee(value.coffee);
      }
      if (newPhoto !== undefined && result.beanId) {
        const value = await api("set-photo", { beanId: result.beanId, photo: newPhoto });
        forgetPhoto(result.beanId);
        const stamp = value.coffee && typeof value.coffee === "object" ? asCoffee(value.coffee).photo : null;
        if (newPhoto && stamp) photoCache.set(`${result.beanId}|${stamp}`, Promise.resolve(newPhoto));
        result = { ...result, photo: stamp };
      }
      coffeesLoaded = false;
      closedBySave = true;
      d.close();
      say(mode === "bag" ? t.bagAdded.replace("{name}", result.name) : t.coffeeSaved);
      await saved(result);
    }); };
    document.body.append(d);
    d.showModal();
    (mode === "bag" ? inputs.roastDate : mode === "new" ? inputs.roaster : null)?.focus();
  }

  // ── Settings ──
  async function saveSettings(patch: Data) {
    const response = await fetch("./settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (!response.ok) throw new Error(t.settingsFailed);
    await reloaded();
  }
  // Decaid reloads the plugin after a settings change: its answers wait until it is back.
  async function reloaded() {
    await new Promise((r) => setTimeout(r, 1200));
    for (let i = 0; i < 4; i++) {
      try { status = await api("status"); renderNext(); return; } catch { await new Promise((r) => setTimeout(r, 800)); }
    }
  }
  async function loadSettings() {
    await refreshStatus();
    ($("on-choice") as HTMLSelectElement).value = onChoice();
    ($("visualizer-notes") as HTMLInputElement).checked = status.visualizerNotes === true;
    $("version").textContent = t.version.replace("{version}", str(status.version));
    // The status may not carry it: the preferences do.
    if (typeof status.visualizerNotes !== "boolean") {
      void api("preferences").then((value) => {
        ($("visualizer-notes") as HTMLInputElement).checked = ((value.preferences ?? {}) as Data).visualizerNotes === true;
      }).catch(() => { /* the switch stays as it is */ });
    }
    void loadR2();
  }
  async function updatePreferences(patch: Data) {
    const value = await api("update-preferences", patch);
    const preferences = (value.preferences ?? {}) as Data;
    if (str(preferences.onCoffeeChoice)) status.onCoffeeChoice = preferences.onCoffeeChoice;
    if (typeof preferences.visualizerNotes === "boolean") status.visualizerNotes = preferences.visualizerNotes;
    await reloaded();
    say(t.saved);
  }

  // ── AI assistants (MCP) ──
  let mcp: Data = {}, mcpShown = false, mcpPublicShown = false;
  const mcpHelps: Record<string, string> = { off: "", read: t.mcpReadHelp, shots: t.mcpShotsHelp, full: t.mcpFullHelp };
  const level = (v: unknown) => ["read", "shots", "full"].includes(str(v)) ? str(v) : "off";
  // 32 random bytes, base64url: the plugin only accepts bjm_ and 32+ such characters.
  const newMcpToken = () => `bjm_${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  const masked = (token: string) => `${token.slice(0, 4)}${"•".repeat(12)}`;
  const connectorUrl = (token: string) => `${str(mcp.publicUrl)}?token=${token}`;
  const mcpPath = () => str(mcp.path) || "/api/v1/plugins/bean-journal.reaplugin/mcp";
  let lanHost: string | null | undefined;
  async function tabletHost() {
    if (lanHost !== undefined) return lanHost;
    try {
      const ip = str((await (await fetch("/api/v1/info")).json()).localIp);
      lanHost = /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !ip.startsWith("127.") ? `${ip}:${location.port || "80"}` : null;
    } catch { lanHost = null; }
    return lanHost;
  }
  async function loadMcp() {
    try {
      mcp = await api("mcp");
      const home = level(mcp.access), away = level(mcp.publicAccess);
      ($("mcp-access") as HTMLSelectElement).value = home;
      ($("mcp-public-access") as HTMLSelectElement).value = away;
      ($("mcp-confirm") as HTMLSelectElement).value = str(mcp.confirm) || "changes";
      ($("mcp-public-url") as HTMLInputElement).value = str(mcp.publicUrl);
      $("mcp-level-help").textContent = mcpHelps[home];
      $("mcp-public-help").textContent = away === "off" ? t.mcpPublicHelp : mcpHelps[away];
      $("mcp-box").hidden = home === "off";
      $("mcp-public-box").hidden = away === "off";
      $("mcp-connector-row").hidden = away === "off" || !str(mcp.publicUrl);
      $("mcp-shared").hidden = home === "off" && away === "off";
      // On the tablet the page is at localhost: Decaid's info names the tablet's address on the network.
      const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
      const host = local ? await tabletHost() : location.host;
      $("mcp-url").textContent = `http://${host ?? location.host}${mcpPath()}`;
      $("mcp-localhost").hidden = !!host;
      // What a computer with Tailscale forwards: only this path, to the tablet's address on the home network.
      const target = `http://${host ?? "<tablet-ip>:8080"}${mcpPath()}`;
      // Funnel is serve made public: one path, one of the two.
      $("mcp-serve").textContent = `tailscale ${away !== "off" ? "funnel" : "serve"} --bg --set-path /bean-journal ${target}`;
      showMcpTokens();
    } catch (e) { $("mcp-level-help").textContent = e instanceof Error ? e.message : t.failed; }
  }
  function showMcpTokens() {
    const token = str(mcp.token), publicToken = str(mcp.publicToken);
    $("mcp-token").textContent = mcpShown ? token : masked(token);
    $("mcp-show").textContent = mcpShown ? t.mcpHide : t.mcpShow;
    $("mcp-connector").textContent = connectorUrl(mcpPublicShown ? publicToken : masked(publicToken));
    $("mcp-public-show").textContent = mcpPublicShown ? t.mcpHide : t.mcpShow;
  }
  // The page is often opened at the tablet's plain-http address, where the clipboard API is missing.
  async function copyText(value: string) {
    try { await navigator.clipboard.writeText(value); } catch {
      const box = el("textarea");
      box.value = value;
      document.body.append(box);
      box.select();
      document.execCommand("copy");
      box.remove();
    }
    say(t.copied);
  }

  // ── Wiring ──
  // Leaving the shot (another tab, another shot) asks first when it has unsaved edits. The Coffees tab, tapped on a
  // coffee's page, goes back to the list.
  for (const v of views) {
    $(`tab-${v}`).onclick = async () => {
      if (!$("view-shot").hidden && !(await leaveShot())) return;
      if (v === "coffees" && detail) closeDetail();
      show(v);
    };
  }
  $("older").onclick = async () => { if (!(await leaveShot())) return; offset++; void loadShot(); };
  $("newer").onclick = async () => { if (!(await leaveShot())) return; offset = Math.max(0, offset - 1); void loadShot(); };
  $("latest").onclick = async () => { if (!(await leaveShot())) return; offset = 0; void loadShot(); };
  // The shot on screen, for the next one: its profile, dose, yield, grinder, grind, RPM and water; the next coffee stays.
  // The page's unsaved edits are saved first, so what loads is what the page shows.
  $("load-this").onclick = () => { void run(async () => {
    const s = shot;
    if (!s?.brew || !(await confirmIt(t.confirmLoadThis.replace("{profile}", s.profile || "—"), t.loadThis))) return;
    if (unsaved && saveShot && !(await saveShot())) return;
    await api("load-shot", { shotId: s.id });
    // In the skin, back to its dashboard, which shows what was loaded.
    if (fromSkin) { closeOverlay(); return; }
    await refreshStatus();
    say(t.loadedThis.replace("{profile}", s.profile || "—"));
  }); };
  // A set is taken from the shot on screen, then walked from its newest.
  $("shot-set").onchange = async () => {
    const sel = $("shot-set") as HTMLSelectElement;
    if (!(await leaveShot())) { sel.value = shotSet; return; }
    shotSet = sel.value as ShotSet;
    setFilter = filterFor(shotSet, shot);
    sel.title = [str(setFilter.coffeeName) || (setFilter.beanId ? shot?.coffeeName ?? "" : ""), str(setFilter.profileTitle)].filter(Boolean).join(" · ");
    offset = 0;
    compared = null;
    void loadShot();
  };
  $("search").oninput = renderCoffees;
  $("picker-search").oninput = renderPicker;
  $("coffee-clear").onclick = () => clearFilters("search", coffeeFilter, renderCoffees);
  $("picker-clear").onclick = () => clearFilters("picker-search", pickerFilter, renderPicker);
  $("picker-finished").onchange = () => { void run(async () => {
    showFinished = ($("picker-finished") as HTMLInputElement).checked;
    ($("show-finished") as HTMLInputElement).checked = showFinished;
    await ensureCoffees(true);
    renderPicker();
  }); };
  $("show-finished").onchange = () => { void run(async () => {
    showFinished = ($("show-finished") as HTMLInputElement).checked;
    await loadCoffees(true);
  }); };
  $("add-coffee").onclick = () => openForm("new", null, async (c) => { await ensureCoffees(true); if (!$("view-coffees").hidden) await openDetail(c.id); });
  // From the picker: the new coffee is the one picked; cancelled, the list comes back.
  $("picker-add").onclick = () => {
    const target = pickFor;
    ($("picker") as HTMLDialogElement).close();
    openForm("new", null, async (c) => { pickFor = target; await ensureCoffees(true); await pick(c); }, () => { void run(() => openPicker(target)); });
  };
  $("picker-close").onclick = () => {
    ($("picker") as HTMLDialogElement).close();
    // Opened straight from the skin's button: closing the list closes the overlay too.
    if (pickOnly) { pickOnly = false; closeOverlay(); }
  };
  // Esc closes the list as Close does.
  $("picker").addEventListener("cancel", () => { if (pickOnly) { pickOnly = false; closeOverlay(); } });
  $("act-back").onclick = () => closeDetail();
  $("on-choice").onchange = () => { void run(async () => { await updatePreferences({ onCoffeeChoice: ($("on-choice") as HTMLSelectElement).value }); }); };
  $("visualizer-notes").onchange = () => { void run(async () => {
    const box = $("visualizer-notes") as HTMLInputElement;
    try { await updatePreferences({ visualizerNotes: box.checked }); } catch (e) { box.checked = !box.checked; throw e; }
  }); };
  $("r2-search").onclick = () => { void run(async () => {
    $("r2-state").textContent = t.r2Searching;
    const searched = await searchR2();
    await loadR2();
    if (searched && !r2) say(t.r2None, "error");
  }); };
  // A level on for the first time comes with its token; off keeps the token for next time.
  $("mcp-access").onchange = () => { void run(async () => {
    const access = ($("mcp-access") as HTMLSelectElement).value;
    await saveSettings({ McpAccess: access, ...(access !== "off" && !str(mcp.token) ? { McpToken: newMcpToken() } : {}) });
    await loadMcp();
  }); };
  $("mcp-public-access").onchange = () => { void run(async () => {
    const access = ($("mcp-public-access") as HTMLSelectElement).value;
    await saveSettings({ McpPublicAccess: access, ...(access !== "off" && !str(mcp.publicToken) ? { McpPublicToken: newMcpToken() } : {}) });
    await loadMcp();
  }); };
  $("mcp-confirm").onchange = () => { void run(async () => { await saveSettings({ McpConfirm: ($("mcp-confirm") as HTMLSelectElement).value }); await loadMcp(); }); };
  $("mcp-public-save").onclick = () => { void run(async () => {
    const url = ($("mcp-public-url") as HTMLInputElement).value.trim().replace(/\/+$/, "");
    if (url && !/^https:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i.test(url)) { say(t.mcpPublicBad, "error"); return; }
    await saveSettings({ McpPublicUrl: url || null });
    await loadMcp();
  }); };
  $("mcp-show").onclick = () => { mcpShown = !mcpShown; showMcpTokens(); };
  $("mcp-public-show").onclick = () => { mcpPublicShown = !mcpPublicShown; showMcpTokens(); };
  $("mcp-copy-url").onclick = () => { void run(() => copyText($("mcp-url").textContent || "")); };
  $("mcp-copy-token").onclick = () => { void run(() => copyText(str(mcp.token))); };
  $("mcp-copy-connector").onclick = () => { void run(() => copyText(connectorUrl(str(mcp.publicToken)))); };
  $("mcp-copy-serve").onclick = () => { void run(() => copyText($("mcp-serve").textContent || "")); };
  $("mcp-new").onclick = () => { void run(async () => {
    if (!(await confirmIt(t.confirmMcpNewToken, t.mcpNewToken))) return;
    await saveSettings({ McpToken: newMcpToken() });
    await loadMcp();
  }); };
  $("mcp-public-new").onclick = () => { void run(async () => {
    if (!(await confirmIt(t.confirmMcpNewToken, t.mcpNewToken))) return;
    await saveSettings({ McpPublicToken: newMcpToken() });
    await loadMcp();
  }); };

  // ── The next shot's grinder, speed and water: stock Streamline's Grind line opens this (?view=next). ──
  let gearOnly = false;
  async function openNextGear() {
    closeDropdown();
    const d = el("dialog", "msg next-gear") as HTMLDialogElement;
    const alone = document.documentElement.classList.contains("gear-only");
    const loaded = refreshStatus(alone).then(() => Promise.all([loadGrinders(), loadWaters()]));
    loaded.catch(() => { /* awaited below */ });
    // Alone in the overlay the card shows at once and is filled when the lists are in: its size doesn't depend on them,
    // and until the page sends it the skin shows nothing.
    if (!alone) await loaded;
    let ready = !alone;
    const draw = () => {
      const next = (status.next ?? {}) as Data;
      const box = el("div", "msg-box"), grid = el("div", "gear-grid"), row = el("div", "msg-actions");
      const cell = (label: string, node: HTMLElement, wide = false) => {
        const c = el("div", wide ? "cell wide" : "cell");
        c.append(el("span", "label", label), node);
        grid.append(c);
      };
      const grinderStart = grinderText(str(next.grinderId) || null, str(next.grinderModel));
      const grinder = grinderInput(grinderStart);
      cell(t.grinder, grinder.box, true);
      const rpm = stepper(num(next.rpm), () => grinderNamed(grinder.input.value)?.rpmSmallStep || 10, 0, t.rpm);
      rpm.input.inputMode = "numeric";
      cell(t.rpm, rpm.box);
      const waterStart = str(next.water);
      const water = waterInput(waterStart);
      cell(t.water, water.box);
      const cancel = el("button", "secondary", t.cancel) as HTMLButtonElement;
      cancel.type = "button";
      cancel.onclick = () => d.close();
      const save = el("button", "", t.save) as HTMLButtonElement;
      save.type = "button";
      save.onclick = () => { void run(async () => {
        const body: Data = {};
        if (grinder.input.value.trim() !== grinderStart.trim()) Object.assign(body, grinderPatch(grinder.input.value));
        const typed = rpm.input.value.trim() === "" || Number(rpm.input.value) === 0 ? null : Math.round(Number(rpm.input.value.replace(",", ".")));
        if (typed !== null && !(typed >= 1 && typed <= 5000)) { say(t.errors.invalidArguments, "error"); return; }
        if (typed !== num(next.rpm)) body.rpm = typed;
        if (water.input.value.trim() !== waterStart.trim()) body.water = water.input.value.trim() || null;
        if (Object.keys(body).length) {
          await api("next-settings", body);
          if (body.water) watersAt = 0;
        }
        d.close();
      }); };
      // Filled in a moment: what Save would send isn't known yet.
      save.disabled = !ready;
      row.append(cancel, save);
      box.append(el("h2", "", t.nextGear), grid, row);
      d.replaceChildren(box);
    };
    draw();
    d.addEventListener("pointerdown", (e) => { if (e.target === d) { e.preventDefault(); d.close(); } });
    d.addEventListener("close", () => {
      d.remove();
      closeDropdown();
      // Opened straight from the skin's line: closing it closes the overlay too.
      if (gearOnly) { gearOnly = false; closeOverlay(); } else void refreshStatus();
    });
    document.body.append(d);
    d.showModal();
    // Alone in the overlay: the overlay takes the card's size, measured now (a hidden frame may not run observers until
    // it is shown), at load, and whenever it changes.
    if (alone) {
      const fit = () => {
        const r = d.getBoundingClientRect();
        if (r.width && r.height) toParent({ type: "streamline:size", width: Math.ceil(r.width), height: Math.ceil(r.height) });
      };
      fit();
      if (document.readyState !== "complete") addEventListener("load", fit, { once: true });
      if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(d);
      await loaded;
      ready = true;
      if (d.open) { draw(); fit(); }
    }
  }

  // ── The overlay ──
  // Full screen the page draws the × stock Streamline draws over its overlay, in the same place.
  if (fromSkin) document.body.classList.add("embedded");
  $("leave").hidden = !returnTo;
  // Cancel: over edits it asks Discard / Stay / Save, then the overlay closes. Done: the edits are saved first, and it
  // closes once they're in.
  $("act-cancel").onclick = $("leave").onclick = async () => {
    if (!(await leaveShot())) return;
    if (fromSkin) closeOverlay();
  };
  $("act-done").onclick = () => { void run(async () => {
    if (!$("view-shot").hidden && unsaved && saveShot && !(await saveShot())) return;
    if (fromSkin) closeOverlay();
  }); };
  // As an espresso starts the overlay gets out of the way: edits are saved, then it closes. Stock Streamline says so
  // (streamline:espresso-start, with closeOnShot); otherwise the page watches the machine itself.
  let leftForEspresso = false;
  const leaveForEspresso = () => {
    if (leftForEspresso) return;
    leftForEspresso = true;
    // A question left open would answer for a page that is gone: it is dismissed.
    closeMessages();
    void (async () => {
      try { if (unsaved && saveShot) await saveShot(); } catch { /* kept on the page */ }
      closeOverlay();
    })();
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || (event.data as Data | null)?.type !== "streamline:espresso-start") return;
    leaveForEspresso();
  });
  if (fromSkin) {
    // Only a start seen here counts: a page opened during a shot stays open.
    let phase = "";
    const watch = (wait: number) => {
      let socket: WebSocket;
      try { socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/v1/machine/snapshot`); } catch { return; }
      socket.onmessage = (event) => {
        let now = "";
        try { now = str(((JSON.parse(String(event.data)) as Data).state as Data | undefined)?.state); } catch { return; }
        if (now === "espresso" && phase && phase !== "espresso") { socket.close(); leaveForEspresso(); }
        phase = now;
      };
      socket.onclose = () => { if (!leftForEspresso) setTimeout(() => watch(Math.min(wait * 2, 30000)), wait); };
    };
    watch(1000);
  }
  // The skin shows its own close only if this page never says it's here.
  toParent({ type: "streamline:ready" });
  // Pages opened from the skin refresh when the tablet comes back to them.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    grindersAt = watersAt = 0;
    void refreshStatus(true);
    void searchR2IfMissing();
  });
  // A shot saved after this one was shown (the page opened right as it ended): shown at once when nothing is being
  // edited, else offered, so the rating never lands on the previous shot.
  let latestTried = "";
  setInterval(() => {
    if (document.hidden || $("view-shot").hidden || busy || offset !== 0 || document.querySelector("dialog[open]")) return;
    const shown = shot?.id;
    void api("latest", { filter: setFilter }).then((value) => {
      if (shot?.id !== shown || busy || offset !== 0 || document.querySelector("dialog[open]")) return;
      const id = str(value.id);
      if (!id || id === shown) { showNewerShot(false); return; }
      // Loaded once and still not on screen: the set's newest isn't that one (a filter the answer didn't apply).
      if (id === latestTried) return;
      if (!unsaved) { latestTried = id; void loadShot().then(() => { if (shot?.id === id) say(t.newShotShown); }); return; }
      showNewerShot(true);
    }).catch(() => { /* next time */ });
  }, 4000);
  // It takes the place of Latest (the same thing, said louder), so the bar stays on one line.
  function showNewerShot(on: boolean) { $("newer-shot").hidden = !on; $("latest").hidden = on; }
  $("newer-shot").onclick = async () => { if (!(await leaveShot())) return; showNewerShot(false); offset = 0; void loadShot(); };
  // The R2 button follows the R2: it shows within seconds of Decaid connecting it, and goes when it disconnects.
  setInterval(() => { if (!document.hidden && !$("view-shot").hidden && !r2Measuring) void searchR2IfMissing(); }, 10000);
  // The next shot changes in the skin too (a coffee, the grinder): the bar follows within a minute.
  setInterval(() => { if (!document.hidden && !busy) void refreshStatus(true); }, 60000);
  // Alone in the skin's overlay the gear card starts at once, and the page behind it (never shown) isn't loaded.
  if (document.documentElement.classList.contains("gear-only")) { gearOnly = true; void run(openNextGear); }
  else void refreshStatus().then(() => {
    const wanted = params.get("view");
    const id = params.get("id");
    if (wanted === "coffee" && id) {
      detail = asCoffee({ id });
      show("coffees");
      void run(() => openDetail(id));
      return;
    }
    // Stock Streamline's surfaces open `pick` (the coffee list) and `next` (the gear) over the Shot page.
    show(views.includes(wanted as View) ? wanted as View : "shot");
    if (wanted === "pick") { pickOnly = true; void run(async () => { await openPicker("next"); }); }
    if (wanted === "next") { gearOnly = true; void run(openNextGear); }
  });
}

export function page(): string {
  const t = copy();
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const levels = `<option value="off">${esc(t.mcpOff)}</option><option value="read">${esc(t.mcpRead)}</option><option value="shots">${esc(t.mcpShots)}</option><option value="full">${esc(t.mcpFull)}</option>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.title)}</title>
<style>${__DECAID_THEME__}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;font-size:clamp(14px,1.15vw,24px)}
/* The page is the screen's height and never scrolls: lists, columns and the shot's right pane scroll inside themselves. */
html,body{height:100%}body{font:1rem/1.35 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--ink);height:100vh;height:100dvh;overflow:hidden;display:flex;flex-direction:column}
body.busy{cursor:progress}body.busy button{pointer-events:none;opacity:.7}
header{flex:none;z-index:5;display:flex;gap:0.667rem;align-items:center;padding:0.533rem 0.933rem;background:var(--bg);border-bottom:1px solid var(--ui-divider);min-width:0}
header h1{font:700 1.333rem/1 system-ui,sans-serif;margin:0;color:var(--accent);white-space:nowrap}nav{display:flex;gap:0.267rem;flex:none}
/* Tabs are quiet text; the open one gets the accent's tint and a line under it, not a filled button. */
nav button{background:transparent;color:var(--muted);border-color:transparent;font-size:1rem;padding:0.4rem 1.067rem;min-height:2.533rem}
nav button[aria-selected=true]{background:var(--accent-soft);color:var(--accent);box-shadow:inset 0 -2px var(--accent)}
main{flex:1;min-height:0;width:100%;overflow:hidden;display:flex;flex-direction:column}
main>section{flex:1;min-height:0}
h2{margin:0 0 0.267rem;font-size:1.267rem}h3{margin:0.8rem 0 0.4rem;font-size:1.067rem}p{margin:0 0 0.4rem}
/* Few outlines: fields are a quiet fill with one line under them; buttons are solid (the action), tinted (secondary) or text. */
input,select,textarea,button,.button{font:inherit;padding:0.4rem 0.667rem;border:1px solid transparent;border-radius:0.533rem}
input,select,textarea{background:var(--surface-2);color:var(--ink);min-width:0;max-width:100%;border-bottom-color:var(--ui-field-rule)}
input[type=range],input[type=checkbox]{background:transparent;border-color:transparent}input::placeholder,textarea::placeholder{color:var(--ui-field-rule);opacity:1}
:root{color-scheme:light}[data-theme=dark]{color-scheme:dark}button,.button{background:var(--accent);color:var(--accent-ink);cursor:pointer;font-weight:600;text-decoration:none;display:inline-block;min-height:2.533rem;white-space:nowrap;transition:background-color .14s ease,color .14s ease,box-shadow .14s ease}
button.secondary,.button.secondary{background:var(--accent-soft);color:var(--accent)}button:disabled{opacity:.45;cursor:not-allowed}
button.small,.button.small{min-height:2.133rem;padding:0.2rem 0.8rem;font-size:0.933rem}a.button.small{display:inline-flex;align-items:center}
/* Dropdowns look like the fields (a fill and a line under it) with the accent's arrow; the list opens in the page's theme. */
.dd-native{display:none!important}
button.dd{display:inline-flex;align-items:center;gap:0.533rem;background:var(--surface-2);color:var(--ink);border-bottom-color:var(--ui-field-rule);font-weight:500;padding:0.333rem 0.8rem 0.333rem 0.933rem;max-width:100%;text-align:left}
button.dd[aria-expanded=true]{background:var(--accent-soft);border-bottom-color:var(--accent)}
button.dd:disabled{opacity:.55;cursor:default}.dd-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dd-chevron{display:inline-flex;width:0.8rem;flex:none;color:var(--accent);transition:transform .15s}.dd-chevron svg{width:100%;height:auto}.dd[aria-expanded=true] .dd-chevron{transform:rotate(180deg)}
.dd-layer{position:fixed;inset:0;z-index:60}
.dd-menu{position:fixed;display:flex;flex-direction:column;gap:2px;overflow-y:auto;overscroll-behavior:contain;max-width:min(32rem,calc(100vw - 16px));padding:0.267rem;background:var(--surface);color:var(--ink);border:1px solid var(--ui-divider);border-radius:0.8rem;box-shadow:var(--ui-shadow)}
.dd-item{flex:none;background:transparent;color:var(--ink);border:0;border-radius:0.533rem;text-align:left;font-weight:500;min-height:2.533rem;padding:0.4rem 0.8rem;overflow:hidden;text-overflow:ellipsis}
.dd-item[aria-selected=true]{background:var(--accent-soft);color:var(--accent);box-shadow:inset 3px 0 var(--accent);font-weight:650}.dd-item:not([aria-selected=true]):active{background:var(--accent-soft)}
.dd-hint{margin:0;padding:0.533rem 0.8rem;color:var(--muted);font-size:0.933rem}
/* A typed field with choices: the field's fill, the text, and the accent's arrow that opens the list. */
.combo{display:flex;align-items:stretch;min-width:0;background:var(--surface-2);border:1px solid transparent;border-bottom-color:var(--ui-field-rule);border-radius:0.533rem}
.combo:focus-within{border-bottom-color:var(--accent);box-shadow:inset 0 -1px var(--accent)}.combo input{flex:1;width:0;min-width:0;background:transparent;border:0;border-radius:0}.combo input:focus-visible{outline:0}
.combo-open{flex:none;display:inline-flex;align-items:center;justify-content:center;width:2.267rem;min-height:0;padding:0;border:0;border-radius:0 0.533rem 0.533rem 0;background:transparent;color:var(--accent)}.combo-open svg{width:0.8rem;transition:transform .15s}.combo-open[aria-expanded=true]{background:var(--accent-soft)}.combo-open[aria-expanded=true] svg{transform:rotate(180deg)}
/* Messages as the dropdowns' list: the page's surface, a thin line, rounded, a soft shadow; never the system's box. */
dialog.msg{width:min(34rem,92vw);max-height:none;padding:0;background:var(--surface);color:var(--ink);border:1px solid var(--ui-divider);border-radius:0.8rem;box-shadow:var(--ui-shadow)}
dialog.msg::backdrop{background:rgb(0 0 0/.35)}.msg-box{padding:1.067rem 1.067rem 0.8rem}.msg-text{margin:0 0 1.067rem;font-size:1.067rem;white-space:pre-wrap}
.msg-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:0.533rem}.msg-actions button{min-width:6.4rem}.msg-actions .discard{margin-right:auto;color:var(--warn-ink)}
body.busy dialog.msg button{pointer-events:auto;opacity:1}
dialog.msg.old-bags{width:min(44rem,94vw)}.old-bags h2{margin:0 0 0.533rem;font-size:1.133rem}.old-bags .msg-text{margin-bottom:0.667rem;font-size:0.933rem}
.old-list{max-height:min(22rem,50vh);overflow:auto;margin:0 0 0.8rem;border-top:1px solid var(--ui-divider);border-bottom:1px solid var(--ui-divider)}
.old-row{display:flex;align-items:center;gap:0.667rem;padding:0.4rem 0.267rem;border-bottom:1px solid var(--ui-divider);cursor:pointer}.old-row:last-child{border-bottom:0}
.old-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.old-when{flex:none;font-size:0.867rem}
.eyebrow{white-space:nowrap;font-size:0.733rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}.muted{color:var(--muted)}.grow{flex:1;min-width:0}
.ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.label{display:block;font-size:0.8rem;color:var(--muted);margin-bottom:2px}
.pill{padding:0.2rem 0.667rem;border-radius:66.6rem;background:var(--surface-2);font-size:0.867rem;font-weight:600;white-space:nowrap}.pill.ok{background:var(--ok-soft);color:var(--ok)}.pill.warn{background:var(--warn-bg);color:var(--warn-ink)}
.notice{position:fixed;left:50%;bottom:4.4rem;transform:translateX(-50%);z-index:70;max-width:min(92vw,48rem);border-radius:0.667rem;padding:0.533rem 0.933rem;white-space:pre-wrap;box-shadow:0 0.267rem 1.2rem rgb(0 0 0/.22)}.notice:empty{display:none}.notice.error{background:var(--warn-bg);color:var(--warn-ink);border:1px solid var(--warn-line)}.notice.info{background:var(--ok-soft);color:var(--ok);border:1px solid var(--ok)}
#shot-body>.notice,#grid>.notice,#coffee-detail>.notice{position:static;transform:none;margin:1rem 0.933rem;box-shadow:none}
.panel{background:var(--surface);border:1px solid var(--ui-divider);border-radius:0.8rem;padding:0.667rem 0.8rem}
/* The next shot: its coffee (opens the list), its grinder · RPM · water (opens their card), and × to stop using it. */
#next-coffee{flex:0 1 auto;margin-left:auto;min-width:0;display:flex;gap:0.267rem;align-items:center;padding:0.2rem 0.267rem;border-radius:0.533rem;background:var(--surface)}
#next-coffee .eyebrow{color:var(--muted)}.next-pick,.next-gear-btn{display:flex;align-items:center;gap:0.533rem;min-width:0;background:transparent;color:var(--ink);font-weight:400;padding:0.2rem 0.533rem}
.next-pick{flex:0 1 auto}.next-gear-btn{flex:0 2 auto;max-width:18rem;display:block;border-left:1px solid var(--ui-divider);border-radius:0;color:var(--ink);font-size:0.933rem}.next-gear-btn.muted{color:var(--muted)}
.next-name{min-width:0}button.icon{min-height:2.133rem;width:2.133rem;padding:0;border-radius:50%;font-size:0.9rem;line-height:1;flex:none;background:transparent}
.thumb{position:relative;width:2.4rem;height:2.4rem;border-radius:0.533rem;overflow:hidden;flex:none;background:var(--surface-2);display:grid;place-items:center}
.thumb img,.photo img,.hero img,.photo-edit img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}.nophoto{font-size:1.333rem;opacity:.6}
.shot-bar{display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;grid-column:1;grid-row:1;padding:0.667rem 0.933rem 0}.shot-meta{min-width:0;display:flex;flex-wrap:wrap;gap:0.4rem 0.667rem;align-items:center;padding:0.4rem 0}
.pill.kind{background:var(--accent-soft);color:var(--accent)}
.shot-meta .copy-ai{margin-left:auto;flex:none}.shot-meta .visualizer{flex:none}.shot-meta .delete-shot{flex:none;width:2.133rem;padding:0.2rem;color:var(--warn-ink)}.delete-shot svg{display:block;width:1.467rem;height:1.467rem;margin:auto}.shot-meta>strong{flex:1 1 0;min-width:4rem;max-width:max-content}
/* The shot on the page's background on the left, its editing on the skin's surface on the right, no boxes. */
#view-shot{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto minmax(0,1fr);align-items:start}
#shot-body{display:contents}#shot-body>.empty,#shot-body>p{grid-column:1;grid-row:2;padding:0 0.933rem}
#shot-body>.chart-wrap{grid-column:1;grid-row:2;padding:0.667rem 0.933rem;min-height:0;overflow:hidden;align-self:stretch;max-height:100%}
.shot-side{grid-column:2;grid-row:1/3;align-self:stretch;display:flex;flex-direction:column;min-width:0;min-height:0;overflow-y:auto;background:var(--surface);padding:0.4rem 0.933rem}
#view-shot .panel{background:transparent;border:0;border-radius:0;padding:0.667rem 0}.shot-side>*+*{border-top:1px solid var(--ui-divider)}
.not-brew{margin:1.2rem 0;color:var(--muted)}
/* The notes are a writing area, not one more box: a line under them, the field's fill while typing. */
.shot-side textarea{background-color:transparent;border-radius:0;line-height:1.5}.shot-side textarea:focus{background-color:var(--surface-2)}
.coffee-row{display:flex;gap:0.667rem;align-items:center;padding:0.533rem 0.667rem}.coffee-row .thumb{width:2.667rem;height:2.667rem}.coffee-row .grow>strong{font-size:1.133rem}.coffee-row button.secondary{background:transparent}
.numbers{display:grid;grid-template-columns:repeat(4,1fr);gap:0.533rem 0.667rem;padding:0.533rem 0.667rem;font-variant-numeric:tabular-nums}.cell{display:block;min-width:0}.cell.wide{grid-column:span 2}.cell .dd{width:100%;min-height:2.533rem}.cell .combo{min-height:2.533rem}.readouts{grid-column:span 2;align-self:end;align-items:center;min-height:2.533rem;display:flex;gap:1.467rem;flex-wrap:wrap;font-size:1rem;color:var(--muted)}.readouts output{font-weight:650;color:var(--ink)}
/* − and + inside the field: one control per number, so each step plainly belongs to its value. */
.stepper{display:flex;gap:0;align-items:stretch;background:var(--surface-2);border:1px solid transparent;border-bottom-color:var(--ui-field-rule);border-radius:0.533rem;overflow:hidden}.stepper:focus-within{border-bottom-color:var(--accent);box-shadow:inset 0 -1px var(--accent)}
.stepper input{flex:1;width:0;min-width:2.8rem;text-align:center;font-size:1.267rem;font-weight:650;padding:0.267rem 2px;border:0;border-radius:0;background:transparent;-moz-appearance:textfield}.stepper input:focus-visible{outline:0}.stepper input::-webkit-outer-spin-button,.stepper input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.step{background:transparent;color:var(--accent);border:0;border-radius:0;min-width:1.733rem;min-height:2.4rem;padding:0;font-size:1.267rem;font-weight:700;line-height:1;flex:none}.step:active{background:var(--accent-soft)}
.cell{position:relative}.r2{position:absolute;top:-0.4rem;right:0;display:flex;align-items:center;justify-content:center;background:transparent;color:var(--accent);border:0;min-height:0;width:1.867rem;height:1.867rem;padding:0;border-radius:50%}.r2[hidden]{display:none}.r2:active{background:var(--accent-soft)}.r2 svg{width:1.4rem;height:1.4rem}
.r2.measuring{border-color:var(--accent)}.r2.measuring svg{animation:r2pulse 1s ease-in-out infinite}@keyframes r2pulse{50%{opacity:.3}}
.facts{display:flex;flex-wrap:wrap;gap:0.533rem 1.6rem;margin:0.667rem 0}.facts>div{min-width:0}
dt{font-size:0.8rem;color:var(--muted)}dd{margin:0;font-size:1rem;font-weight:650}
.chart-wrap{padding:0.533rem 0.667rem;position:relative}.chart-expand{position:absolute;top:0.2rem;right:0.933rem;z-index:2;min-height:0;width:2rem;height:2rem;padding:0;border:0;background:transparent;color:var(--muted);font-size:1.2rem;line-height:1}.chart-expand:active{background:var(--accent-soft)}
.full-chart{position:fixed;inset:0;z-index:40;display:flex;flex-direction:column;gap:0.267rem;padding:0.533rem 0.933rem;background:var(--bg)}.full-head{display:flex;align-items:center;gap:0.667rem}
.chart-close{min-height:0;width:2.533rem;height:2.533rem;padding:0;border-radius:50%;font-size:1.4rem;line-height:1}.full-area{flex:1;min-height:0;display:flex;align-items:center}.full-area .chart-box{width:100%}.full-area .chart{max-height:100%}.full-chart .readout{font-size:1rem;min-width:12rem}.chart{width:100%;height:auto;display:block}
.gridline{stroke:var(--line);stroke-width:1;opacity:.45}.chart text{fill:var(--muted);font-size:12px}.chart text.end-label{font-size:13px;font-weight:600}.curve{fill:none;stroke-width:2.2;stroke-linejoin:round}.target{fill:none;stroke-width:1.4;stroke-dasharray:2 4;opacity:.55}
.chart-box{position:relative}.chart{touch-action:pan-y;cursor:crosshair;user-select:none;-webkit-user-select:none}.step-line{stroke:var(--muted);stroke-width:1.2;stroke-dasharray:1 4;opacity:.8}
.cursor line{stroke:var(--ink);stroke-width:1;opacity:.6}.cursor circle{stroke:var(--surface);stroke-width:1.5}
.readout{position:absolute;top:0.4rem;min-width:9.5rem;max-width:55%;padding:0.4rem 0.533rem;border:1px solid var(--ui-divider);border-radius:0.533rem;background:var(--surface);box-shadow:var(--ui-shadow);font-size:0.8rem;pointer-events:none}.readout[hidden]{display:none}.readout.left{left:2.2rem}.readout.right{right:5.8rem}
.readout-time{font-weight:700;margin-bottom:0.133rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.readout-row{display:flex;justify-content:space-between;gap:0.667rem;white-space:nowrap}.readout-row strong{font-weight:650}.readout-cols{display:grid;grid-template-columns:auto auto auto;gap:0.667rem}.readout-cols>*:not(:first-child){text-align:right}
.dd-shot-set{min-height:2.133rem;font-size:0.867rem;max-width:14rem;margin-left:auto}button.dd-shot-set{background:var(--accent-soft);color:var(--accent);border-bottom-color:transparent}button.compare-select{display:flex;width:auto;max-width:min(100% - 0.933rem,24rem);margin-top:0.533rem;min-height:2.133rem;font-size:0.867rem;background:transparent;color:var(--accent);border-bottom-color:transparent}.chart-slot{min-width:0}
/* Moving through the history is navigation, so text; loading a shot for the next one is the bar's real action. */
.shot-bar #older,.shot-bar #newer,.shot-bar #latest{background:transparent}
.key.cmp::before{background:repeating-linear-gradient(90deg,var(--muted) 0 5px,transparent 5px 8px)}.key[hidden]{display:none}
.curve.compare{stroke-width:1.6;stroke-dasharray:5 3;opacity:.55}.readout-row .dot{display:inline-block;width:0.533rem;height:0.533rem;border-radius:50%;margin-right:0.333rem;vertical-align:middle}
.legend{display:flex;flex-wrap:wrap;gap:0.267rem 0.933rem;font-size:0.8rem;color:var(--muted);margin-top:0.533rem}.key::before{content:"";display:inline-block;width:0.933rem;height:0.267rem;border-radius:2px;margin-right:0.333rem;vertical-align:middle}
.key.p::before{background:var(--c-pressure)}.key.f::before{background:var(--c-flow)}.key.w::before{background:var(--c-weight)}.key.wf::before{background:var(--c-weight-flow)}.key.c::before{background:var(--c-temp)}.key.dash::before{background:repeating-linear-gradient(90deg,var(--muted) 0 3px,transparent 3px 6px)}.key.dots::before{width:0.267rem;height:0.933rem;background:repeating-linear-gradient(0deg,var(--muted) 0 2px,transparent 2px 5px)}
.rate{display:grid;gap:0.533rem}.score-row,.taste-row,.extra-row{display:flex;gap:0.533rem;align-items:center;flex-wrap:wrap}.rate .label{margin:0}
.score-row input[type=range]{display:block;width:100%;margin:0;accent-color:hsl(var(--h,210) 62% 44%)}.score-value{min-width:2.4rem;font-size:1.6rem;font-weight:750;font-variant-numeric:tabular-nums;color:hsl(var(--h,210) 62% 38%)}
/* A tick under every step of 5, a longer one every 10; inset by half the thumb so each sits under the thumb's centre. */
.score-slider{flex:1;min-width:9.333rem;position:relative;padding-bottom:0.533rem}.score-ticks{position:absolute;left:8px;right:8px;bottom:0;height:0.533rem;display:flex;justify-content:space-between;align-items:flex-start;pointer-events:none}
.score-ticks i{width:1px;height:0.333rem;background:var(--ui-field-rule)}.score-ticks i.major{height:0.533rem;background:var(--muted)}
[data-theme=dark] .score-value{color:hsl(var(--h,210) 65% 60%)}.score-row.unscored .score-value{color:var(--muted)}.score-row.unscored input[type=range]{accent-color:var(--accent)}
.badge.scored{background:hsl(var(--h) 62% 44% / .16);color:hsl(var(--h) 70% 32%);font-weight:650}[data-theme=dark] .badge.scored{color:hsl(var(--h) 65% 62%)}
/* The taste/body choices sit on one shared fill each, so they read as one control. */
.toggle{background:var(--surface-2);color:var(--ink);min-width:6.4rem;min-height:2.267rem;padding:0.2rem 0.8rem}.toggle[aria-pressed=true]{background:var(--accent);color:var(--accent-ink)}
.taste-row{flex-wrap:nowrap;gap:1.2rem}.tb-group{flex:1;min-width:0;display:flex;align-items:center;gap:0.533rem}.tb-group>.label{flex:none}.seg{flex:1;min-width:0;display:flex;background:var(--surface-2);border-radius:0.533rem}
.seg .toggle{flex:1 1 auto;min-width:0;padding:0.2rem 0.533rem;font-size:0.933rem;border-radius:0;margin-left:-1px;overflow:hidden;text-overflow:ellipsis;background:transparent}.seg .toggle[aria-pressed=true]{background:var(--accent);position:relative}.seg .toggle:first-child{margin-left:0;border-radius:0.533rem 0 0 0.533rem}.seg .toggle:last-child{border-radius:0 0.533rem 0.533rem 0}
.extra-row{align-items:flex-start;flex-wrap:nowrap}.extra-row label{display:block}.extra-row textarea{width:100%;resize:none;display:block}
/* The notes take what the right pane has left, and give it up first. */
.shot-side .rate{flex:1;display:flex;flex-direction:column;gap:0.533rem;min-height:0}.shot-side .extra-row{flex:1;display:flex;align-items:stretch;min-height:0}.shot-side .extra-row label{display:flex;flex-direction:column;min-height:0}.shot-side .extra-row textarea{flex:1;min-height:3rem}
/* One action strip under the views; Cancel and Back are text beside the one solid Done. */
#actions{flex:none;z-index:4;display:flex;gap:0.533rem;justify-content:flex-end;align-items:center;padding:0.533rem 0.933rem;background:var(--bg);border-top:1px solid var(--ui-divider)}#actions button{min-width:8rem}
#act-cancel,#act-back,#picker-close{background:transparent}
.pill.unsaved{margin-right:0.267rem;background:var(--accent-soft);color:var(--accent);white-space:normal}
button.attention{box-shadow:0 0 0 0.2rem var(--bg),0 0 0 0.367rem var(--accent)}
.toolbar{display:flex;flex-wrap:wrap;gap:0.4rem 0.533rem;align-items:center;margin-bottom:0.8rem}.toolbar input[type=search]{flex:1 1 10rem;min-width:8rem}.toolbar .clear-filters{min-height:2.4rem;font-size:0.867rem}.coffee-link{color:inherit;text-decoration:none}.coffee-link:hover{text-decoration:underline}.facts .stock{margin-top:0;min-width:13rem}
.filters{display:flex;flex-wrap:wrap;gap:0.267rem}.filters .dd{max-width:11rem;min-height:2.4rem;font-size:0.867rem;color:var(--muted);background:transparent;border-bottom-color:transparent}.filters .dd.active{color:var(--accent);background:var(--accent-soft);box-shadow:inset 0 -2px var(--accent)}
.switch.finished{display:flex;gap:0.4rem;align-items:center;font-size:0.867rem;white-space:nowrap;cursor:pointer}
/* The coffees: the toolbar stays, the cards scroll. Rows as tall as their cards (auto rows of overflow:hidden cards in
   a fixed height would shrink and clip their lines). */
#view-coffees{display:flex;flex-direction:column;padding:0.667rem 0.933rem 0}#coffee-list{flex:1;min-height:0;display:flex;flex-direction:column}
#grid,#picker-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(15.333rem,1fr));grid-auto-rows:max-content;align-content:start;gap:0.8rem;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-bottom:0.8rem}
/* Cards are flat on the skin's surface; only the current coffee gets a line; finished ones are greyed. */
.card{display:flex;flex-direction:row;align-items:center;gap:0.667rem;padding:0.533rem;text-align:left;background:var(--surface);color:var(--ink);border:2px solid transparent;border-radius:0.8rem;overflow:hidden;font-weight:400;white-space:normal;min-height:0}
.card.current{background:var(--ok-soft);box-shadow:inset 0 0 0 1px var(--ok)}.card.finished{opacity:.55;background:var(--surface-2)}.card.finished .photo{filter:grayscale(1)}.card.finished .stock-bar i{background:var(--muted)!important}
.card .eyebrow{color:var(--muted);letter-spacing:.06em}.card .name{font-size:1.067rem}
.photo{position:relative;width:4.267rem;height:4.267rem;flex:none;border-radius:0.533rem;overflow:hidden;background:var(--surface-2);display:grid;place-items:center}
.card-body{display:grid;gap:2px;min-width:0;flex:1}.name{font-size:1rem;line-height:1.2}.card-body .muted{font-size:0.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badges{display:flex;flex-wrap:wrap;gap:0.267rem;margin-top:2px}.badge{padding:1px 0.533rem;border-radius:66.6rem;background:var(--accent-soft);font-size:0.733rem;white-space:nowrap}.badge.ok{background:var(--ok-soft);color:var(--ui-ok-ink);font-weight:650}.badge.frozen{color:var(--c-flow)}
.stock{display:flex;align-items:center;gap:0.4rem;margin-top:2px}.stock-text{font-size:0.8rem;font-weight:650;white-space:nowrap}.stock-bar{flex:1;height:0.267rem;border-radius:66.6rem;background:var(--track);overflow:hidden;min-width:2.5rem}.stock-bar i{display:block;height:100%;border-radius:inherit}
.card-dates{display:flex;flex-wrap:wrap;gap:0 0.667rem;font-size:0.8rem;color:var(--muted)}.card-dates .frozen{color:var(--c-flow)}
/* A coffee's page: the photo and details on top; its bags and its shots side by side, each scrolling on its own. */
#coffee-detail{flex:1;min-height:0;display:flex;flex-direction:column}
.detail-top{flex:none;display:flex;gap:1.2rem;padding:0.267rem 0 0.8rem;border-bottom:1px solid var(--ui-divider);align-items:flex-start;max-height:58%;min-height:0;overflow-y:auto}.detail-top h2{font-size:1.6rem;letter-spacing:-.025em}.detail-top .facts{gap:0.4rem 1.333rem;margin:0.4rem 0}
.hero{position:relative;width:11rem;height:11rem;border-radius:0.8rem;overflow:hidden;flex:none;background:var(--surface-2);display:grid;place-items:center}.hero .nophoto{font-size:3rem}
.tasting{border-left:2px solid var(--accent);padding:0.133rem 0 0.133rem 0.8rem;margin:0.4rem 0 0.667rem}.tasting strong{display:block;font-size:0.8rem;font-weight:400;color:var(--muted)}.tasting p{margin:0}.actions{display:flex;gap:0.533rem;flex-wrap:wrap;align-items:center}
.detail-cols{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);grid-template-rows:minmax(0,1fr);gap:1.067rem;padding-top:0.4rem}
.detail-cols>section{min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:0 0.267rem 0.4rem 0;align-content:start}.detail-cols>section+section{padding-left:1.067rem;border-left:1px solid var(--ui-divider)}
.detail-cols>section>h3{position:sticky;top:0;z-index:1;background:var(--bg);margin:0;padding:0.267rem 0 0.533rem;font-size:1rem}h3.with-action{display:flex;align-items:center;justify-content:space-between;gap:0.533rem}
.suggestion-head{display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center}.muted.small{font-size:0.8rem}
.recipes{display:grid;grid-template-columns:1fr}.recipes>p{margin:0.533rem 0 0}
/* Each row's buttons repeat down the list, so they are tinted, not solid; the coffee's own "Use for next shot" stays the
   solid one. */
.recipe{display:flex;gap:0.667rem;align-items:center;padding:0.533rem 0.133rem;border-bottom:1px solid var(--ui-divider)}.recipe:last-child{border-bottom:0}
.recipe button:not(.secondary){background:var(--accent-soft);color:var(--accent)}.recipe.bag.shown{background:var(--accent-soft);border-radius:0.533rem;padding-left:0.533rem;padding-right:0.533rem}.recipe.finished{opacity:.55}.tappable{cursor:pointer}
.empty{text-align:center;padding:2rem 1.067rem;color:var(--muted)}
dialog{width:min(80rem,96vw);max-height:92vh;border:1px solid var(--ui-divider);border-radius:1.067rem;background:var(--bg);color:var(--ink);padding:1.067rem;box-shadow:var(--ui-shadow)}
dialog::backdrop{background:rgb(0 0 0/.52)}.dialog-head{display:flex;gap:0.533rem;align-items:center;margin-bottom:0.8rem}.dialog-head h2{margin:0 auto 0 0;font-size:1.467rem;letter-spacing:-.025em}
/* The picker's head and search stay put; only the coffees scroll. */
#picker{height:92vh}#picker[open]{display:flex;flex-direction:column}
#picker-hint{font-size:0.867rem;flex-basis:100%}#picker-list .card{-webkit-touch-callout:none;user-select:none}
/* The coffee form: three columns (coffee, bag, photo and notes) of two fields a row, sized to fit without scrolling. */
dialog.form-dialog{width:min(82rem,97vw);height:auto;max-height:94vh;padding:0.8rem 1.067rem}dialog.form-dialog[open]{display:flex;flex-direction:column}
.form-cols{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr 0.85fr;gap:0 1.6rem;overflow-y:auto}
.form-col{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0.4rem 0.667rem;align-content:start;min-width:0}.form-col>h3{grid-column:1/-1;margin:0 0 0.133rem;font-size:0.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
.photo-col{grid-template-columns:minmax(0,1fr)}.field{min-width:0}.field.wide{grid-column:1/-1}.field>input,.field>textarea{width:100%;display:block}.field .combo{min-height:2.4rem}.field textarea{resize:none}
.switch-field{display:flex;align-items:center;gap:0.533rem;min-height:2.4rem;cursor:pointer}
.photo-edit{position:relative;width:100%;height:12rem;border-radius:0.8rem;overflow:hidden;background:var(--surface-2);display:grid;place-items:center}.photo-edit .nophoto{font-size:3rem}.photo-actions{margin:0.267rem 0 0.267rem}
dialog.form-dialog.bag-only{width:min(36rem,96vw);height:auto}.bag-only .coffee-col,.bag-only .photo-col{display:none}.bag-only .form-cols{grid-template-columns:1fr}
/* Settings and AI: two columns, the right one on the skin's surface, rows split by thin lines, each column scrolling
   on its own. Each row: what it is and a short hint on the left, its control on the right. */
#view-settings,#view-ai{display:flex}
.settings{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:minmax(0,1fr)}.set-col{min-width:0;min-height:0;overflow-y:auto;padding:0.267rem 1.6rem 1.067rem}.set-col+.set-col{background:var(--surface);border-left:1px solid var(--ui-divider)}
.set-group{margin:1.2rem 0 0.133rem;font-size:0.8rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}.set-col>.set-group:first-child,.set-col>div:first-child>.set-group{margin-top:0.533rem}
.set-row{display:flex;align-items:center;gap:0.933rem;padding:0.6rem 0;border-bottom:1px solid var(--ui-divider)}label.set-row{cursor:pointer}
.set-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:0.133rem}.set-title{font-weight:600}.set-hint{display:block;font-size:0.867rem;color:var(--muted);line-height:1.45}.set-error{color:var(--warn-ink)}
.set-control{flex:0 1 auto;min-width:0;max-width:60%;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:0.533rem}.set-control .dd{max-width:100%}.set-control button.small{min-height:2.133rem}
.set-control>button:not(.dd),.set-control>.button{flex:none;display:inline-flex;align-items:center;justify-content:center;text-align:center}
.set-intro{margin:0.267rem 0 0}.mcp-value{font-family:ui-monospace,Menlo,Consolas,monospace;color:var(--ink);overflow-wrap:anywhere;user-select:all}.mcp-code{white-space:pre-wrap}#mcp-public-box .form-row{display:flex;gap:0.533rem;margin:0.267rem 0 0}#mcp-public-url{flex:1;min-width:0}.set-foot{margin:1.2rem 0 0;font-size:0.8rem;color:var(--muted)}
/* An on/off switch, not a checkbox. */
input.sw{appearance:none;-webkit-appearance:none;flex:none;position:relative;width:2.933rem;height:1.733rem;margin:0;padding:0;border:0;border-radius:66.6rem;background:var(--track);cursor:pointer;transition:background .15s}
input.sw::before{content:"";position:absolute;top:0.2rem;left:0.2rem;width:1.333rem;height:1.333rem;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgb(0 0 0/.3);transition:transform .15s}input.sw:checked{background:var(--accent)}input.sw:checked::before{transform:translateX(1.2rem)}
.form-row{display:flex;gap:0.533rem;flex-wrap:wrap;align-items:center;margin:0.4rem 0}
body.embedded header h1{display:none}
/* Stock Streamline draws its × (44px, 8px from the corner) over the page's top right. */
body.embedded header{padding-right:calc(60px + 0.4rem)}
#leave{position:fixed;top:8px;right:8px;z-index:6;width:44px;height:44px;min-height:0;padding:0;border:0;border-radius:22px;font-size:28px;line-height:1;background:rgba(0,0,0,.55);color:#fff}
.next-gear h2{margin:0 0 0.8rem;font-size:1.133rem}.gear-grid{display:grid;grid-template-columns:1fr 1fr;gap:0.533rem 0.667rem;margin-bottom:1.067rem}
.gear-only body>header,.gear-only body>main,.gear-only #actions,.gear-only #leave{display:none!important}.gear-only dialog.msg::backdrop{background:transparent}
/* Alone in the skin's window, the card is drawn larger, for a finger, and is the whole page: a card at the top left
   that the overlay fits, with the skin's × (44px, 8px in) beside its title. */
html.gear-only{font-size:22px}
html.gear-only,html.gear-only body{background:transparent!important;color-scheme:normal!important}html.gear-only[data-theme=dark] dialog.msg{color-scheme:dark}
.gear-only dialog.msg.next-gear{margin:0;width:34rem;max-width:none;box-shadow:none}.gear-only .next-gear h2{padding-right:2.4rem}
[hidden]{display:none!important}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
/* Hover only where there is a pointer; on the tablet a tap shows the pressed state instead. */
@media (hover:hover){button.secondary:not(:disabled):hover,.seg .toggle:not([aria-pressed=true]):hover,.card:not(:disabled):hover,nav button:not([aria-selected=true]):hover,.filters .dd:not(.active):hover,.next-pick:hover,.next-gear-btn:hover{background:var(--ui-hover)}}
@media (prefers-reduced-motion:reduce){button,.button,input.sw,input.sw::before,.dd-chevron,.combo-open svg{transition:none}.r2.measuring svg{animation:none}}
@media (max-width:60rem){header{flex-wrap:wrap}#next-coffee{flex-basis:100%;order:3;margin-left:0}#view-shot{grid-template-columns:1fr;grid-template-rows:auto auto minmax(0,1fr)}.shot-bar,#shot-body>.chart-wrap,.shot-side{grid-column:1;grid-row:auto}.numbers{grid-template-columns:repeat(3,1fr)}.form-cols{grid-template-columns:1fr}}
</style></head><body>
<button type="button" id="leave" aria-label="${esc(t.close)}" hidden>×</button>
<header><h1>${esc(t.title)}</h1><nav role="tablist">
<button type="button" role="tab" id="tab-shot">${esc(t.tabShot)}</button>
<button type="button" role="tab" id="tab-coffees">${esc(t.tabCoffees)}</button>
<button type="button" role="tab" id="tab-settings">${esc(t.tabSettings)}</button>
<button type="button" role="tab" id="tab-ai">${esc(t.tabAi)}</button>
</nav><div id="next-coffee" hidden></div></header>
<main><div id="notice" class="notice" role="status" aria-live="polite"></div>
<section id="view-shot" hidden>
<div class="shot-bar"><button type="button" id="older" class="secondary small">← ${esc(t.older)}</button><button type="button" id="newer" class="secondary small">${esc(t.newer)} →</button><button type="button" id="latest" class="secondary small">${esc(t.latest)}</button><button type="button" id="newer-shot" class="small" hidden>${esc(t.newerShot)} →</button><button type="button" id="load-this" class="secondary small" title="${esc(t.loadThisTitle)}" hidden>${esc(t.loadThis)}</button><select id="shot-set" aria-label="${esc(t.shotSet)}"><option value="all">${esc(t.setAll)}</option><option value="coffee">${esc(t.setCoffee)}</option><option value="profile">${esc(t.setProfile)}</option><option value="both">${esc(t.setBoth)}</option></select></div>
<div id="shot-body"></div>
</section><section id="view-coffees" hidden>
<div id="coffee-list"><div class="toolbar"><div id="coffee-filters" class="filters"></div><input id="search" type="search" placeholder="${esc(t.searchPlaceholder)}" aria-label="${esc(t.searchPlaceholder)}"><button type="button" id="coffee-clear" class="secondary clear-filters" hidden>${esc(t.clearFilters)}</button><label class="switch finished"><input type="checkbox" class="sw" id="show-finished"> ${esc(t.showFinished)}</label><button type="button" id="add-coffee">+ ${esc(t.addCoffee)}</button></div><div id="grid"></div></div>
<div id="coffee-detail" hidden></div>
</section>
<section id="view-settings" hidden><div class="settings">
<div class="set-col">
<h2 class="set-group">${esc(t.groupNext)}</h2>
<div class="set-row"><span class="set-text"><span class="set-title">${esc(t.onChoiceTitle)}</span><span class="set-hint">${esc(t.onChoiceHelp)}</span></span>
<span class="set-control"><select id="on-choice" aria-label="${esc(t.onChoiceTitle)}"><option value="keep">${esc(t.onChoiceKeep)}</option><option value="last">${esc(t.onChoiceLast)}</option><option value="best">${esc(t.onChoiceBest)}</option></select></span></div>
<h2 class="set-group">${esc(t.tabShot)}</h2>
<label class="set-row"><span class="set-text"><span class="set-title">${esc(t.visualizerNotesLabel)}</span><span class="set-hint">${esc(t.visualizerNotesHelp)}</span></span>
<span class="set-control"><input type="checkbox" class="sw" id="visualizer-notes"></span></label>
<p class="set-foot"><span id="version"></span><br>${esc(t.lanNote)}</p>
</div>
<div class="set-col">
<h2 class="set-group">${esc(t.r2Title)}</h2>
<div class="set-row"><span class="set-text"><span class="set-title" id="r2-state"></span><span class="set-hint">${esc(t.r2Help)}</span></span>
<span class="set-control"><button type="button" id="r2-search" class="secondary small">${esc(t.r2Search)}</button></span></div>
</div></div></section>
<section id="view-ai" hidden><div class="settings">
<div class="set-col">
<h2 class="set-group">${esc(t.mcpTitle)}</h2><p class="set-hint set-intro">${esc(t.mcpHelp)}</p>
<div class="set-row"><span class="set-text"><span class="set-title">${esc(t.mcpAccess)}</span><span class="set-hint" id="mcp-level-help"></span></span>
<span class="set-control"><select id="mcp-access" aria-label="${esc(t.mcpAccess)}">${levels}</select></span></div>
<div id="mcp-box" hidden>
<div class="set-row"><span class="set-text"><span class="set-title">${esc(t.mcpAddress)}</span><span class="set-hint mcp-value" id="mcp-url"></span><span class="set-hint set-error" id="mcp-localhost" hidden>${esc(t.mcpLocalhost)}</span></span>
<span class="set-control"><button type="button" id="mcp-copy-url" class="secondary small">${esc(t.mcpCopy)}</button></span></div>
<div class="set-row"><span class="set-text"><span class="set-title">${esc(t.mcpToken)}</span><span class="set-hint mcp-value" id="mcp-token"></span><span class="set-hint">${esc(t.mcpTokenHelp)}</span></span>
<span class="set-control"><button type="button" id="mcp-show" class="secondary small">${esc(t.mcpShow)}</button><button type="button" id="mcp-copy-token" class="secondary small">${esc(t.mcpCopy)}</button><button type="button" id="mcp-new" class="secondary small">${esc(t.mcpNewToken)}</button></span></div>
</div>
<div class="set-row"><span class="set-text"><span class="set-title">${esc(t.mcpPublic)}</span><span class="set-hint" id="mcp-public-help"></span></span>
<span class="set-control"><select id="mcp-public-access" aria-label="${esc(t.mcpPublic)}">${levels}</select></span></div>
<div id="mcp-public-box" hidden>
<div class="set-row"><span class="set-text"><span class="set-title">${esc(t.mcpPublicUrl)}</span><span class="set-hint">${esc(t.mcpPublicUrlHelp)}</span><span class="form-row"><input id="mcp-public-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://…ts.net/bean-journal" aria-label="${esc(t.mcpPublicUrl)}"><button type="button" id="mcp-public-save" class="secondary">${esc(t.mcpPublicSave)}</button></span></span></div>
<div class="set-row" id="mcp-connector-row" hidden><span class="set-text"><span class="set-title">${esc(t.mcpConnector)}</span><span class="set-hint mcp-value" id="mcp-connector"></span><span class="set-hint">${esc(t.mcpConnectorHelp)}</span></span>
<span class="set-control"><button type="button" id="mcp-public-show" class="secondary small">${esc(t.mcpShow)}</button><button type="button" id="mcp-copy-connector" class="secondary small">${esc(t.mcpCopy)}</button><button type="button" id="mcp-public-new" class="secondary small">${esc(t.mcpNewToken)}</button></span></div>
</div>
</div>
<div class="set-col">
<div id="mcp-shared" hidden>
<div class="set-row"><span class="set-text"><span class="set-title">${esc(t.mcpConfirm)}</span><span class="set-hint">${esc(t.mcpConfirmHelp)}</span></span>
<span class="set-control"><select id="mcp-confirm" aria-label="${esc(t.mcpConfirm)}"><option value="none">${esc(t.mcpConfirmNone)}</option><option value="changes">${esc(t.mcpConfirmChanges)}</option><option value="all">${esc(t.mcpConfirmAll)}</option></select></span></div>
<div class="set-row"><span class="set-text"><span class="set-title">${esc(t.mcpTailscale)}</span><span class="set-hint">${esc(t.mcpTailscaleHelp)}</span><span class="set-hint mcp-value mcp-code" id="mcp-serve"></span></span>
<span class="set-control"><button type="button" id="mcp-copy-serve" class="secondary small">${esc(t.mcpCopy)}</button></span></div>
</div>
</div></div></section>
<dialog id="picker"><div class="dialog-head"><h2>${esc(t.chooseCoffee)}</h2><label class="switch finished"><input type="checkbox" class="sw" id="picker-finished"> ${esc(t.showFinished)}</label><button type="button" id="picker-add" class="secondary">+ ${esc(t.addCoffee)}</button><button type="button" id="picker-close" class="secondary">${esc(t.close)}</button></div><div class="toolbar"><div id="picker-filters" class="filters"></div><input id="picker-search" type="search" placeholder="${esc(t.searchPlaceholder)}" aria-label="${esc(t.searchPlaceholder)}"><button type="button" id="picker-clear" class="secondary clear-filters" hidden>${esc(t.clearFilters)}</button><span id="picker-hint" class="muted">${esc(t.pickerHint)}</span></div><div id="picker-list"></div></dialog>
</main>
<footer id="actions" hidden><span id="unsaved-note" class="pill unsaved" role="status" hidden>${esc(t.unsaved)}</span><button type="button" id="act-cancel" class="secondary">${esc(t.cancel)}</button><button type="button" id="act-back" class="secondary" hidden>← ${esc(t.back)}</button><button type="button" id="act-done">${esc(t.done)}</button></footer>
<script>(${client.toString()})(${JSON.stringify(t).replace(/</g, "\\u003c")});</script></body></html>`;
}
