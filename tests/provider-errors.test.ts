import { describe, expect, it, vi } from "vitest";
import { LinearError, LinearErrorType } from "@linear/sdk";
import type { LinearClient } from "@linear/sdk";
import { LinearServiceError, linearFailure } from "../src/server/linear/errors";
import { createLinearService } from "../src/server/linear/service";
import type { LinearAuth } from "../src/server/linear/auth";

const scope = {
  connectionId: "default",
  workspaceId: "workspace",
  teamId: "team",
};
const privateText = "Bearer private-token private-search private-source-body";
const sdkError = (
  status: number,
  type?: LinearErrorType,
  data?: object | null,
  query = "query Read { viewer { id } }",
) =>
  new LinearError(
    {
      message: privateText,
      request: { query, variables: { body: privateText } },
      response: { status, data },
    },
    undefined,
    type,
  );

describe("provider error boundaries", () => {
  it.each([
    [sdkError(401, LinearErrorType.AuthenticationError), "auth"],
    [sdkError(403, LinearErrorType.Forbidden), "forbidden"],
    [sdkError(429, LinearErrorType.Ratelimited), "rate-limited"],
    [sdkError(400, LinearErrorType.InvalidInput), "invalid-input"],
    [sdkError(404, LinearErrorType.AuthenticationError), "not-found"],
    [sdkError(409), "conflict"],
    [sdkError(408, LinearErrorType.AuthenticationError), "timeout"],
    [sdkError(504, LinearErrorType.NetworkError), "timeout"],
    [sdkError(500, LinearErrorType.InternalError), "unavailable"],
    [sdkError(200, LinearErrorType.FeatureNotAccessible), "unsupported"],
    [new DOMException(privateText, "TimeoutError"), "timeout"],
  ])("returns a safe actionable failure for %s", (error, code) => {
    const failure = linearFailure(error);
    expect(failure.code).toBe(code);
    expect(failure.message).not.toMatch(
      /private-token|private-search|private-source-body/,
    );
    expect(failure).not.toHaveProperty("raw");
    expect(failure).not.toHaveProperty("variables");
  });

  it("classifies the SDK's direct GraphQL query error using its native response", () => {
    const error = Object.assign(new Error(privateText), {
      response: { status: 429 },
      request: { query: "query List { issues { nodes { id } } }" },
    });
    expect(linearFailure(error)).toMatchObject({
      code: "rate-limited",
      message: expect.not.stringContaining("private-token"),
    });
  });

  it("preserves authored validation failures and makes partial or unknown writes uncertain", () => {
    const conflict = new LinearServiceError(
      "This issue changed elsewhere.",
      "conflict",
    );
    expect(linearFailure(conflict, { write: true })).toBe(conflict);
    const mutation = "mutation Save { issueCreate { success } }";
    for (const error of [
      sdkError(
        200,
        LinearErrorType.Forbidden,
        { issueCreate: { success: true } },
        mutation,
      ),
      sdkError(504, LinearErrorType.NetworkError, undefined, mutation),
      sdkError(
        500,
        LinearErrorType.NetworkError,
        undefined,
        "query Refresh { issue { id } }",
      ),
      new Error(privateText),
    ]) {
      expect(linearFailure(error, { write: true })).toMatchObject({
        code: "uncertain",
        message: expect.not.stringContaining("private-token"),
      });
    }
    expect(
      linearFailure(sdkError(403, LinearErrorType.Forbidden, null, mutation), {
        write: true,
      }).code,
    ).toBe("forbidden");
  });

  it("retains the request ID after an unconfirmed dispatched write without retrying it", async () => {
    const createIssue = vi.fn().mockRejectedValue(new Error(privateText));
    const service = createLinearService({
      auth: {
        accessToken: vi.fn().mockResolvedValue("private-token"),
      } as unknown as LinearAuth,
      client: () =>
        ({
          organization: Promise.resolve({ id: scope.workspaceId }),
          team: async () => ({
            id: scope.teamId,
            organization: Promise.resolve({ id: scope.workspaceId }),
          }),
          createIssue,
        }) as unknown as LinearClient,
    });
    const input = {
      ...scope,
      requestId: "same-write",
      title: "Unsent test issue",
    };
    for (let index = 0; index < 2; index++) {
      await expect(
        service.call("linear_create_issue", input),
      ).rejects.toMatchObject({
        code: "uncertain",
        message: expect.not.stringContaining("private-token"),
      });
    }
    expect(createIssue).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["create", 403, LinearErrorType.Forbidden],
    ["update", 403, LinearErrorType.Forbidden],
    ["delete", 403, LinearErrorType.Forbidden],
    ["create", 429, LinearErrorType.Ratelimited],
  ] as const)(
    "retains the saved label %s when metadata fails with %s without repeating the write",
    async (action, status, type) => {
      const create = vi.fn().mockResolvedValue({ success: true });
      const update = vi.fn().mockResolvedValue({ success: true });
      const remove = vi.fn().mockResolvedValue({ success: true });
      const empty = async () => ({
        nodes: [],
        pageInfo: { hasNextPage: false },
      });
      const organization = { id: scope.workspaceId, labels: empty };
      const states = vi.fn().mockRejectedValue(sdkError(status, type));
      const service = createLinearService({
        auth: {
          accessToken: vi.fn().mockResolvedValue("private-token"),
        } as unknown as LinearAuth,
        client: () =>
          ({
            organization: Promise.resolve(organization),
            team: async () => ({
              id: scope.teamId,
              organization: Promise.resolve(organization),
              states,
              members: empty,
              labels: empty,
              projects: empty,
              cycles: empty,
            }),
            issueLabel: async () => ({
              id: "label",
              teamId: scope.teamId,
              isGroup: false,
            }),
            createIssueLabel: create,
            updateIssueLabel: update,
            deleteIssueLabel: remove,
          }) as unknown as LinearClient,
      });
      const input = {
        ...scope,
        requestId: `saved-label-${action}-${status}`,
        action,
        scope: "team",
        labelId: "label",
        name: "Updated label",
      };
      for (let attempt = 0; attempt < 2; attempt++)
        await expect(
          service.call("linear_label_definition", input),
        ).rejects.toMatchObject({
          code: "uncertain",
          message: expect.stringContaining("The Linear label change was saved"),
        });
      expect(
        create.mock.calls.length +
          update.mock.calls.length +
          remove.mock.calls.length,
      ).toBe(1);
      expect(states).toHaveBeenCalledTimes(1);
    },
  );
});
