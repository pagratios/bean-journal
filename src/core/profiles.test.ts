import { describe, expect, it, vi } from "vitest";
import { deleteProfile, DELETE_PROFILE_TOOL, type ObjectData } from "./index";

const body = { profileId: "profile:custom", expectedUpdatedAt: "before", confirmed: true };
const record = { id: body.profileId, updatedAt: "before", visibility: "visible", isDefault: false };
function setup(saved: unknown = record) {
  const request = vi.fn(async (_path: string, method = "GET"): Promise<unknown> => method === "GET" ? saved : null);
  const idle = vi.fn(async () => {});
  return { request, idle };
}

describe("shared profile deletion", () => {
  it("exports the full-access, always-confirmed MCP action contract", () => {
    expect(DELETE_PROFILE_TOOL).toMatchObject({ name: "delete_profile", level: "full", kind: "machine", alwaysConfirm: true });
    expect(DELETE_PROFILE_TOOL.call({ profile_id: body.profileId, expected_updated_at: "before" }))
      .toEqual({ action: "delete-profile", body });
  });

  it("checks machine safety, rereads the revision and accepts an empty DELETE answer without URL", async () => {
    const runtime = setup();
    vi.stubGlobal("URL", undefined);
    try {
      expect(await deleteProfile(body, runtime)).toEqual({ deleted: true, profileId: body.profileId });
    } finally { vi.unstubAllGlobals(); }
    expect(runtime.idle).toHaveBeenCalledOnce();
    expect(runtime.idle.mock.invocationCallOrder[0]).toBeLessThan(runtime.request.mock.invocationCallOrder[0]);
    expect(runtime.request.mock.calls).toEqual([
      ["/profiles/profile%3Acustom"], ["/profiles/profile%3Acustom", "DELETE"],
    ]);
  });

  it.each([
    [{ confirmed: false }, "confirmation"], [{ confirmed: "true" }, "confirmation"],
    [{ profileId: "../p" }, "invalidId"], [{ expectedUpdatedAt: "" }, "invalidArguments"],
    [{ expectedUpdatedAt: " " }, "invalidArguments"], [{ expectedUpdatedAt: 1 }, "invalidArguments"],
  ] as const)("rejects invalid input %j before reaching Decaid", async (patch, code) => {
    const runtime = setup();
    await expect(deleteProfile({ ...body, ...patch }, runtime)).rejects.toThrow(code);
    expect(runtime.request).not.toHaveBeenCalled();
    expect(runtime.idle).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...record, visibility: "deleted" }, "notFound"],
    [{ ...record, updatedAt: "after" }, "profileChanged"],
    [{ ...record, isDefault: true }, "deleteDefaultProfile"],
    [{ ...record, id: "profile:other" }, "invalidData"],
    [null, "invalidData"],
  ] as const)("rejects unsafe records %j without writing", async (saved, code) => {
    const runtime = setup(saved);
    await expect(deleteProfile(body, runtime)).rejects.toThrow(code);
    expect(runtime.request).toHaveBeenCalledTimes(1);
  });

  it("catches an external edit during the safety check", async () => {
    const saved: ObjectData = { ...record };
    const runtime = setup(saved);
    runtime.idle.mockImplementation(async () => { saved.updatedAt = "after"; });
    await expect(deleteProfile(body, runtime)).rejects.toThrow("profileChanged");
    expect(runtime.request).toHaveBeenCalledTimes(1);
  });

  it.each(["machineBusy", "network"])("propagates safety failures (%s) without accessing profiles", async (code) => {
    const runtime = setup();
    runtime.idle.mockRejectedValue(new Error(code));
    await expect(deleteProfile(body, runtime)).rejects.toThrow(code);
    expect(runtime.request).not.toHaveBeenCalled();
  });

  it.each(["GET", "DELETE"])("propagates %s failures, never returning deletion success", async (method) => {
    const runtime = setup();
    runtime.request.mockImplementation(async (_path, verb = "GET") => {
      if (verb === method) throw new Error("requestFailed");
      return record;
    });
    await expect(deleteProfile(body, runtime)).rejects.toThrow("requestFailed");
    expect(runtime.request).toHaveBeenCalledTimes(method === "GET" ? 1 : 2);
  });
});
