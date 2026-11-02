import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArcoHost } from "../src/shared/contracts";
import type { Draft, DraftKey } from "../src/shared/state";
import { draftController, draftStorageId } from "../src/ui/useDraftPersistence";

const key: DraftKey = {
  source: "github",
  ownerId: "owner-a",
  repo: "yu/Arco",
  issue: "42",
};
const draft = (comment: string): Draft => ({ title: "", body: "", comment });
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("keyed draft subscriptions", () => {
  it("publishes every pending value only to that key's subscribers", () => {
    vi.useFakeTimers();
    const controller = draftController({} as ArcoHost);
    const unrelated = Array.from({ length: 250 }, (_, index) => ({
      ...key,
      issue: String(index + 100),
    }));
    const notifications = unrelated.map((other) => {
      controller.schedule(other, draft("Retained input"));
      const listener = vi.fn();
      controller.subscribe(draftStorageId(other), listener);
      return listener;
    });
    const retainedId = draftStorageId(unrelated[0]);
    const retainedSnapshot = controller.get(retainedId);
    const id = draftStorageId(key);
    expect(controller.get(id)).toBeUndefined();
    const first = vi.fn();
    const second = vi.fn();
    controller.subscribe(id, first);
    controller.subscribe(id, second);
    controller.schedule(key, draft("First"));
    const snapshot = controller.get(id);
    expect(controller.get(id)).toBe(snapshot);
    expect(snapshot?.state).toBe("pending");
    controller.schedule(key, draft("Second"));
    expect(controller.get(id)).not.toBe(snapshot);
    expect(controller.get(id)?.state).toBe("pending");
    expect(controller.value(key)?.comment).toBe("Second");
    expect(first).toHaveBeenCalledTimes(2);
    expect(second).toHaveBeenCalledTimes(2);
    expect(
      notifications.every((listener) => listener.mock.calls.length === 0),
    ).toBe(true);
    expect(controller.get(retainedId)).toBe(retainedSnapshot);
  });

  it("detaches old subscriptions and preserves separate owners and providers on remount", () => {
    vi.useFakeTimers();
    const host = {} as ArcoHost;
    const controller = draftController(host);
    const otherOwner = { ...key, ownerId: "owner-b" };
    const linear: DraftKey = {
      source: "linear",
      ownerId: key.ownerId,
      workspaceId: "workspace",
      teamId: "team",
      issue: key.issue,
    };
    const oldListener = vi.fn();
    const otherListener = vi.fn();
    const linearListener = vi.fn();
    const id = draftStorageId(key);
    const unsubscribe = controller.subscribe(id, oldListener);
    controller.subscribe(draftStorageId(otherOwner), otherListener);
    controller.subscribe(draftStorageId(linear), linearListener);
    controller.schedule(key, draft("Original owner"));
    unsubscribe();
    unsubscribe();
    controller.schedule(key, draft("Retained after unsubscribe"));
    controller.schedule(otherOwner, draft("Other owner"));
    controller.schedule(linear, draft("Other provider"));
    const remounted = draftController(host);
    expect(remounted).toBe(controller);
    const listener = vi.fn();
    const stop = remounted.subscribe(id, listener);
    expect(remounted.value(key)?.comment).toBe("Retained after unsubscribe");
    remounted.schedule(key, draft("Updated after remount"));
    expect(oldListener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(otherListener).toHaveBeenCalledTimes(1);
    expect(linearListener).toHaveBeenCalledTimes(1);
    expect(controller.value(otherOwner)?.comment).toBe("Other owner");
    expect(controller.value(linear)?.comment).toBe("Other provider");
    stop();
  });
});
