import { describe, expect, it, vi } from "vitest";
import { OperationError } from "../src/shared/errors";
import {
  createWriteGuard,
  getWriteProgress,
  trackWrite,
} from "../src/server/write-guard";

describe("mutation progress and retry safety", () => {
  it("does not replay while a parallel mutation is still awaiting its result", async () => {
    const once = createWriteGuard(1);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let mutation: Promise<void> | undefined;
    const action = vi.fn(async () => {
      mutation = trackWrite(() => pending);
      throw new OperationError("A parallel read failed", "unavailable");
    });
    await expect(once("parallel", {}, action)).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(once("parallel", {}, action)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(action).toHaveBeenCalledOnce();
    await expect(once("other", {}, async () => "other")).rejects.toThrow(
      "still being processed",
    );
    finish();
    await mutation;
    await expect(once("parallel", {}, action)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(action).toHaveBeenCalledOnce();
  });

  it("retries a recovered preflight with the same ID while preserving its payload binding", async () => {
    const once = createWriteGuard<string>();
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new OperationError("Reconnect", "auth"))
      .mockImplementation(() => trackWrite(async () => "saved"));
    await expect(once("same", { title: "one" }, action)).rejects.toMatchObject({
      code: "auth",
    });
    await expect(
      once("same", { title: "different" }, action),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(once("same", { title: "one" }, action)).resolves.toBe("saved");
    await expect(once("same", { title: "one" }, action)).resolves.toBe("saved");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("retains a confirmed mutation when its following read fails", async () => {
    const once = createWriteGuard();
    const action = vi.fn(async () => {
      await trackWrite(async () => "saved");
      expect(getWriteProgress()).toEqual({ confirmed: true, uncertain: false });
      throw new OperationError("Read failed", "unavailable");
    });
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(once("saved", {}, action)).rejects.toMatchObject({
        code: "unavailable",
      });
    expect(action).toHaveBeenCalledOnce();
  });

  it("retains a dispatched mutation whose response was lost", async () => {
    const once = createWriteGuard();
    const action = vi.fn(() =>
      trackWrite(async () => {
        throw new OperationError("Response lost", "timeout");
      }),
    );
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(once("unknown", {}, action)).rejects.toMatchObject({
        code: "timeout",
      });
    expect(action).toHaveBeenCalledOnce();
  });

  it("allows a definite provider rejection to retry after permissions recover", async () => {
    const once = createWriteGuard<string>();
    const mutation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        new OperationError("Permission denied", "forbidden"),
      )
      .mockResolvedValue("saved");
    const action = () =>
      trackWrite(
        mutation,
        (error) =>
          error instanceof OperationError && error.code === "forbidden",
      );
    await expect(once("permission", {}, action)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(once("permission", {}, action)).resolves.toBe("saved");
    expect(mutation).toHaveBeenCalledTimes(2);
  });

  it("propagates nested mutations to the outer guard without leaking between operations", async () => {
    const outer = createWriteGuard();
    const inner = createWriteGuard();
    const action = vi.fn(async () => {
      await inner("child", {}, () => trackWrite(async () => "saved"));
      throw new OperationError("Later permission check failed", "forbidden");
    });
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(outer("parent", {}, action)).rejects.toMatchObject({
        code: "forbidden",
      });
    expect(action).toHaveBeenCalledOnce();
    expect(getWriteProgress()).toEqual({ confirmed: false, uncertain: false });
  });
});
