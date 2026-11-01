import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFixtureBackend,
  type ArcoBackend,
} from "../src/server/composition";
import { FIXTURE_REPO } from "../src/server/fixture";
import { FIXTURE_IMAGE_URL } from "../src/server/images";
import { LINEAR_FIXTURE_SCOPE } from "../src/server/linear/fixture";
import { createArcoServer } from "../src/server/mcp";
import type { LinearIssue } from "../src/shared/linear";

const ref = { ...LINEAR_FIXTURE_SCOPE, issueId: "fixture-linear-42" };
let backend: ArcoBackend;
let server: ReturnType<typeof createArcoServer>;
let client: Client;

beforeEach(async () => {
  backend = await createFixtureBackend();
  server = createArcoServer(backend);
  client = new Client({ name: "input schema test", version: "1" });
  const [serverTransport, clientTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});
afterEach(async () => {
  await client?.close();
  await server?.close();
  backend?.cleanup();
});

function expectInputError(
  result: Awaited<ReturnType<Client["callTool"]>>,
  message: string,
) {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(result.content).toEqual([
    { type: "text", text: expect.stringContaining("MCP error -32602:") },
  ]);
  expect(result.content).toMatchObject([
    { text: expect.stringContaining(message) },
  ]);
}

describe("declared MCP input schemas", () => {
  it("rejects a misspelled concurrency field before dispatch and permits correcting the same request", async () => {
    const seeded = (await backend.linearService.call("linear_comment", {
      ...ref,
      requestId: randomUUID(),
      action: "create",
      body: "Original comment",
    })) as LinearIssue;
    const comment = seeded.changedComment!;
    const call = vi.spyOn(backend.linearService, "call");
    const update = {
      ...ref,
      requestId: randomUUID(),
      action: "update",
      commentId: comment.id,
      body: "Corrected comment",
    };
    const rejected = await client.callTool({
      name: "linear_comment",
      arguments: { ...update, expected_updated_at: "2000-01-01T00:00:00Z" },
    });
    expect(call).not.toHaveBeenCalled();
    expectInputError(rejected, "expected_updated_at");
    const unchanged = (await backend.linearService.call(
      "linear_get_issue",
      ref,
    )) as LinearIssue;
    expect(
      unchanged.comments.find((item) => item.id === comment.id)?.body,
    ).toBe("Original comment");
    call.mockClear();

    const corrected = await client.callTool({
      name: "linear_comment",
      arguments: { ...update, expectedUpdatedAt: comment.updatedAt },
    });
    expect(corrected.isError).not.toBe(true);
    expect(corrected.structuredContent).toMatchObject({
      changedComment: { id: comment.id, body: "Corrected comment" },
    });
    expect(call).toHaveBeenCalledTimes(1);

    const stale = await client.callTool({
      name: "linear_comment",
      arguments: {
        ...update,
        requestId: randomUUID(),
        expectedUpdatedAt: comment.updatedAt,
        body: "Stale replacement",
      },
    });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toMatchObject({
      error: { kind: "conflict" },
    });
    const saved = (await backend.linearService.call(
      "linear_get_issue",
      ref,
    )) as LinearIssue;
    expect(saved.comments.find((item) => item.id === comment.id)?.body).toBe(
      "Corrected comment",
    );
  });

  it.each(["state", "image", "account"] as const)(
    "rejects unknown top-level %s input before dispatch",
    async (kind) => {
      const inputs = {
        state: {
          name: "arco_update_settings",
          arguments: { expectedRevision: 1, patch: {} },
          dispatch: vi.spyOn(backend.stateStore, "updateSettings"),
        },
        image: {
          name: "arco_read_image",
          arguments: {
            repo: FIXTURE_REPO,
            number: 42,
            url: FIXTURE_IMAGE_URL,
          },
          dispatch: vi.spyOn(backend.service, "readMarkdown"),
        },
        account: {
          name: "arco_account_issues",
          arguments: {},
          dispatch: vi.spyOn(backend.service, "accountIssues"),
        },
      };
      const input = inputs[kind];
      const result = await client.callTool({
        name: input.name,
        arguments: { ...input.arguments, unexpected: true },
      });
      expect(input.dispatch).not.toHaveBeenCalled();
      expectInputError(result, "unexpected");
    },
  );

  it("runs the list cursor refinement at the MCP boundary", async () => {
    const list = vi.spyOn(backend.service, "list");
    const result = await client.callTool({
      name: "arco_list_issues",
      arguments: { repo: FIXTURE_REPO, page: 2 },
    });
    expect(list).not.toHaveBeenCalled();
    expectInputError(result, "Start without a cursor");
  });

  it("preserves defaults, trimming, and nested strict validation", async () => {
    const connection = await client.callTool({
      name: "linear_connection",
      arguments: {},
    });
    expect(connection.structuredContent).toMatchObject({
      connected: true,
      connectionId: "default",
      mode: "fixture",
    });
    const created = await client.callTool({
      name: "linear_create_issue",
      arguments: {
        ...LINEAR_FIXTURE_SCOPE,
        requestId: randomUUID(),
        title: "  Trimmed title  ",
      },
    });
    expect(created.isError).not.toBe(true);
    expect(created.structuredContent).toMatchObject({ title: "Trimmed title" });

    const call = vi.spyOn(backend.linearService, "call");
    const nested = await client.callTool({
      name: "linear_update_issue",
      arguments: {
        ...ref,
        requestId: randomUUID(),
        expectedUpdatedAt: "2000-01-01T00:00:00Z",
        patch: { title: "Unused title", unexpected: true },
      },
    });
    expect(call).not.toHaveBeenCalled();
    expectInputError(nested, "unexpected");
  });

  it("keeps GitHub patch fields operation-specific and rejects invalid bulk values before dispatch", async () => {
    const update = vi.spyOn(backend.service, "update");
    const attributes = vi.spyOn(backend.operations, "issueAttributes");
    const bulk = vi.spyOn(backend.operations, "bulkUpdate");
    const issue = { repo: FIXTURE_REPO, number: 42 };
    for (const [name, patch, invalid] of [
      [
        "arco_bulk_update",
        { title: "Only a single issue can edit this" },
        "title",
      ],
      ["arco_bulk_update", { body: "" }, "body"],
      ["arco_update_issue", { milestoneNumber: 1 }, "milestoneNumber"],
      ["arco_update_issue", { issueTypeId: 1 }, "issueTypeId"],
      ["arco_issue_attributes", { state: "closed" }, "state"],
      ["arco_bulk_update", { state: "closed", unexpected: true }, "unexpected"],
      ["arco_bulk_update", { issueTypeId: 0 }, "issueTypeId"],
      [
        "arco_bulk_update",
        { assignees: Array(101).fill("fixture-user") },
        "assignees",
      ],
    ] as const) {
      const result = await client.callTool({
        name,
        arguments: {
          ...(name === "arco_bulk_update" ? { issues: [issue] } : issue),
          requestId: randomUUID(),
          patch,
        },
      });
      expectInputError(result, invalid);
    }
    expect(update).not.toHaveBeenCalled();
    expect(attributes).not.toHaveBeenCalled();
    expect(bulk).not.toHaveBeenCalled();
  });

  it("preserves core text edits and native attribute values and clears through bulk changes", async () => {
    const issue = { repo: FIXTURE_REPO, number: 42 };
    const title = "Only a core issue update edits the title";
    const updated = await client.callTool({
      name: "arco_update_issue",
      arguments: {
        ...issue,
        requestId: randomUUID(),
        patch: { title, body: "" },
      },
    });
    expect(updated.isError).not.toBe(true);
    expect(updated.structuredContent).toMatchObject({ title, body: "" });
    const attributes = await client.callTool({
      name: "arco_issue_attributes",
      arguments: {
        ...issue,
        requestId: randomUUID(),
        patch: { milestoneNumber: 1, issueTypeId: 1 },
      },
    });
    expect(attributes.isError).not.toBe(true);
    for (const clear of [false, true]) {
      const result = await client.callTool({
        name: "arco_bulk_update",
        arguments: {
          issues: [issue],
          requestId: randomUUID(),
          patch: {
            state: "closed",
            stateReason: "completed",
            assignees: clear ? [] : ["fixture-user"],
            milestoneNumber: clear ? null : 2,
            issueTypeId: clear ? null : 2,
          },
        },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        results: [
          {
            ...issue,
            ok: true,
            issue: {
              title,
              body: "",
              state: "closed",
              stateReason: "completed",
              assignees: clear ? [] : ["fixture-user"],
              issueType: clear ? null : { id: 2 },
            },
          },
        ],
      });
      const catalog = await backend.operations.issueCatalog(issue);
      expect(catalog).toMatchObject({
        milestoneNumber: clear ? null : 2,
        issueTypeId: clear ? null : 2,
      });
    }
  });

  it("keeps an omitted bulk patch distinct from an explicit empty no-op", async () => {
    const issue = { repo: FIXTURE_REPO, number: 42 };
    const original = await backend.service.get(issue);
    const bulk = vi.spyOn(backend.operations, "bulkUpdate");
    const omitted = await client.callTool({
      name: "arco_bulk_update",
      arguments: { issues: [issue], requestId: randomUUID() },
    });
    expect(omitted.isError).toBe(true);
    expect(omitted.structuredContent).toMatchObject({
      error: { kind: "invalid-input" },
    });
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(bulk.mock.calls[0][0]).not.toHaveProperty("patch");
    const empty = await client.callTool({
      name: "arco_bulk_update",
      arguments: { issues: [issue], requestId: randomUUID(), patch: {} },
    });
    expect(empty.isError).not.toBe(true);
    expect(empty.structuredContent).toMatchObject({
      results: [{ ...issue, ok: true, issue: original }],
    });
    expect(await backend.service.get(issue)).toEqual(original);
  });

  it("retains stripping and defaults declared by a non-strict GitHub operation", async () => {
    const projects = vi.spyOn(backend.operations, "projects");
    const result = await client.callTool({
      name: "arco_projects",
      arguments: { repo: FIXTURE_REPO, unexpected: true },
    });
    expect(result.isError).not.toBe(true);
    expect(projects).toHaveBeenCalledExactlyOnceWith({
      repo: FIXTURE_REPO,
      ownerType: "user",
    });
  });
});
