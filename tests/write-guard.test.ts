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
    await expect(once("other", {}, async () => "other")).resolves.toBe("other");
    await expect(once("parallel", {}, action)).rejects.toMatchObject({
      code: "uncertain",
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
    const outer = createWriteGuard(1);
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
    await outer("later", {}, async () => "later");
    await expect(outer("parent", {}, action)).rejects.toMatchObject({
      code: "uncertain",
    });
    expect(action).toHaveBeenCalledOnce();
    expect(getWriteProgress()).toEqual({ confirmed: false, uncertain: false });
  });

  it("keeps completed request IDs bound after more than the default result retention limit", async () => {
    const once = createWriteGuard<string>();
    const action = vi.fn(() => trackWrite(async () => "original result"));
    const payload = { body: "One fictional comment" };
    await expect(once("original", payload, action)).resolves.toBe(
      "original result",
    );
    await expect(once("original", payload, action)).resolves.toBe(
      "original result",
    );
    for (let index = 0; index < 512; index++)
      await once(`later-${index}`, { index }, () =>
        trackWrite(async () => "later"),
      );
    await expect(once("original", payload, action)).rejects.toMatchObject({
      code: "uncertain",
      message: expect.stringMatching(/refresh.*without repeating/i),
    });
    await expect(
      once("original", { body: "A different comment" }, action),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(action).toHaveBeenCalledOnce();
  });

  it.each(["unknown", "saved-refresh"] as const)(
    "does not replay an evicted %s result",
    async (outcome) => {
      const once = createWriteGuard(1);
      const action = vi.fn(async () => {
        await trackWrite(async () => {
          if (outcome === "unknown")
            throw new OperationError("Response lost", "timeout");
          return "saved";
        });
        throw new OperationError("The following read failed", "unavailable");
      });
      const code = outcome === "unknown" ? "timeout" : "unavailable";
      await expect(once("first", {}, action)).rejects.toMatchObject({ code });
      await expect(once("first", {}, action)).rejects.toMatchObject({ code });
      await once("later", {}, async () => "later");
      await expect(once("first", {}, action)).rejects.toMatchObject({
        code: "uncertain",
      });
      await expect(
        once("first", { changed: true }, action),
      ).rejects.toMatchObject({ code: "conflict" });
      expect(action).toHaveBeenCalledOnce();
    },
  );

  it.each(["preflight", "provider-rejection"] as const)(
    "recovers an evicted definite %s failure with the same payload only",
    async (failure) => {
      const once = createWriteGuard<string>(1);
      const mutation = vi.fn<() => Promise<string>>();
      const action = vi.fn<() => Promise<string>>();
      if (failure === "preflight") {
        mutation.mockResolvedValue("saved");
        action.mockRejectedValueOnce(new OperationError("Reconnect", "auth"));
      } else {
        mutation
          .mockRejectedValueOnce(
            new OperationError("Permission denied", "forbidden"),
          )
          .mockResolvedValue("saved");
      }
      action.mockImplementation(() =>
        trackWrite(
          mutation,
          (error) =>
            error instanceof OperationError && error.code === "forbidden",
        ),
      );
      await expect(
        once("recover", { title: "same" }, action),
      ).rejects.toMatchObject({
        code: failure === "preflight" ? "auth" : "forbidden",
      });
      await once("later", {}, async () => "later");
      await expect(
        once("recover", { title: "different" }, action),
      ).rejects.toMatchObject({ code: "conflict" });
      await expect(
        Promise.all([
          once("recover", { title: "same" }, action),
          once("recover", { title: "same" }, action),
        ]),
      ).resolves.toEqual(["saved", "saved"]);
      expect(action).toHaveBeenCalledTimes(2);
      await once("last", {}, async () => "last");
      await expect(
        once("recover", { title: "same" }, action),
      ).rejects.toMatchObject({ code: "uncertain" });
      expect(action).toHaveBeenCalledTimes(2);
    },
  );
});
