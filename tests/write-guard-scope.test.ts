import { describe, expect, it, vi } from "vitest";
import { OperationError } from "../src/shared/errors";
import {
  createWriteGuard,
  getWriteProgress,
  trackWrite,
} from "../src/server/write-guard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (failure: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const mismatch = {
  code: "conflict",
  message: expect.stringMatching(
    /earlier provider sign-in.*refresh.*without repeating/i,
  ),
};

describe("optional write authorization scope", () => {
  it("coalesces concurrent calls and immediate retries within the same scope", async () => {
    const read = vi.fn().mockResolvedValue("generation-A");
    const once = createWriteGuard<string>(256, undefined, read);
    const started = deferred<void>();
    const result = deferred<string>();
    const mutation = vi.fn(() => {
      started.resolve();
      return result.promise;
    });
    const write = () => trackWrite(mutation);
    const one = once("same", {}, write);
    const two = once("same", {}, write);
    await started.promise;
    result.resolve("saved");
    await expect(Promise.all([one, two])).resolves.toEqual(["saved", "saved"]);
    await expect(once("same", {}, write)).resolves.toBe("saved");
    expect(mutation).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalled();
  });

  it("rejects an earlier scope before cached results or changed-payload reuse and allows fresh IDs", async () => {
    const read = vi.fn().mockResolvedValue("generation-A");
    const once = createWriteGuard<string>(256, undefined, read);
    const write = vi.fn(() => trackWrite(async () => "old private result"));
    await expect(once("same", { title: "one" }, write)).resolves.toBe(
      "old private result",
    );
    read.mockResolvedValue("generation-B");
    await expect(once("same", { title: "one" }, write)).rejects.toMatchObject(
      mismatch,
    );
    await expect(
      once("same", { title: "changed" }, write),
    ).rejects.toMatchObject(mismatch);
    expect(write).toHaveBeenCalledOnce();
    await expect(
      once("fresh", {}, () => trackWrite(async () => "new result")),
    ).resolves.toBe("new result");
  });

  it.each(["result", "error"] as const)(
    "does not expose an old pending %s after a scope change",
    async (outcome) => {
      const read = vi.fn().mockResolvedValue("generation-A");
      const once = createWriteGuard<string>(256, undefined, read);
      const started = deferred<void>();
      const pending = deferred<string>();
      const callback = vi.fn(() => {
        started.resolve();
        return pending.promise;
      });
      const results = Promise.allSettled([
        once("pending", {}, callback),
        once("pending", {}, callback),
      ]);
      await started.promise;
      read.mockResolvedValue("generation-B");
      if (outcome === "result") pending.resolve("old private result");
      else pending.reject(new OperationError("old private error", "forbidden"));
      for (const result of await results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason).toMatchObject(mismatch);
          expect(String(result.reason)).not.toMatch(
            /old private|generation-[AB]/,
          );
        }
      }
      expect(callback).toHaveBeenCalledOnce();
    },
  );

  it("checks an inherited authorization before returning an unscoped child's cached result", async () => {
    const read = vi.fn().mockResolvedValue("generation-A");
    const outer = createWriteGuard<string>(256, undefined, read);
    const inner = createWriteGuard<string>();
    const callback = vi.fn(async () => "old private result");
    await outer("parent-A", {}, () => inner("child", {}, callback));
    read.mockResolvedValue("generation-B");
    await expect(
      outer("parent-B", {}, () => inner("child", {}, callback)),
    ).rejects.toMatchObject(mismatch);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("rechecks authorization before starting a callback after initial scope capture", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce("generation-A")
      .mockResolvedValue("generation-B");
    const once = createWriteGuard(256, undefined, read);
    const write = vi.fn(async () => "must not execute");
    await expect(
      once("switch-before-callback", {}, write),
    ).rejects.toMatchObject(mismatch);
    expect(write).not.toHaveBeenCalled();
  });

  it("stops a waiting preflight before dispatch and allows definite recovery under its original scope", async () => {
    const read = vi.fn().mockResolvedValue("generation-A");
    const once = createWriteGuard<string>(256, undefined, read);
    const started = deferred<void>();
    const release = deferred<void>();
    const mutation = vi.fn(async () => "saved");
    const action = vi.fn(async () => {
      started.resolve();
      await release.promise;
      return trackWrite(mutation);
    });
    const pending = once("preflight", {}, action);
    await started.promise;
    read.mockResolvedValue("generation-B");
    release.resolve();
    await expect(pending).rejects.toMatchObject(mismatch);
    expect(mutation).not.toHaveBeenCalled();
    await expect(once("preflight", {}, action)).rejects.toMatchObject(mismatch);
    read.mockResolvedValue("generation-A");
    await expect(once("preflight", {}, action)).resolves.toBe("saved");
    expect(mutation).toHaveBeenCalledOnce();
  });

  it.each(["callback", "mutation"] as const)(
    "checks every parent authorization before a nested %s",
    async (boundary) => {
      const readOuter = vi.fn().mockResolvedValue("outer-A");
      const readInner = vi.fn().mockResolvedValue("inner-A");
      const outer = createWriteGuard(256, undefined, readOuter);
      const inner = createWriteGuard(256, undefined, readInner);
      const started = deferred<void>();
      const release = deferred<void>();
      const mutation = vi.fn(async () => "saved");
      const child = vi.fn(async () => {
        if (boundary === "mutation") {
          started.resolve();
          await release.promise;
        }
        return trackWrite(mutation);
      });
      const pending = outer("parent", {}, async () => {
        if (boundary === "callback") {
          started.resolve();
          await release.promise;
        }
        return inner("child", {}, child);
      });
      await started.promise;
      readOuter.mockResolvedValue("outer-B");
      release.resolve();
      await expect(pending).rejects.toMatchObject(mismatch);
      expect(mutation).not.toHaveBeenCalled();
      expect(child).toHaveBeenCalledTimes(boundary === "callback" ? 0 : 1);
    },
  );

  it.each(["scope-change", "getter-failure"] as const)(
    "marks a completed mutation before a later %s and never replays it",
    async (change) => {
      const read = vi.fn().mockResolvedValue("generation-A");
      const once = createWriteGuard<string>(1, undefined, read);
      const observed: ReturnType<typeof getWriteProgress>[] = [];
      const mutation = vi.fn(async () => {
        if (change === "scope-change") read.mockResolvedValue("generation-B");
        else read.mockRejectedValue(new Error("secret generation value"));
        return "saved";
      });
      const action = () =>
        trackWrite(mutation).catch((error) => {
          observed.push(getWriteProgress());
          throw error;
        });
      await expect(once("completed", {}, action)).rejects.toMatchObject({
        code: change === "scope-change" ? "conflict" : "auth",
      });
      expect(observed).toEqual([{ confirmed: true, uncertain: false }]);
      read.mockResolvedValue("generation-A");
      await expect(once("completed", {}, action)).rejects.toBeInstanceOf(
        OperationError,
      );
      expect(mutation).toHaveBeenCalledOnce();
      await once("later", {}, async () => "later");
      await expect(once("completed", {}, action)).rejects.toMatchObject({
        code: "uncertain",
      });
      expect(mutation).toHaveBeenCalledOnce();
    },
  );

  it.each([
    {
      label: "unexpected error",
      failure: new Error("secret generation value"),
      code: "auth",
    },
    {
      label: "authored provider error",
      failure: new OperationError("Reconnect the provider", "forbidden"),
      code: "forbidden",
    },
    { label: "empty scope", value: "", code: "auth" },
    { label: "invalid scope", value: 42, code: "auth" },
  ])(
    "fails closed on $label and recovers without binding or executing the failed request",
    async (scenario) => {
      const read = vi
        .fn<() => Promise<string>>()
        .mockResolvedValue("generation-A");
      if ("failure" in scenario) read.mockRejectedValueOnce(scenario.failure);
      else read.mockResolvedValueOnce(scenario.value as string);
      const failure = vi.fn(
        (message: string, code = "unavailable") =>
          new OperationError(message, code),
      );
      const once = createWriteGuard<string>(256, failure, read);
      const mutation = vi.fn(async () => "saved");
      await expect(
        once("recover", { title: "first" }, () => trackWrite(mutation)),
      ).rejects.toMatchObject({
        code: scenario.code,
        message: expect.not.stringContaining("secret generation"),
      });
      expect(mutation).not.toHaveBeenCalled();
      await expect(
        once("recover", { title: "changed before binding" }, () =>
          trackWrite(mutation),
        ),
      ).resolves.toBe("saved");
      expect(mutation).toHaveBeenCalledOnce();
      if (scenario.code === "auth") expect(failure).toHaveBeenCalled();
    },
  );

  it("keeps retired bindings scoped without clearing or replaying them", async () => {
    const read = vi.fn().mockResolvedValue("generation-A");
    const once = createWriteGuard<string>(1, undefined, read);
    const mutation = vi.fn(async () => "saved");
    await once("original", { title: "same" }, () => trackWrite(mutation));
    await once("later", {}, async () => "later");
    read.mockResolvedValue("generation-B");
    await expect(
      once("original", { title: "same" }, () => trackWrite(mutation)),
    ).rejects.toMatchObject(mismatch);
    await expect(
      once("original", { title: "different" }, () => trackWrite(mutation)),
    ).rejects.toMatchObject(mismatch);
    await once("fresh", {}, async () => "new result");
    read.mockResolvedValue("generation-A");
    await expect(
      once("original", { title: "same" }, () => trackWrite(mutation)),
    ).rejects.toMatchObject({ code: "uncertain" });
    await expect(
      once("original", { title: "different" }, () => trackWrite(mutation)),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(mutation).toHaveBeenCalledOnce();
  });

  it("passes typed payload context to the scope getter", async () => {
    const read = vi.fn(
      async (payload: readonly [string, { connectionId: string }]) =>
        payload[1].connectionId,
    );
    const once = createWriteGuard<
      string,
      readonly [string, { connectionId: string }]
    >(256, undefined, read);
    await expect(
      once("typed", ["linear_comment", { connectionId: "default" }], () =>
        trackWrite(async () => "saved"),
      ),
    ).resolves.toBe("saved");
    expect(read).toHaveBeenCalledWith([
      "linear_comment",
      { connectionId: "default" },
    ]);
  });

  it.each(["active", "retired"] as const)(
    "binds an inherited retryable %s request to its original authorization and permits same-scope recovery",
    async (retention) => {
      const read = vi.fn().mockResolvedValue("generation-A");
      const outer = createWriteGuard<string>(256, undefined, read);
      const child = createWriteGuard<string>(1);
      const mutation = vi.fn(async () => "saved");
      const action = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(
          new OperationError("Preflight unavailable", "unavailable"),
        )
        .mockImplementation(() => trackWrite(mutation));
      const payload = { title: "same" };
      await expect(
        outer("parent-A", {}, () => child("child", payload, action)),
      ).rejects.toMatchObject({ code: "unavailable" });
      if (retention === "retired")
        await outer("churn", {}, () => child("later", {}, async () => "later"));
      read.mockResolvedValue("generation-B");
      await expect(
        outer("parent-B", {}, () => child("child", payload, action)),
      ).rejects.toMatchObject(mismatch);
      expect(mutation).not.toHaveBeenCalled();
      expect(action).toHaveBeenCalledOnce();
      read.mockResolvedValue("generation-A");
      await expect(
        Promise.all([
          outer("recover-one", {}, () => child("child", payload, action)),
          outer("recover-two", {}, () => child("child", payload, action)),
        ]),
      ).resolves.toEqual(["saved", "saved"]);
      expect(mutation).toHaveBeenCalledOnce();
      expect(action).toHaveBeenCalledTimes(2);
    },
  );

  it("deduplicates a scoped request through deeper parents with duplicate generations", async () => {
    const read = vi.fn().mockResolvedValue("generation-A");
    const outer = createWriteGuard<string>(256, undefined, read);
    const middle = createWriteGuard<string>(256, undefined, read);
    const child = createWriteGuard<string>(256, undefined, read);
    const mutation = vi.fn(async () => "saved");
    const action = () => trackWrite(mutation);
    await expect(child("same", {}, action)).resolves.toBe("saved");
    await expect(
      outer("parent", {}, () =>
        middle("middle", {}, () => child("same", {}, action)),
      ),
    ).resolves.toBe("saved");
    expect(mutation).toHaveBeenCalledOnce();
  });

  it.each(["active", "retired"] as const)(
    "keeps a scoped retryable %s request's own principal distinct from its parent",
    async (retention) => {
      const readParent = vi.fn().mockResolvedValue("generation-B");
      const readChild = vi.fn().mockResolvedValue("generation-A");
      const parent = createWriteGuard<string>(256, undefined, readParent);
      const child = createWriteGuard<string>(1, undefined, readChild);
      const mutation = vi.fn(async () => "saved");
      const action = vi
        .fn<() => Promise<string>>()
        .mockRejectedValueOnce(
          new OperationError("Preflight unavailable", "unavailable"),
        )
        .mockImplementation(() => trackWrite(mutation));
      const payload = { title: "same" };
      await expect(
        parent("parent-B", {}, () => child("child-A", payload, action)),
      ).rejects.toMatchObject({ code: "unavailable" });
      if (retention === "retired")
        await parent("churn", {}, () =>
          child("later", {}, async () => "later"),
        );
      readParent.mockResolvedValue("generation-A");
      readChild.mockResolvedValue("generation-B");
      await expect(
        parent("parent-A", {}, () => child("child-A", payload, action)),
      ).rejects.toMatchObject(mismatch);
      expect(mutation).not.toHaveBeenCalled();
      expect(action).toHaveBeenCalledOnce();
      readParent.mockResolvedValue("generation-B");
      readChild.mockResolvedValue("generation-A");
      await expect(
        parent("recover", {}, () => child("child-A", payload, action)),
      ).resolves.toBe("saved");
      expect(mutation).toHaveBeenCalledOnce();
      expect(action).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps equivalent inherited authorization order from changing request identity", async () => {
    const readA = vi.fn().mockResolvedValue("generation-A");
    const readB = vi.fn().mockResolvedValue("generation-B");
    const parentA = createWriteGuard<string>(256, undefined, readA);
    const parentB = createWriteGuard<string>(256, undefined, readB);
    const child = createWriteGuard<string>();
    const mutation = vi.fn(async () => "saved");
    const action = () => trackWrite(mutation);
    await expect(
      parentA("outer-A", {}, () =>
        parentB("inner-B", {}, () => child("same", {}, action)),
      ),
    ).resolves.toBe("saved");
    await expect(
      parentB("outer-B", {}, () =>
        parentA("inner-A", {}, () => child("same", {}, action)),
      ),
    ).resolves.toBe("saved");
    expect(mutation).toHaveBeenCalledOnce();
  });
});
