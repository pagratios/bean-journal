import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  askChoices, BALANCES, BODIES, createRatingSlider, type Balance, type DialogChoice, type RatingSliderOptions,
} from "./index";

class Node extends EventTarget {
  children: Node[] = [];
  attributes: Record<string, string> = {};
  className = "";
  classList = { toggle: (name: string, on: boolean) => {
    const classes = new Set(this.className.split(" "));
    if (on) classes.add(name); else classes.delete(name);
    this.className = [...classes].join(" ");
  } };
  textContent = "";
  title = "";
  type = "";
  min = "";
  max = "";
  step = "";
  value = "";
  disabled = false;
  open = false;
  removed = false;
  oninput?: () => void;
  onclick?: () => void;
  constructor(readonly tag: string) { super(); }
  append(...nodes: Node[]) { this.children.push(...nodes); }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event("close")); }
  remove() { this.removed = true; }
}
const labels = Object.fromEntries(BALANCES.map((value) => [value, value])) as Record<Balance, string>;
function setup() {
  const body = new Node("body");
  vi.stubGlobal("document", { body, createElement: (tag: string) => new Node(tag) });
  return body;
}
function slider(value: Balance | null | undefined) {
  const onChange = vi.fn();
  const options: RatingSliderOptions<Balance> = { label: "Taste", values: BALANCES, labels, value,
    unsetLabel: "Not rated", clearLabel: "Clear Taste", onChange };
  const control = createRatingSlider(options);
  const element = control.element as unknown as Node;
  const [heading, track] = element.children, [, output, clear] = heading.children, [range, ticks] = track.children;
  return { control, element, output, clear, range, ticks, onChange, options };
}
afterEach(() => vi.unstubAllGlobals());

describe("five-level ratings", () => {
  it("keeps all old labels at their original meanings and inserts only the intermediate levels", () => {
    expect(BALANCES).toEqual(["sour", "sour-balanced", "balanced", "balanced-bitter", "bitter"]);
    expect(BODIES).toEqual(["thin", "thin-medium", "medium", "medium-heavy", "heavy"]);
  });
  it.each(BALANCES)("preserves an existing %s without emitting an edit", (value) => {
    setup();
    const t = slider(value);
    expect(t.control.value).toBe(value);
    expect(t.range.value).toBe(String(BALANCES.indexOf(value) + 1));
    expect(t.output.textContent).toBe(value);
    expect(t.range.attributes).toMatchObject({ "aria-label": "Taste", "aria-valuetext": value });
    expect(t.onChange).not.toHaveBeenCalled();
  });
  it.each([undefined, null])("keeps %s unset until an explicit choice, including tapping the middle", (value) => {
    setup();
    const t = slider(value);
    expect(t.control.value).toBe(value);
    expect(t.range.value).toBe("3");
    expect(t.range.attributes["aria-valuetext"]).toBe("Not rated");
    expect(t.element.className).toContain("rating-unset");
    expect(t.clear.disabled).toBe(true);
    expect(t.onChange).not.toHaveBeenCalled();
    const input = vi.fn();
    t.element.addEventListener("input", input);
    t.range.dispatchEvent(new Event("pointerup"));
    expect(t.control.value).toBe("balanced");
    expect(t.element.className).not.toContain("rating-unset");
    expect(t.onChange).toHaveBeenLastCalledWith("balanced");
    expect(input).toHaveBeenCalledOnce();
    t.range.dispatchEvent(new Event("pointerup"));
    expect(t.onChange).toHaveBeenCalledOnce();
  });
  it("offers exactly five integer steps, all labels, and clears explicitly to null with a bubbling input", () => {
    setup();
    const t = slider(null), input = vi.fn();
    t.element.addEventListener("input", input);
    expect([t.range.min, t.range.max, t.range.step, t.ticks.children.length]).toEqual(["1", "5", "1", 5]);
    for (let i = 0; i < BALANCES.length; i++) {
      t.range.value = String(i + 1);
      t.range.oninput!();
      expect(t.control.value).toBe(BALANCES[i]);
      expect(t.output.textContent).toBe(BALANCES[i]);
      expect(t.onChange).toHaveBeenLastCalledWith(BALANCES[i]);
    }
    expect(t.clear.attributes["aria-label"]).toBe("Clear Taste");
    t.clear.onclick!();
    expect(t.control.value).toBeNull();
    expect(t.output.textContent).toBe("Not rated");
    expect(t.onChange).toHaveBeenLastCalledWith(null);
    expect((input.mock.calls[0][0] as Event).bubbles).toBe(true);
    expect(t.clear.disabled).toBe(true);
  });
  it("does not commit an unset placeholder when a pointer is cancelled", () => {
    setup();
    const t = slider(undefined);
    t.range.dispatchEvent(new Event("pointercancel"));
    expect(t.control.value).toBeUndefined();
    expect(t.onChange).not.toHaveBeenCalled();
  });
  it("refuses malformed scales and ratings rather than silently displaying a default", () => {
    setup();
    const t = slider(null);
    expect(() => createRatingSlider({ ...t.options, values: BALANCES.slice(0, 3) })).toThrow("invalidArguments");
    expect(() => createRatingSlider({ ...t.options, values: [...BALANCES.slice(0, 4), "sour"] })).toThrow("invalidArguments");
    expect(() => createRatingSlider({ ...t.options, labels: { ...labels, sour: "" } })).toThrow("invalidArguments");
  });
  it("serializes without module closures or browser globals at import time", () => {
    const body = setup();
    const t = slider(undefined);
    const control = runInNewContext(`(${createRatingSlider.toString()})(options)`, {
      document: { body, createElement: (tag: string) => new Node(tag) }, Event, options: t.options,
    }) as { element: Node; value: Balance | null | undefined };
    expect(control.value).toBeUndefined();
    control.element.children[1].children[0].dispatchEvent(new Event("pointerup"));
    expect(control.value).toBe("balanced");
  });
});

describe("shared choice dialog", () => {
  const choices: DialogChoice[] = [
    { label: "Cancel", value: "", kind: "secondary" }, { label: "Current profile and dose", value: "keep" },
    { label: "Its last shot", value: "last" }, { label: "Its best shot", value: "best" },
  ];
  it.each(choices)("returns $value, safely renders labels and removes the closed dialog", async (choice) => {
    const body = setup(), answer = askChoices("<Coffee>", choices, "");
    const dialog = body.children[0], [message, row] = dialog.children[0].children;
    expect(dialog.open).toBe(true);
    expect(dialog.className).toBe("msg choice-dialog");
    expect(dialog.attributes).toMatchObject({ role: "alertdialog", "aria-label": "<Coffee>" });
    expect(message.textContent).toBe("<Coffee>");
    expect(row.children.map((button) => button.textContent)).toEqual(choices.map((c) => c.label));
    row.children[choices.indexOf(choice)].onclick!();
    expect(await answer).toBe(choice.value);
    expect(dialog.removed).toBe(true);
  });
  it.each(["host", "backdrop", "escape"])("keeps the dismiss value for %s dismissal", async (how) => {
    const body = setup(), answer = askChoices("Coffee", choices, "dismissed");
    const dialog = body.children[0];
    if (how === "backdrop") {
      const event = new Event("pointerdown", { cancelable: true });
      dialog.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    } else {
      // Escape's native dialog behavior and a host close both trigger close without a choice.
      dialog.close();
    }
    expect(await answer).toBe("dismissed");
    expect(dialog.removed).toBe(true);
  });
  it("does not dismiss a pointer event from inside the box", async () => {
    const body = setup(), answer = askChoices("Coffee", choices, "");
    const dialog = body.children[0], event = new Event("pointerdown");
    Object.defineProperty(event, "target", { value: dialog.children[0] });
    dialog.dispatchEvent(event);
    expect(dialog.open).toBe(true);
    dialog.close();
    expect(await answer).toBe("");
  });
  it("can be serialized into another plugin's browser client", async () => {
    const body = setup();
    const answer = runInNewContext(`(${askChoices.toString()})("Coffee", choices, "")`, {
      document: { body, createElement: (tag: string) => new Node(tag) }, choices,
    }) as Promise<string>;
    body.children[0].children[0].children[1].children[3].onclick!();
    expect(await answer).toBe("best");
  });
});
