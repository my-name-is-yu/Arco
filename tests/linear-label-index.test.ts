import { describe, expect, it, vi } from "vitest";
import type { Issue } from "@linear/sdk";
import { createIssuesHandlers } from "../src/server/linear/issues";
import {
  createLinearOperation,
  type LinearOperation,
} from "../src/server/linear/operation";
import type { LinearAuth } from "../src/server/linear/auth";
import type { LinearLabel } from "../src/shared/linear";

const scope = {
  connectionId: "test",
  workspaceId: "workspace",
  teamId: "team",
  issueId: "issue",
};

describe("Linear label lookup work", () => {
  it("indexes one metadata snapshot across changes while checking the current issue and groups again", async () => {
    const reads = { id: 0, parent: 0 };
    const labels: LinearLabel[] = Array.from({ length: 1_000 }, (_, index) => ({
      get id() {
        reads.id++;
        return `label-${index}`;
      },
      get parentId() {
        reads.parent++;
        return `group-${Math.floor(index / 2)}`;
      },
      name: `Label ${index}`,
      color: "#888888",
      description: null,
      teamId: scope.teamId,
      isGroup: false,
    }));
    const current = {
      id: scope.issueId,
      labelIds: Array.from({ length: 20 }, (_, index) => `label-${index * 2}`),
    };
    const client = {
      issueLabel: vi.fn(async () => ({ groupType: "singleSelect" })),
      updateIssue: vi.fn(async () => ({ success: true })),
    };
    const checkedIssue = vi.fn(async () => current);
    const { applyLabels } = createIssuesHandlers({
      context: async () => ({ client }),
      checkedIssue,
      metadata: async () => ({ labels }),
    } as unknown as LinearOperation);
    const add = Array.from(
      { length: 20 },
      (_, index) => `label-${39 - index * 2}`,
    );
    add.push(add[0]);
    const remove = [...current.labelIds, current.labelIds[0]];
    const input = { ...scope, requestId: "indexed-change", add, remove };
    await applyLabels(input);
    await applyLabels(input);
    expect(reads.id).toBeLessThanOrEqual(
      labels.length + (add.length + current.labelIds.length) * 2,
    );
    expect(reads.parent).toBeLessThan(
      (add.length + current.labelIds.length) * 8,
    );
    expect(checkedIssue).toHaveBeenCalledTimes(2);
    expect(client.issueLabel.mock.calls).toHaveLength(40);
    expect(client.updateIssue.mock.calls).toEqual([
      [scope.issueId, { addedLabelIds: add, removedLabelIds: remove }],
      [scope.issueId, { addedLabelIds: add, removedLabelIds: remove }],
    ]);

    current.labelIds = ["label-0", "label-0"];
    await expect(
      applyLabels({ ...input, add: ["label-1"], remove: [] }),
    ).rejects.toThrow("explicitly choose the label to remove");
    expect(checkedIssue).toHaveBeenCalledTimes(3);
    expect(client.updateIssue).toHaveBeenCalledTimes(2);
  });

  it("keeps label indexes separate for scoped metadata snapshots", async () => {
    const label: LinearLabel = {
      id: "shared-id",
      name: "Label",
      color: "#888888",
      description: null,
      teamId: scope.teamId,
      parentId: null,
      isGroup: false,
    };
    const snapshots = {
      team: [label],
      other: [{ ...label, teamId: "other", isGroup: true }],
    };
    const updateIssue = vi.fn(async () => ({ success: true }));
    const { applyLabels } = createIssuesHandlers({
      context: async () => ({ client: { updateIssue } }),
      checkedIssue: async () => ({ id: scope.issueId, labelIds: [] }),
      metadata: async ({ teamId }: { teamId: keyof typeof snapshots }) => ({
        labels: snapshots[teamId],
      }),
    } as unknown as LinearOperation);
    const input = {
      ...scope,
      requestId: "scoped-change",
      add: [label.id],
      remove: [],
    };
    await applyLabels(input);
    await expect(applyLabels({ ...input, teamId: "other" })).rejects.toThrow(
      "Label groups cannot be applied directly",
    );
    expect(updateIssue).toHaveBeenCalledOnce();
  });

  it("checks complete labels with linear work and returns their original order and duplicates", async () => {
    let reads = 0;
    const labels = Array.from({ length: 500 }, (_, index) => ({
      get id() {
        reads++;
        return `label-${index}`;
      },
      name: `Label ${index}`,
      color: "#888888",
    }));
    const ids = Array.from(
      { length: labels.length },
      (_, index) => `label-${index}`,
    );
    labels.reverse();
    labels.push(labels[0]);
    const operation = createLinearOperation({
      auth: {} as LinearAuth,
      client: () => {
        throw new Error("Unexpected client creation");
      },
      fetch,
    });
    const issue = {
      ...scope,
      id: scope.issueId,
      state: { id: "state", name: "Todo", type: "unstarted", color: "#888888" },
      updatedAt: new Date("2026-11-01T00:00:00Z"),
      creator: null,
      assignee: null,
      project: null,
      projectMilestone: null,
      cycle: null,
      labelIds: ids,
      labels: async () => ({ nodes: labels, pageInfo: { hasNextPage: false } }),
    } as unknown as Issue;
    const result = await operation.summary(scope, issue);
    expect(reads).toBeLessThanOrEqual(labels.length * 2);
    expect(result.labels.map((label) => label.id)).toEqual([
      ...ids.toReversed(),
      ids.at(-1),
    ]);
    issue.labelIds.push("missing");
    await expect(operation.summary(scope, issue)).rejects.toMatchObject({
      code: "invalid-response",
      message:
        "The issue label definitions could not be loaded completely. Refresh and try again.",
    });
  });
});
