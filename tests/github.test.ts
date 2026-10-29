import { describe, expect, it, vi } from "vitest";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture.js";
import { createGitHubService, type GhRunner } from "../src/server/github.js";
import { createWriteGuard } from "../src/server/write-guard";
import { GitHubError } from "../src/server/github/transport";

const ref = { repo: FIXTURE_REPO, number: 42 };
const apiIssue = (overrides: Record<string, unknown> = {}) => ({
  node_id: "I_42",
  number: 42,
  title: "Original",
  state: "open",
  updated_at: "2026-10-22T01:00:00Z",
  html_url: `https://github.com/${FIXTURE_REPO}/issues/42`,
  user: { login: "test-user" },
  body: "Original body",
  state_reason: null,
  labels: [{ id: 1, name: "keep", color: "eeeeee" }],
  assignees: [],
  repository_url: `https://api.github.com/repos/${FIXTURE_REPO}`,
  ...overrides,
});
const page = (nodes: unknown[], cursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: cursor !== null, endCursor: cursor },
});
const membership = {
  id: "item-42",
  project: {
    id: "project-A",
    title: "Delivery",
    url: "https://github.com/users/yu/projects/1",
  },
};
const statusField = {
  id: "field-A",
  name: "Status",
  dataType: "SINGLE_SELECT",
  options: [
    { id: "todo", name: "Todo", color: "GRAY" },
    { id: "done", name: "Done", color: "GREEN" },
  ],
};
const projectFields = {
  data: {
    project: { id: "project-A", fields: page([statusField]) },
    item: {
      id: "item-42",
      project: { id: "project-A" },
      content: { id: "I_42" },
      fieldValues: page([
        {
          __typename: "ProjectV2ItemFieldSingleSelectValue",
          optionId: "todo",
          field: { id: "field-A" },
        },
      ]),
    },
  },
};
const projects = {
  data: {
    repository: {
      issue: { id: "I_42", projectItems: page([membership]) },
    },
  },
};

function stubRun(
  overrides: {
    write?: GhRunner;
    projects?: unknown;
    issue?: unknown;
    projectRead?: (
      query: string,
      variables: Record<string, unknown>,
    ) => unknown;
  } = {},
) {
  return vi.fn<GhRunner>(async (args, input) => {
    const endpoint = args[3];
    const method = args[args.indexOf("--method") + 1];
    if (endpoint === "graphql") {
      if (input?.includes("mutation ArcoProjectStatus"))
        return (
          overrides.write?.(args, input) ?? {
            data: {
              updateProjectV2ItemFieldValue: {
                projectV2Item: { id: "item-42" },
              },
            },
          }
        );
      if (overrides.projects instanceof Error) throw overrides.projects;
      if (overrides.projectRead) {
        const request = JSON.parse(input!);
        return overrides.projectRead(request.query, request.variables);
      }
      return (
        overrides.projects ??
        (input?.includes("query ArcoProjectFields") ? projectFields : projects)
      );
    }
    if (method !== "GET")
      return (
        overrides.write?.(args, input) ??
        (endpoint?.endsWith("/comments")
          ? {
              id: 1,
              node_id: "IC_1",
              body: JSON.parse(input ?? "{}").body,
              user: { login: "test-user" },
              html_url: `https://github.com/${FIXTURE_REPO}/issues/42#issuecomment-1`,
              updated_at: "2026-10-22T01:00:00Z",
            }
          : apiIssue())
      );
    if (endpoint === "user") return { login: "test-user", id: 123 };
    if (endpoint?.includes("/issues/42/comments")) return [];
    if (endpoint?.includes("/labels?"))
      return [
        [
          { id: 1, name: "keep", color: "eeeeee" },
          { id: 2, name: "needs/review", color: "ffffff" },
        ],
      ];
    if (endpoint?.includes("/assignees?")) return [[{ login: "test-user" }]];
    if (endpoint?.endsWith("/issues/42")) return overrides.issue ?? apiIssue();
    throw new Error("Unhandled mock gh request");
  });
}

describe("write safety across the service boundary", () => {
  it("creates from an existing organization type atomically and verifies the source type ID", async () => {
    const type = { id: 73, name: "Bug", color: "red" };
    const base = stubRun({
      issue: apiIssue({ type }),
      write: async () => apiIssue({ type }),
    });
    const run = vi.fn<GhRunner>(async (args, input) => {
      if (args[3] === `repos/${FIXTURE_REPO}`)
        return { owner: { login: "yu", type: "Organization" } };
      if (args[3] === "orgs/yu/issue-types") return [type];
      return base(args, input);
    });
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const input = {
      repo: FIXTURE_REPO,
      requestId: "template-type-once",
      title: "[Bug] From template",
      body: "Exact Markdown",
      labels: ["keep"],
      issueTypeName: "bug",
    };
    expect((await service.create(input)).issueType).toEqual(type);
    await service.create(input);
    const writes = run.mock.calls.filter(
      ([args]) => args.includes("POST") && args[3] !== "graphql",
    );
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0][1] ?? "{}")).toEqual({
      title: input.title,
      body: input.body,
      labels: ["keep"],
      type: "Bug",
    });
    expect(
      run.mock.calls.some(
        ([args]) => args[3] === "orgs/yu/issue-types" && args.includes("POST"),
      ),
    ).toBe(false);
  });

  it("rejects absent or user-repository template types before issue creation and reports silently dropped types", async () => {
    for (const organization of [true, false]) {
      const base = stubRun();
      const run = vi.fn<GhRunner>(async (args, input) => {
        if (args[3] === `repos/${FIXTURE_REPO}`)
          return {
            owner: {
              login: "yu",
              type: organization ? "Organization" : "User",
            },
          };
        if (args[3] === "orgs/yu/issue-types")
          return [{ id: 73, name: "Task" }];
        return base(args, input);
      });
      await expect(
        createGitHubService({
          credentialIdentity: async () => "test-credential",
          run,
        }).create({
          repo: FIXTURE_REPO,
          requestId: "invalid-type-before-create",
          title: "Template",
          body: "Keep draft",
          issueTypeName: "Bug",
        }),
      ).rejects.toMatchObject({ code: "invalid" });
      expect(
        run.mock.calls.some(
          ([args]) => args.includes("POST") && args[3] !== "graphql",
        ),
      ).toBe(false);
    }
    const base = stubRun();
    const run: GhRunner = async (args, input) => {
      if (args[3] === `repos/${FIXTURE_REPO}`)
        return { owner: { login: "yu", type: "Organization" } };
      if (args[3] === "orgs/yu/issue-types") return [{ id: 73, name: "Bug" }];
      return base(args, input);
    };
    await expect(
      createGitHubService({
        credentialIdentity: async () => "test-credential",
        run,
      }).create({
        repo: FIXTURE_REPO,
        requestId: "dropped-template-type",
        title: "Template",
        body: "Keep draft",
        issueTypeName: "Bug",
      }),
    ).rejects.toMatchObject({ code: "not-applied" });
  });

  it("coalesces concurrent duplicate comments and rejects requestId reuse with a changed payload", async () => {
    const run = stubRun();
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const input = { ...ref, requestId: "comment-once", body: "One comment" };
    await Promise.all([service.comment(input), service.comment(input)]);
    expect(
      run.mock.calls.filter(
        ([args]) =>
          args[args.indexOf("--method") + 1] === "POST" &&
          args[3]?.endsWith("/comments"),
      ),
    ).toHaveLength(1);
    await expect(
      service.comment({ ...input, body: "Different comment" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps user text only in JSON stdin and writes only explicitly selected fields", async () => {
    const run = stubRun();
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const body =
      "@secret-file\n$(touch /tmp/never) `echo nope` --method DELETE";
    await service.update({
      ...ref,
      requestId: "explicit-patch",
      patch: { body },
    });
    const write = run.mock.calls.find(([args]) => args.includes("PATCH"));
    expect(write?.[0]).toContain("--input");
    expect(write?.[0]).not.toContain(body);
    expect(JSON.parse(write?.[1] ?? "")).toEqual({ body });
  });

  it("does not write over a detected concurrent update", async () => {
    const run = stubRun();
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    await expect(
      service.update({
        ...ref,
        requestId: "stale-version",
        expectedUpdatedAt: "older",
        patch: { title: "Local draft" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(run.mock.calls.some(([args]) => args.includes("PATCH"))).toBe(false);
  });

  it("changes only explicit assignees and preserves all labels", async () => {
    const run = stubRun({
      issue: apiIssue({ assignees: [{ login: "test-user" }] }),
    });
    const saved = await createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    }).update({
      ...ref,
      requestId: "assign-explicit",
      patch: { assignees: ["test-user"] },
    });
    const write = run.mock.calls.find(([args]) => args.includes("PATCH"));
    expect(JSON.parse(write?.[1] ?? "")).toEqual({ assignees: ["test-user"] });
    expect(saved.labels.map((label) => label.name)).toEqual(["keep"]);
    const fixture = createFixtureService();
    const original = await fixture.get(ref);
    const assigned = await fixture.update({
      ...ref,
      requestId: "assign-fixture",
      patch: { assignees: ["fixture-reviewer"] },
    });
    expect(assigned.assignees).toEqual(["fixture-reviewer"]);
    expect(assigned.labels).toEqual(original.labels);
    const cleared = await fixture.update({
      ...ref,
      requestId: "clear-fixture",
      patch: { assignees: [] },
    });
    expect(cleared.assignees).toEqual([]);
    expect(cleared.labels).toEqual(original.labels);
  });

  it("reports silently dropped assignee changes rather than displaying saved success", async () => {
    await expect(
      createGitHubService({
        credentialIdentity: async () => "test-credential",
        run: stubRun(),
      }).update({
        ...ref,
        requestId: "assign-dropped",
        patch: { assignees: ["test-user"] },
      }),
    ).rejects.toMatchObject({ code: "not-applied" });
  });

  it("never writes Issue operations against a pull request number", async () => {
    const run = stubRun({
      issue: apiIssue({
        pull_request: { url: "https://api.github.com/pulls/42" },
      }),
    });
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    await expect(
      service.update({
        ...ref,
        requestId: "reject-pr-edit",
        patch: { title: "No" },
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      service.comment({ ...ref, requestId: "reject-pr-comment", body: "No" }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      service.labels({
        ...ref,
        requestId: "reject-pr-labels",
        add: ["keep"],
        remove: [],
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(
      run.mock.calls.some(
        ([args]) =>
          args.includes("PATCH") ||
          args.includes("DELETE") ||
          (args.includes("POST") && args[3] !== "graphql"),
      ),
    ).toBe(false);
  });

  it("does not replay a saved comment if the following detail refresh fails", async () => {
    const base = stubRun();
    let saved = false;
    let failedRefresh = false;
    let writes = 0;
    const run: GhRunner = async (args, input) => {
      if (args[3]?.endsWith("/comments") && args.includes("POST")) {
        saved = true;
        writes += 1;
      } else if (saved && !failedRefresh && args[3]?.endsWith("/issues/42")) {
        failedRefresh = true;
        throw new Error("temporarily unavailable");
      }
      return base(args, input);
    };
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const input = {
      ...ref,
      requestId: "saved-refresh-failed",
      body: "Only once",
    };
    await expect(service.comment(input)).rejects.toMatchObject({
      code: "refresh",
    });
    await expect(service.comment(input)).rejects.toMatchObject({
      code: "refresh",
    });
    expect((await service.get(ref)).title).toBe("Original");
    expect(writes).toBe(1);
  });

  it.each(["auth", "unavailable"])(
    "retries the same request after a preflight %s failure recovers",
    async (code) => {
      const base = stubRun();
      let available = false;
      const run = vi.fn<GhRunner>(async (args, input) => {
        if (!available && args[3]?.endsWith("/issues/42"))
          throw new GitHubError("Preflight failed", code);
        return base(args, input);
      });
      const service = createGitHubService({
        credentialIdentity: async () => "test-credential",
        run,
      });
      const input = {
        ...ref,
        requestId: `recover-preflight-${code}`,
        patch: { title: "Retry after reconnecting" },
      };
      await expect(service.update(input)).rejects.toMatchObject({ code });
      available = true;
      await expect(service.update(input)).resolves.toMatchObject(ref);
      expect(
        run.mock.calls.filter(([args]) => args.includes("PATCH")),
      ).toHaveLength(1);
    },
  );

  it("retries a definitively rejected write after permissions recover", async () => {
    const base = stubRun();
    let allowed = false;
    const run = vi.fn<GhRunner>(async (args, input) => {
      if (!allowed && args.includes("PATCH"))
        throw new GitHubError("Permission denied", "forbidden");
      return base(args, input);
    });
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const input = {
      ...ref,
      requestId: "recover-rejected-write",
      patch: { title: "Retry after granting permission" },
    };
    await expect(service.update(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    allowed = true;
    await expect(service.update(input)).resolves.toMatchObject(ref);
    expect(
      run.mock.calls.filter(([args]) => args.includes("PATCH")),
    ).toHaveLength(2);
  });

  it("retains an accepted comment with an unreadable response without posting it again", async () => {
    const run = stubRun({ write: async () => ({}) });
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const input = {
      ...ref,
      requestId: "saved-unreadable-comment",
      body: "Only one comment",
    };
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(service.comment(input)).rejects.toMatchObject({
        code: "refresh",
        message: expect.stringContaining("saved to GitHub"),
      });
    expect(
      run.mock.calls.filter(
        ([args]) => args.includes("POST") && args[3]?.endsWith("/comments"),
      ),
    ).toHaveLength(1);
  });

  it("retains a created Issue identifier and URL when its detail refresh fails", async () => {
    const base = stubRun();
    const run = vi.fn<GhRunner>(async (args, input) => {
      if (args[3]?.endsWith("/issues/42") && args.includes("GET"))
        throw new Error("temporary detail failure");
      return base(args, input);
    });
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const input = {
      repo: FIXTURE_REPO,
      requestId: "created-refresh-failed",
      title: "Created once",
      body: "Retain source identity",
    };
    await expect(service.create(input)).rejects.toThrow("yu/Arco #42");
    await expect(service.create(input)).rejects.toThrow(
      "https://github.com/yu/Arco/issues/42",
    );
    expect(
      run.mock.calls.filter(
        ([args]) =>
          args[3] === `repos/${FIXTURE_REPO}/issues` && args.includes("POST"),
      ),
    ).toHaveLength(1);
  });

  it("keeps a failed ambiguous comment request and never retries it automatically", async () => {
    const run = stubRun({
      write: async () => {
        throw new Error("ghp_secret-value body-contents");
      },
    });
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const input = {
      ...ref,
      requestId: "uncertain-write",
      body: "Preserve this draft",
    };
    await expect(service.comment(input)).rejects.toMatchObject({
      code: "uncertain",
    });
    await expect(service.comment(input)).rejects.not.toThrow(
      "ghp_secret-value",
    );
    expect(
      run.mock.calls.filter(
        ([args]) => args[3]?.endsWith("/comments") && args.includes("POST"),
      ),
    ).toHaveLength(1);
  });

  it("adds labels with the delta endpoint and never replaces unspecified labels", async () => {
    const run = stubRun();
    await createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    }).labels({
      ...ref,
      requestId: "label-delta",
      add: ["needs/review"],
      remove: [],
    });
    const write = run.mock.calls.find(
      ([args]) => args.includes("POST") && args[3]?.endsWith("/labels"),
    );
    expect(JSON.parse(write?.[1] ?? "")).toEqual({ labels: ["needs/review"] });
    expect(
      run.mock.calls.some(
        ([args]) => args.includes("PUT") || args.includes("PATCH"),
      ),
    ).toBe(false);
    const fixture = createFixtureService();
    const original = await fixture.get(ref);
    const changed = await fixture.labels({
      ...ref,
      requestId: "fixture-label",
      add: ["bug"],
      remove: ["design"],
    });
    expect(changed.labels.map((label) => label.name)).toEqual([
      "enhancement",
      "bug",
    ]);
    expect(original.labels.map((label) => label.name)).toEqual([
      "enhancement",
      "design",
    ]);
  });

  it.each(["forbidden", "rate-limited"])(
    "reports a saved label addition when a following removal is %s without replaying it",
    async (code) => {
      const write = vi.fn<GhRunner>(async (args) => {
        if (args.includes("DELETE")) throw new GitHubError("Rejected", code);
        return [];
      });
      const service = createGitHubService({
        credentialIdentity: async () => "test-credential",
        run: stubRun({ write }),
      });
      const input = {
        ...ref,
        requestId: `partially-saved-labels-${code}`,
        add: ["needs/review"],
        remove: ["keep"],
      };
      for (let attempt = 0; attempt < 2; attempt++)
        await expect(service.labels(input)).rejects.toMatchObject({
          code: "uncertain",
          message: expect.stringContaining("Some label changes were saved"),
        });
      expect(write).toHaveBeenCalledTimes(2);
      expect(
        write.mock.calls.filter(([args]) => args.includes("POST")),
      ).toHaveLength(1);
      expect(
        write.mock.calls.filter(([args]) => args.includes("DELETE")),
      ).toHaveLength(1);
    },
  );

  it("rejects mixed Project/field/item/option IDs before a mutation", async () => {
    for (const mismatch of [
      { projectId: "project-B" },
      { itemId: "other-item" },
      { fieldId: "field-B" },
      { optionId: "unlisted" },
    ]) {
      const run = stubRun();
      const service = createGitHubService({
        credentialIdentity: async () => "test-credential",
        run,
      });
      await expect(
        service.projectStatus({
          ...ref,
          requestId: "project-mismatch",
          projectId: "project-A",
          itemId: "item-42",
          fieldId: "field-A",
          optionId: "done",
          ...mismatch,
        }),
      ).rejects.toMatchObject({ code: "invalid" });
      expect(
        run.mock.calls.some(([, input]) =>
          input?.includes("mutation ArcoProjectStatus"),
        ),
      ).toBe(false);
    }
  });

  it("loads later Project memberships and the 101st Status field before the normal Status mutation", async () => {
    const seenMembershipCursors: unknown[] = [];
    const run = stubRun({
      projectRead: (query, variables) => {
        if (query.includes("ArcoIssueMemberships")) {
          seenMembershipCursors.push(variables.cursor);
          return {
            data: {
              repository: {
                issue: {
                  id: "I_42",
                  projectItems:
                    variables.cursor === null
                      ? page([], "memberships-1")
                      : page([membership]),
                },
              },
            },
          };
        }
        expect(query).toContain("ArcoProjectFields");
        return {
          data: {
            project: {
              id: "project-A",
              fields:
                variables.fieldsCursor === null
                  ? page(
                      Array.from({ length: 100 }, (_, index) => ({
                        id: `text-${index}`,
                        name: `Text ${index}`,
                        dataType: "TEXT",
                      })),
                      "fields-1",
                    )
                  : page([statusField]),
            },
            item: {
              ...projectFields.data.item,
              fieldValues:
                variables.valuesCursor === null
                  ? page([], "values-1")
                  : projectFields.data.item.fieldValues,
            },
          },
        };
      },
    });
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const detail = await service.get(ref);
    expect(detail.projectsError).toBeUndefined();
    expect(detail.projects).toEqual([
      {
        projectId: "project-A",
        projectTitle: "Delivery",
        itemId: "item-42",
        fieldId: "field-A",
        fieldName: "Status",
        optionId: "todo",
        options: statusField.options,
      },
    ]);
    expect(seenMembershipCursors).toEqual([null, "memberships-1"]);
    await service.projectStatus({
      ...ref,
      projectId: "project-A",
      itemId: "item-42",
      fieldId: "field-A",
      optionId: "done",
      requestId: "later-status-field",
    });
    const mutations = run.mock.calls.filter(([, input]) =>
      input?.includes("mutation ArcoProjectStatus"),
    );
    expect(mutations).toHaveLength(1);
    expect(JSON.parse(mutations[0]![1]!).variables).toEqual({
      projectId: "project-A",
      itemId: "item-42",
      fieldId: "field-A",
      optionId: "done",
    });
  });

  it.each(["fields", "memberships"])(
    "stops normal Status writes when a later %s page cannot be read",
    async (failure) => {
      const run = stubRun({
        projectRead: (query, variables) => {
          if (query.includes("ArcoIssueMemberships")) {
            if (variables.cursor)
              throw new Error("Later membership unavailable");
            return failure === "memberships"
              ? {
                  data: {
                    repository: {
                      issue: {
                        id: "I_42",
                        projectItems: page([membership], "next-memberships"),
                      },
                    },
                  },
                }
              : projects;
          }
          if (variables.fieldsCursor)
            throw new Error("Later fields unavailable");
          return {
            data: {
              ...projectFields.data,
              project: {
                id: "project-A",
                fields: page([statusField], "next-fields"),
              },
            },
          };
        },
      });
      const service = createGitHubService({
        credentialIdentity: async () => "test-credential",
        run,
      });
      const detail = await service.get(ref);
      expect(detail.projects).toEqual([]);
      expect(detail.projectsError).toContain("Unable to load Projects");
      await expect(
        service.projectStatus({
          ...ref,
          projectId: "project-A",
          itemId: "item-42",
          fieldId: "field-A",
          optionId: "done",
          requestId: `incomplete-${failure}`,
        }),
      ).rejects.toMatchObject({ code: "invalid" });
      expect(
        run.mock.calls.some(([, input]) =>
          input?.includes("mutation ArcoProjectStatus"),
        ),
      ).toBe(false);
    },
  );

  it("validates Project status separately from Open/Closed", async () => {
    const service = createFixtureService();
    const original = await service.get(ref);
    const project = original.projects[0];
    const changed = await service.projectStatus({
      ...ref,
      requestId: "project-separate",
      ...project,
      optionId: "fixture-status-done",
    });
    expect(changed.state).toBe("open");
    const closed = await service.update({
      ...ref,
      requestId: "issue-separate",
      patch: { state: "closed", stateReason: "completed" },
    });
    expect(closed.projects[0].optionId).toBe("fixture-status-done");
  });

  it("does not evict in-flight duplicate guards when its bounded cache is full", async () => {
    const guard = createWriteGuard(1);
    const issue = await createFixtureService().get(ref);
    let finish: ((value: typeof issue) => void) | undefined;
    const write = vi.fn(
      () =>
        new Promise<typeof issue>((resolve) => {
          finish = resolve;
        }),
    );
    const first = guard("first", { body: "first" }, write);
    await Promise.resolve();
    await expect(guard("second", {}, async () => issue)).rejects.toThrow(
      "still being processed",
    );
    expect(guard("first", { body: "first" }, write)).toBe(first);
    finish?.(issue);
    await first;
    expect(write).toHaveBeenCalledOnce();
  });
});

describe("reads and explicit fixtures", () => {
  it("reads one bounded comment page and acknowledges a new comment beyond the loaded window", async () => {
    const comments = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      node_id: `IC_${index + 1}`,
      body: `Comment ${index + 1}`,
      user: { login: "test-user" },
      html_url: `https://github.com/${FIXTURE_REPO}/issues/42#issuecomment-${index + 1}`,
      updated_at: "2026-10-22T01:00:00Z",
    }));
    const base = stubRun();
    const run = vi.fn<GhRunner>(async (args, input) => {
      if (args[3]?.includes("/issues/42/comments")) {
        if (args.includes("POST")) {
          const next = {
            ...comments[0],
            id: 101,
            node_id: "IC_101",
            body: JSON.parse(input ?? "{}").body,
            html_url: `https://github.com/${FIXTURE_REPO}/issues/42#issuecomment-101`,
          };
          comments.push(next);
          return next;
        }
        const page = Number(
          new URL(`https://api.github.com/${args[3]}`).searchParams.get("page"),
        );
        return comments.slice((page - 1) * 30, page * 30);
      }
      return base(args, input);
    });
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    const initial = await service.get(ref);
    expect(initial).toMatchObject({
      commentsHasMore: true,
      commentsNextPage: 2,
    });
    expect(initial.comments).toHaveLength(30);
    const secondPage = await service.comments({ ...ref, page: 2 });
    expect(secondPage).toMatchObject({
      hasMore: true,
      nextPage: 3,
    });
    expect(secondPage.comments[0].databaseId).toBe(31);
    const saved = await service.comment({
      ...ref,
      requestId: "comment-after-one-hundred",
      body: "Latest native comment",
    });
    expect(saved.comments).toHaveLength(30);
    expect(saved.postedComment).toMatchObject({
      databaseId: 101,
      body: "Latest native comment",
      url: `https://github.com/${FIXTURE_REPO}/issues/42#issuecomment-101`,
    });
    expect(saved.commentsHasMore).toBe(true);
    expect((await service.get(ref)).comments.at(-1)?.databaseId).toBe(30);
    const last = await service.comments({ ...ref, page: 4 });
    expect(last.comments).toHaveLength(11);
    expect(last.hasMore).toBe(false);
    expect(last.comments.at(-1)?.databaseId).toBe(101);
    expect(
      run.mock.calls.filter(
        ([args]) => args[3]?.endsWith("/comments") && args.includes("POST"),
      ),
    ).toHaveLength(1);
    expect(
      run.mock.calls
        .filter(([args]) => args[3]?.includes("/comments?"))
        .every(
          ([args]) =>
            !args.includes("--paginate") &&
            !args.includes("--slurp") &&
            args[3]?.includes("per_page=30"),
        ),
    ).toBe(true);
  });

  it("reads exact Markdown without listing comments or Projects and rejects foreign comment membership", async () => {
    const base = stubRun();
    let foreign = false;
    const run = vi.fn<GhRunner>(async (args, input) =>
      args[3]?.endsWith("/issues/comments/101")
        ? {
            id: 101,
            node_id: "IC_101",
            body: "Image in a later comment",
            user: { login: "test-user" },
            html_url: `https://github.com/${FIXTURE_REPO}/issues/42#issuecomment-101`,
            issue_url: `https://api.github.com/repos/${FIXTURE_REPO}/issues/${foreign ? 43 : 42}`,
            updated_at: "2026-10-22T01:00:00Z",
          }
        : base(args, input),
    );
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run,
    });
    expect(await service.readMarkdown(ref)).toBe("Original body");
    expect(await service.readMarkdown(ref, 101)).toBe(
      "Image in a later comment",
    );
    foreign = true;
    await expect(service.readMarkdown(ref, 101)).rejects.toMatchObject({
      code: "invalid",
    });
    expect(
      run.mock.calls.every(
        ([args]) => args[3] !== "graphql" && !args[3]?.includes("/comments?"),
      ),
    ).toBe(true);
  });

  it("rejects retired repository search syntax before sending a request", async () => {
    const run = stubRun();
    await expect(
      createGitHubService({
        credentialIdentity: async () => "test-credential",
        run,
      }).list({
        repo: FIXTURE_REPO,
        query: "OR repo:other/repo",
        state: "all",
        page: 1,
      }),
    ).rejects.toThrow("Boolean expressions");
    expect(run).not.toHaveBeenCalled();
  });

  it("preserves the Issue when Projects permission is missing", async () => {
    const issue = await createGitHubService({
      credentialIdentity: async () => "test-credential",
      run: stubRun({ projects: new Error("token=secret") }),
    }).get(ref);
    expect(issue.title).toBe("Original");
    expect(issue.projects).toEqual([]);
    expect(issue.projectsError).toContain("read:project");
    expect(JSON.stringify(issue)).not.toContain("token=secret");
  });

  it("reports unavailable credentials safely and never returns raw errors", async () => {
    const service = createGitHubService({
      credentialIdentity: async () => "test-credential",
      run: async () => {
        throw new Error("token=secret");
      },
    });
    expect(await service.connection()).toMatchObject({
      mode: "github",
      connected: false,
      account: null,
    });
    expect(JSON.stringify(await service.connection())).not.toContain("secret");
  });

  it("uses the stable public account ID rather than the mutable login name", async () => {
    let user = { login: "original-name", id: 123 };
    const service = createGitHubService({
      credentialIdentity: async () => `fictional-credential-${user.id}`,
      run: async (args) => {
        if (args[3] === "user") return user;
        throw new Error("Unexpected request");
      },
    });
    expect(await service.connection()).toMatchObject({
      connected: true,
      userId: "123",
      account: "original-name",
    });
    user = { login: "renamed-user", id: 123 };
    expect(await service.connection()).toMatchObject({
      connected: true,
      userId: "123",
      account: "renamed-user",
    });
    user = { login: "other-user", id: 456 };
    expect(await service.connection()).toMatchObject({
      connected: true,
      userId: "456",
    });
  });

  it("isolates fixture instances, exposes fixture mode, and coalesces create/comment writes", async () => {
    const service = createFixtureService();
    expect(await service.connection()).toMatchObject({
      mode: "fixture",
    });
    const comment = {
      ...ref,
      requestId: "fixture-comment-once",
      body: "Local only",
    };
    await Promise.all([service.comment(comment), service.comment(comment)]);
    expect(
      (await service.get(ref)).comments.filter(
        (item) => item.body === comment.body,
      ),
    ).toHaveLength(1);
    expect((await createFixtureService().get(ref)).comments).toHaveLength(1);
    const create = {
      repo: FIXTURE_REPO,
      requestId: "fixture-create-once",
      title: "New local issue",
      body: "Local body",
    };
    const [a, b] = await Promise.all([
      service.create(create),
      service.create(create),
    ]);
    expect(a.number).toBe(b.number);
    const page = await service.list({
      repo: FIXTURE_REPO,
      state: "all",
      page: 1,
      query: create.title,
    });
    expect(page.issues).toHaveLength(1);
  });
});
