import { afterEach, expect, it, vi } from "vitest";
import { createPointerGuard } from "./index";

afterEach(() => vi.useRealTimers());

it("waits for every pointer and the following click action before applying a queued paint", async () => {
  vi.useFakeTimers();
  let busy = false;
  const onIdle = vi.fn(), guard = createPointerGuard({ isBusy: () => busy, onIdle });
  guard.hold(1); guard.hold(2);
  guard.release(1);
  await vi.runOnlyPendingTimersAsync();
  expect(guard.active).toBe(true);
  expect(onIdle).not.toHaveBeenCalled();
  guard.release(2);
  busy = true;
  await vi.advanceTimersByTimeAsync(250);
  expect(onIdle).not.toHaveBeenCalled();
  busy = false;
  await vi.advanceTimersByTimeAsync(100);
  expect(onIdle).toHaveBeenCalledTimes(1);
});

it("clears cancelled/hidden gestures and disposes scheduled work", async () => {
  vi.useFakeTimers();
  const onIdle = vi.fn(), guard = createPointerGuard({ isBusy: () => false, onIdle });
  guard.hold(1);
  guard.clear();
  await vi.runOnlyPendingTimersAsync();
  expect(guard.active).toBe(false);
  expect(onIdle).toHaveBeenCalledTimes(1);
  guard.release(99);
  await vi.runOnlyPendingTimersAsync();
  expect(onIdle).toHaveBeenCalledTimes(1);
  guard.hold(2); guard.release(2); guard.dispose();
  await vi.runOnlyPendingTimersAsync();
  expect(onIdle).toHaveBeenCalledTimes(1);
});
