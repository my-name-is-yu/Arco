import { describe, expect, it } from "vitest";
import type { LinearClient } from "@linear/sdk";
import { fieldValue } from "../src/server/github/field-values";
import { GitHubError } from "../src/server/github/transport";
import { createLinearOperation } from "../src/server/linear/operation";
import type { LinearAuth } from "../src/server/linear/auth";
import { readProjectFields } from "../src/server/github-projects";

const scope = {
  connectionId: "test",
  workspaceId: "workspace",
  teamId: "team",
  issueId: "issue",
};
const connection = (nodes: unknown[]) =>
  Promise.resolve({
    nodes,
    pageInfo: { hasNextPage: false, endCursor: null },
    fetchNext: async () => undefined,
  });
function linearDetail(relation: Record<string, unknown>) {
  const organization = { id: "workspace" };
  const team = {
    id: "team",
    organization,
  };
  const issue = {
    id: "issue",
    teamId: "team",
    identifier: "TST-1",
    title: "Source title",
    description: "Body",
    url: "https://linear.app/test/issue/TST-1",
    stateId: "state",
    state: Promise.resolve({
      id: "state",
      name: "Started",
      type: "started",
      color: "#cccccc",
    }),
    creatorId: "user",
    creator: Promise.resolve({ id: "user", name: "User" }),
    labelIds: [],
    labels: () => connection([]),
    priority: 2,
    updatedAt: new Date("2026-10-24T00:00:00Z"),
    reactions: [],
    children: () => connection([]),
    comments: () => connection([]),
    attachments: () => connection([]),
    relations: () => connection([relation]),
    inverseRelations: () => connection([]),
  };
  const client = {
    organization,
    team: async () => team,
    issue: async () => issue,
  } as unknown as LinearClient;
  return createLinearOperation({
    auth: { accessToken: async () => "test-token" } as unknown as LinearAuth,
    client: () => client,
    fetch,
  }).detail(scope);
}
const relation = () => ({
  id: "relation",
  type: "blocks",
  issueId: "issue",
  relatedIssueId: "other",
  relatedIssue: Promise.resolve({
    id: "other",
    identifier: "TST-2",
    title: "Other title",
  }),
});

function projectFields(
  value: unknown,
  definition: unknown = { id: "field", name: "Points", dataType: "NUMBER" },
) {
  const page = (nodes: unknown[]) => ({
    nodes,
    pageInfo: { hasNextPage: false, endCursor: null },
  });
  return readProjectFields(
    async () => ({
      data: {
        project: { id: "project", fields: page([definition]) },
        item: {
          id: "item",
          project: { id: "project" },
          content: { id: "issue" },
          fieldValues: page([value]),
        },
      },
    }),
    { projectId: "project", itemId: "item", issueId: "issue" },
  );
}

describe("native data without fabricated fallback values", () => {
  it.each([null, 0, "", ["Native option"]])(
    "preserves representable GitHub field data %j",
    (value) => {
      expect(fieldValue(value)).toEqual(value);
    },
  );
  it.each([
    { name: "object", value: { id: "not-text" } },
    { name: "boolean", value: false },
    { name: "missing value", value: undefined },
    { name: "nonfinite number", value: Infinity },
    { name: "numeric array", value: [1, 2] },
  ])("rejects $name rather than manufacturing text or null", ({ value }) => {
    expect(() => fieldValue(value)).toThrow(GitHubError);
  });
  it("keeps a native Project zero value and an explicit unsupported field type", async () => {
    expect(
      (
        await projectFields({
          __typename: "ProjectV2ItemFieldNumberValue",
          field: { id: "field" },
          number: 0,
        })
      )[0],
    ).toMatchObject({ value: 0, supported: true });
    expect(
      (
        await projectFields(
          { __typename: "ProjectV2ItemFieldUserValue" },
          { id: "users", name: "People", dataType: "ASSIGNEES" },
        )
      )[0],
    ).toMatchObject({ id: "users", supported: false });
  });
  it.each([
    { name: "missing node", value: null },
    { name: "untyped node", value: {} },
    { name: "unknown native variant", value: { __typename: "UnknownValue" } },
    {
      name: "missing supported value",
      value: {
        __typename: "ProjectV2ItemFieldNumberValue",
        field: { id: "field" },
      },
    },
    {
      name: "malformed supported value",
      value: {
        __typename: "ProjectV2ItemFieldNumberValue",
        field: { id: "field" },
        number: "zero",
      },
    },
    {
      name: "missing field identity",
      value: { __typename: "ProjectV2ItemFieldNumberValue", number: 0 },
    },
  ])(
    "rejects Project $name instead of silently omitting its value",
    async ({ value }) => {
      await expect(projectFields(value)).rejects.toThrow(
        "unexpected Projects response format",
      );
    },
  );
  it("rejects malformed Project definitions instead of presenting a shorter successful field list", async () => {
    await expect(
      projectFields(
        {
          __typename: "ProjectV2ItemFieldNumberValue",
          field: { id: "field" },
          number: 0,
        },
        { id: "field", name: "Points" },
      ),
    ).rejects.toThrow("unexpected Projects response format");
  });
  it("retains complete Linear native relation identities", async () => {
    expect((await linearDetail(relation())).relations).toEqual([
      {
        id: "relation",
        type: "blocks",
        issueId: "issue",
        relatedIssueId: "other",
        identifier: "TST-2",
        title: "Other title",
      },
    ]);
  });
  it.each([
    { name: "relation ID", patch: { id: undefined } },
    { name: "source ID", patch: { issueId: undefined } },
    { name: "related ID", patch: { relatedIssueId: undefined } },
    { name: "selected endpoint", patch: { issueId: "foreign" } },
    { name: "other issue", patch: { relatedIssue: Promise.resolve(null) } },
    {
      name: "canonical other ID",
      patch: {
        relatedIssue: Promise.resolve({
          id: "foreign",
          identifier: "TST-2",
          title: "Other",
        }),
      },
    },
    {
      name: "identifier",
      patch: {
        relatedIssue: Promise.resolve({
          id: "other",
          identifier: "",
          title: "Other",
        }),
      },
    },
    {
      name: "identifier type",
      patch: {
        relatedIssue: Promise.resolve({
          id: "other",
          identifier: { invalid: "value" },
          title: "Other",
        }),
      },
    },
    {
      name: "title",
      patch: {
        relatedIssue: Promise.resolve({
          id: "other",
          identifier: "TST-2",
          title: "",
        }),
      },
    },
  ])("rejects incomplete Linear relation $name", async ({ patch }) => {
    await expect(linearDetail({ ...relation(), ...patch })).rejects.toThrow(
      /incomplete or mismatched/,
    );
  });
});
