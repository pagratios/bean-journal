// What stock Streamline shows for Bean Journal: the core's surfaces with Bean Journal's button, coffee and water.
import type { Copy } from "./i18n";
import { optionalObject, tagOf, text, waterName, type ObjectData } from "./protocol";
import { streamlineSurfaces, type Kept } from "./core/surfaces";

export { round1, type Kept } from "./core/surfaces";

/** The coffee the next shot is for: the workflow's, else the one kept while Streamline's clean-up is being undone. */
export function nextCoffee(context: ObjectData) {
  const gear = optionalObject(tagOf(context).gear);
  const name = text(context.coffeeName) || (!context.beanBatchId ? text(gear.coffeeName) : "");
  const roaster = text(context.coffeeName) ? text(context.coffeeRoaster) : name ? text(gear.coffeeRoaster) : "";
  return name ? { name, roaster } : null;
}

export type SkinInput = {
  s: Copy["skin"];
  workflow: ObjectData;
  kept: Kept | null;
  /** The grind of the coffee's newest shot ("" when none or unknown). */
  lastGrind: string;
  now: number;
};

export function skinSurfaces({ s, workflow, kept, lastGrind, now }: SkinInput) {
  const context = optionalObject(workflow.context);
  const coffee = nextCoffee(context);
  return streamlineSurfaces({
    s, workflow, kept, now,
    button: { id: "bean-journal", label: coffee?.name || s.button, text: coffee ? coffee.roaster : s.choose, view: coffee ? "shot" : "pick", saverLabel: s.button },
    lastGrind: coffee ? lastGrind : "",
    water: waterName(tagOf(context).water),
  });
}