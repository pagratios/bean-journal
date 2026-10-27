export type RatingSliderOptions<Value extends string> = {
  label: string;
  values: readonly Value[];
  labels: Record<Value, string>;
  value: Value | null | undefined;
  unsetLabel: string;
  clearLabel: string;
  onChange?: (value: Value | null) => void;
};

/** Self-contained so a page can serialize it with toString(), without bundling browser globals into the plugin. */
export function createRatingSlider<Value extends string>(options: RatingSliderOptions<Value>) {
  if (options.values.length !== 5 || new Set(options.values).size !== 5 ||
      options.values.some((v) => !options.labels[v]) ||
      (options.value != null && !options.values.includes(options.value))) throw new Error("invalidArguments");
  const element = document.createElement("div");
  element.className = "rating-slider";
  const heading = document.createElement("div");
  heading.className = "rating-heading";
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = options.label;
  const output = document.createElement("output");
  const clear = document.createElement("button");
  clear.className = "rating-clear secondary";
  clear.type = "button";
  clear.textContent = "\u00d7";
  clear.title = options.clearLabel;
  clear.setAttribute("aria-label", options.clearLabel);
  const range = document.createElement("input");
  range.type = "range";
  range.min = "1";
  range.max = "5";
  range.step = "1";
  range.setAttribute("aria-label", options.label);
  const track = document.createElement("div");
  track.className = "rating-track";
  const ticks = document.createElement("div");
  ticks.className = "rating-ticks";
  ticks.setAttribute("aria-hidden", "true");
  for (const value of options.values) {
    const tick = document.createElement("i");
    tick.title = options.labels[value];
    ticks.append(tick);
  }
  heading.append(label, output, clear);
  track.append(range, ticks);
  element.append(heading, track);
  let value = options.value;
  const paint = () => {
    element.classList.toggle("rating-unset", value == null);
    range.value = String(value == null ? 3 : options.values.indexOf(value) + 1);
    const text = value == null ? options.unsetLabel : options.labels[value];
    output.textContent = text;
    output.title = text;
    range.setAttribute("aria-valuetext", text);
    clear.disabled = value == null;
  };
  const choose = () => {
    value = options.values[Number(range.value) - 1];
    paint();
    options.onChange?.(value);
  };
  range.oninput = choose;
  // Tapping the middle of an unset native range does not fire input: its placeholder is already there.
  range.addEventListener("pointerup", () => {
    if (value != null) return;
    choose();
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  clear.onclick = () => {
    value = null;
    paint();
    options.onChange?.(null);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  };
  paint();
  return { element, get value() { return value; } };
}

export const RATING_SLIDER_CSS = `
.rating-sliders{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.2rem}
.rating-slider{min-width:0}.rating-heading{display:flex;align-items:center;gap:0.4rem;min-width:0}
.rating-heading>.label{flex:none;margin:0}.rating-heading output{flex:1;min-width:0;text-align:right;font-size:0.867rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rating-slider button.rating-clear{flex:none;min-width:0;width:1.733rem;min-height:2.267rem;padding:0;background:transparent;color:var(--muted)}
.rating-track{position:relative;padding-bottom:0.4rem}
.rating-slider input[type=range]{display:block;width:100%;height:1.6rem;min-height:0;margin:0;padding:0;accent-color:var(--accent)}
.rating-ticks{position:absolute;left:8px;right:8px;bottom:0;display:flex;justify-content:space-between;pointer-events:none}
.rating-ticks i{width:1px;height:0.333rem;background:var(--muted)}
.rating-unset output{color:var(--muted)}.rating-unset input[type=range]{opacity:.45}
.rating-unset input[type=range]::-webkit-slider-thumb{opacity:0}
.rating-unset input[type=range]::-moz-range-thumb{opacity:0}
`;
