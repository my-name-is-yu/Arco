import { describe, expect, it } from "vitest";
import { createToolQueue } from "../src/ui/tool-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("UI tool request queue", () => {
  it("runs at most two callbacks and starts waiting requests in arrival order", async () => {
    const queue = createToolQueue();
    const gates = Array.from({ length: 6 }, () => deferred<number>());
    const started: number[] = [];
    let active = 0;
    let maximum = 0;
    const calls = gates.map((gate, index) =>
      queue.run(() => {
        started.push(index);
        active += 1;
        maximum = Math.max(maximum, active);
        return gate.promise.finally(() => {
          active -= 1;
        });
      }),
    );
    expect(started).toEqual([0, 1]);

    gates[1].resolve(1);
    await expect(calls[1]).resolves.toBe(1);
    expect(started).toEqual([0, 1, 2]);
    expect(active).toBe(2);

    gates[0].resolve(0);
    await expect(calls[0]).resolves.toBe(0);
    expect(started).toEqual([0, 1, 2, 3]);
    for (let index = 2; index < gates.length; index++)
      gates[index].resolve(index);
    await expect(Promise.all(calls)).resolves.toEqual([0, 1, 2, 3, 4, 5]);
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maximum).toBe(2);
    expect(active).toBe(0);
  });

  it("releases rejected requests without retrying or replaying a write", async () => {
    const queue = createToolQueue();
    const rejected = deferred<void>();
    const held = deferred<void>();
    const started: string[] = [];
    const failure = new Error("Source write response was lost");
    const write = queue.run(() => {
      started.push("write once");
      return rejected.promise;
    });
    const read = queue.run(() => {
      started.push("held read");
      return held.promise;
    });
    const next = queue.run(async () => {
      started.push("next read");
      return "latest source";
    });
    const failedWrite = expect(write).rejects.toBe(failure);
    rejected.reject(failure);
    await failedWrite;
    await expect(next).resolves.toBe("latest source");
    expect(started).toEqual(["write once", "held read", "next read"]);
    held.resolve();
    await read;

    const syncFailure = new Error("Callback failed before starting RPC");
    await expect(
      queue.run(() => {
        throw syncFailure;
      }),
    ).rejects.toBe(syncFailure);
    await expect(queue.run(async () => "still available")).resolves.toBe(
      "still available",
    );
    expect(started.filter((value) => value === "write once")).toHaveLength(1);
  });

  it("closes waiting and future requests while allowing started calls to settle once", async () => {
    const queue = createToolQueue();
    const saved = deferred<string>();
    const failed = deferred<string>();
    const started: string[] = [];
    const write = queue.run(() => {
      started.push("active write");
      return saved.promise;
    });
    const read = queue.run(() => {
      started.push("active read");
      return failed.promise;
    });
    const waiting = ["waiting write", "waiting read"].map((name) =>
      queue.run(async () => {
        started.push(name);
        return name;
      }),
    );
    const notStarted = waiting.map((request) =>
      expect(request).rejects.toThrow("This request was not started"),
    );
    queue.close();
    queue.close();
    await Promise.all(notStarted);
    await expect(
      queue.run(async () => {
        started.push("future write");
        return "unexpected";
      }),
    ).rejects.toThrow("This request was not started");
    expect(started).toEqual(["active write", "active read"]);

    const sourceError = new Error("Original in-flight source error");
    const failedRead = expect(read).rejects.toBe(sourceError);
    saved.resolve("confirmed saved once");
    failed.reject(sourceError);
    await expect(write).resolves.toBe("confirmed saved once");
    await failedRead;
    expect(started).toEqual(["active write", "active read"]);
  });
});
