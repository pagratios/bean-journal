export type PointerGuardOptions = { isBusy: () => boolean; onIdle: () => void };

/** Self-contained so a serialized browser client can receive this factory as an argument. */
export function createPointerGuard(options: PointerGuardOptions) {
  const pointers = new Set<number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    if (pointers.size) return;
    if (options.isBusy()) { timer = setTimeout(flush, 100); return; }
    options.onIdle();
  }
  function soon() {
    clearTimeout(timer);
    // Click/hold handlers run after pointerup; let their action finish before changing its target.
    timer = setTimeout(flush, 0);
  }
  return {
    get active() { return pointers.size > 0; },
    hold(id: number) { pointers.add(id); },
    release(id: number) { if (pointers.delete(id)) soon(); },
    clear() { pointers.clear(); soon(); },
    dispose() { pointers.clear(); clearTimeout(timer); },
  };
}
