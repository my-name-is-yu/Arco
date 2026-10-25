import { describe, expect, it } from "vitest";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture";
import { createFixtureGitHubOperations } from "../src/server/github-operations-fixture";
import { callGitHubOperation } from "../src/server/github-operations";
import type {
  BulkUpdateResult,
  GitHubOperationResult,
  IssueFieldList,
  IssueProjectMemberships,
  IssueRelations,
  IssueTemplates,
  ProjectFieldList,
  ReactionList,
} from "../src/shared/github-operations";

const ref = { repo: FIXTURE_REPO, number: 42 };
function setup() {
  const service = createFixtureService();
  const operations = createFixtureGitHubOperations({ service });
  let sequence = 0;
  const requestId = () => `integration-${++sequence}`;
  return { service, operations, requestId };
}

describe("advanced fixture operations through validated tool dispatch", () => {
  it("keeps label definitions, Issue assignments, creation defaults and base metadata consistent", async () => {
    const { service, operations, requestId } = setup();
    await callGitHubOperation(operations, "arco_create_label", {
      repo: FIXTURE_REPO,
      requestId: requestId(),
      name: "new-label",
      color: "aabbcc",
      description: "A new definition",
    });
    await service.labels({
      ...ref,
      requestId: requestId(),
      add: ["new-label"],
      remove: [],
    });
    const created = await service.create({
      repo: FIXTURE_REPO,
      requestId: requestId(),
      title: "Template-created issue",
      body: "Exact Markdown",
      labels: ["new-label"],
      assignees: ["fixture-user"],
    });
    expect(created.labels.map((label) => label.name)).toEqual(["new-label"]);
    expect(created.assignees).toEqual(["fixture-user"]);
    await callGitHubOperation(operations, "arco_update_label", {
      repo: FIXTURE_REPO,
      requestId: requestId(),
      name: "new-label",
      patch: { name: "renamed-label", color: "001122" },
    });
    expect(
      (await service.metadata(FIXTURE_REPO)).labels.some(
        (label) => label.name === "renamed-label",
      ),
    ).toBe(true);
    expect((await service.get(ref)).labels.map((label) => label.name)).toEqual([
      "enhancement",
      "design",
      "renamed-label",
    ]);
    expect((await service.get(created)).labels[0]).toMatchObject({
      name: "renamed-label",
      color: "001122",
    });
    await callGitHubOperation(operations, "arco_delete_label", {
      repo: FIXTURE_REPO,
      requestId: requestId(),
      name: "renamed-label",
    });
    expect((await service.get(ref)).labels.map((label) => label.name)).toEqual([
      "enhancement",
      "design",
    ]);
    expect((await service.get(created)).labels).toEqual([]);
  });

  it("edits and deletes numeric comment IDs without changing other comments or body", async () => {
    const { service, operations, requestId } = setup();
    const posted = await service.comment({
      ...ref,
      requestId: requestId(),
      body: "Original own comment",
    });
    const own = posted.comments.at(-1)!;
    expect(own.databaseId).toBeTypeOf("number");
    await callGitHubOperation(operations, "arco_edit_comment", {
      ...ref,
      requestId: requestId(),
      commentId: own.databaseId,
      expectedUpdatedAt: own.updatedAt,
      body: "Edited own comment",
    });
    const edited = await service.get(ref);
    expect(edited.comments).toHaveLength(2);
    expect(edited.comments.at(-1)?.body).toBe("Edited own comment");
    expect(edited.body).toBe(posted.body);
    await callGitHubOperation(operations, "arco_delete_comment", {
      ...ref,
      requestId: requestId(),
      commentId: own.databaseId,
    });
    expect((await service.get(ref)).comments).toHaveLength(1);
  });

  it("keeps issue/comment reactions distinct and source-idempotent per user/type", async () => {
    const { operations, requestId } = setup();
    await callGitHubOperation(operations, "arco_add_reaction", {
      ...ref,
      requestId: requestId(),
      content: "heart",
    });
    await callGitHubOperation(operations, "arco_add_reaction", {
      ...ref,
      requestId: requestId(),
      content: "heart",
    });
    await callGitHubOperation(operations, "arco_add_reaction", {
      ...ref,
      requestId: requestId(),
      commentId: 1,
      content: "eyes",
    });
    const issue = (await callGitHubOperation(
      operations,
      "arco_reactions",
      ref,
    )) as ReactionList;
    const comment = (await callGitHubOperation(operations, "arco_reactions", {
      ...ref,
      commentId: 1,
    })) as ReactionList;
    expect(issue.reactions).toHaveLength(1);
    expect(comment.reactions.map((reaction) => reaction.content)).toEqual([
      "eyes",
    ]);
    await callGitHubOperation(operations, "arco_remove_reaction", {
      ...ref,
      requestId: requestId(),
      reactionId: issue.reactions[0].id,
    });
    expect((await operations.reactions(ref)).reactions).toEqual([]);
    expect(
      (await operations.reactions({ ...ref, commentId: 1 })).reactions,
    ).toHaveLength(1);
  });

  it("round trips existing Issue attributes and all five adopted organization field types", async () => {
    const { operations, service, requestId } = setup();
    await callGitHubOperation(operations, "arco_issue_attributes", {
      ...ref,
      requestId: requestId(),
      patch: { milestoneNumber: 2, issueTypeId: 2 },
    });
    expect(await operations.issueCatalog(ref)).toMatchObject({
      milestoneNumber: 2,
      issueTypeId: 2,
    });
    const changes = [
      { fieldId: 101, value: "Exact notes" },
      { fieldId: 102, value: 0 },
      { fieldId: 103, value: "2026-11-02" },
      { fieldId: 104, value: "High" },
      { fieldId: 105, value: ["Frontend", "Server"] },
    ];
    for (const change of changes)
      await callGitHubOperation(operations, "arco_set_issue_field", {
        ...ref,
        requestId: requestId(),
        ...change,
      });
    const fields = (await callGitHubOperation(
      operations,
      "arco_issue_fields",
      ref,
    )) as IssueFieldList;
    expect(
      fields.fields
        .filter((field) => field.supported)
        .map((field) => field.value),
    ).toEqual(changes.map((change) => change.value));
    await callGitHubOperation(operations, "arco_set_issue_field", {
      ...ref,
      requestId: requestId(),
      fieldId: 102,
      value: null,
    });
    expect(
      (await operations.issueFields(ref)).fields.find(
        (field) => field.id === 102,
      )?.value,
    ).toBeNull();
    expect(
      (await operations.issueFields(ref)).fields.find(
        (field) => field.id === 101,
      )?.value,
    ).toBe("Exact notes");
    expect((await service.get(ref)).state).toBe("open");
  });

  it("round trips all adopted Project field types, clear, and membership without a Status field", async () => {
    const { operations, service, requestId } = setup();
    const memberships = (await callGitHubOperation(
      operations,
      "arco_issue_projects",
      ref,
    )) as IssueProjectMemberships;
    const selected = memberships.memberships[0];
    const projectRef = {
      ...ref,
      projectId: selected.projectId,
      itemId: selected.itemId,
    };
    const changes = [
      { fieldId: "fixture-status-field", value: "fixture-status-done" },
      { fieldId: "fixture-project-text", value: "Project notes" },
      { fieldId: "fixture-project-number", value: 0 },
      { fieldId: "fixture-project-date", value: "2026-11-03" },
      { fieldId: "fixture-project-iteration", value: "fixture-iteration-1" },
    ];
    for (const change of changes)
      await callGitHubOperation(operations, "arco_set_project_field", {
        ...projectRef,
        requestId: requestId(),
        ...change,
      });
    const fields = (await callGitHubOperation(
      operations,
      "arco_project_fields",
      projectRef,
    )) as ProjectFieldList;
    expect(fields.fields.map((field) => field.value)).toEqual(
      changes.map((change) => change.value),
    );
    expect((await service.get(ref)).state).toBe("open");
    await callGitHubOperation(operations, "arco_set_project_field", {
      ...projectRef,
      requestId: requestId(),
      fieldId: "fixture-project-number",
      value: null,
    });
    expect(
      (await operations.projectFields(projectRef)).fields.find(
        (field) => field.id === "fixture-project-number",
      )?.value,
    ).toBeNull();
    const added = (await callGitHubOperation(
      operations,
      "arco_project_membership",
      {
        ...ref,
        requestId: requestId(),
        projectId: "fixture-project-notes",
        action: "add",
      },
    )) as GitHubOperationResult;
    expect((await operations.issueProjects(ref)).memberships).toHaveLength(2);
    expect((await service.get(ref)).projects).toHaveLength(1);
    await callGitHubOperation(operations, "arco_project_membership", {
      ...ref,
      requestId: requestId(),
      projectId: "fixture-project-notes",
      itemId: added.projectItemId,
      action: "remove",
    });
    expect((await operations.issueProjects(ref)).memberships).toHaveLength(1);
  });

  it("preserves parent/children and both dependency directions while rejecting cycles", async () => {
    const { operations, requestId } = setup();
    const second = { ...ref, number: 43 };
    await callGitHubOperation(operations, "arco_set_parent", {
      ...second,
      requestId: requestId(),
      parent: ref,
    });
    expect((await operations.issueRelations(second)).parent).toMatchObject(ref);
    expect((await operations.issueRelations(ref)).children).toHaveLength(1);
    await expect(
      callGitHubOperation(operations, "arco_set_parent", {
        ...ref,
        requestId: requestId(),
        parent: second,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await callGitHubOperation(operations, "arco_add_dependency", {
      ...ref,
      requestId: requestId(),
      blockedBy: second,
    });
    const firstRelations = (await callGitHubOperation(
      operations,
      "arco_issue_relations",
      ref,
    )) as IssueRelations;
    expect(firstRelations.blockedBy).toHaveLength(1);
    expect((await operations.issueRelations(second)).blocking).toHaveLength(1);
    await expect(
      callGitHubOperation(operations, "arco_add_dependency", {
        ...second,
        requestId: requestId(),
        blockedBy: ref,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await callGitHubOperation(operations, "arco_remove_parent", {
      ...second,
      requestId: requestId(),
      parent: ref,
    });
    await callGitHubOperation(operations, "arco_remove_dependency", {
      ...ref,
      requestId: requestId(),
      blockedBy: second,
    });
    expect((await operations.issueRelations(ref)).children).toEqual([]);
    expect((await operations.issueRelations(second)).blocking).toEqual([]);
  });

  it("creates one child under concurrent duplicate invocation and reports it in the parent", async () => {
    const { operations, service, requestId } = setup();
    const input = {
      ...ref,
      requestId: requestId(),
      childRepo: FIXTURE_REPO,
      title: "New child",
      body: "Child body",
    };
    await Promise.all([
      callGitHubOperation(operations, "arco_create_sub_issue", input),
      callGitHubOperation(operations, "arco_create_sub_issue", input),
    ]);
    expect(
      (
        await service.list({
          repo: FIXTURE_REPO,
          query: "New child",
          state: "all",
          page: 1,
        })
      ).issues,
    ).toHaveLength(1);
    expect((await operations.issueRelations(ref)).children).toHaveLength(1);
  });

  it("returns per-Issue bulk Project membership failures and retains every Issue result", async () => {
    const { operations, requestId } = setup();
    const result = (await callGitHubOperation(operations, "arco_bulk_update", {
      requestId: requestId(),
      issues: [ref, { ...ref, number: 41 }],
      projectField: {
        projectId: "fixture-project",
        fieldId: "fixture-project-number",
        value: 5,
      },
    })) as BulkUpdateResult;
    expect(result.results.map((item) => [item.number, item.ok])).toEqual([
      [42, true],
      [41, false],
    ]);
    expect(
      (
        await operations.projectFields({
          ...ref,
          projectId: "fixture-project",
          itemId: "fixture-item-42",
        })
      ).fields.find((field) => field.id === "fixture-project-number")?.value,
    ).toBe(5);
  });

  it("keeps supported template defaults separate from the official form handoff", async () => {
    const { operations, service, requestId } = setup();
    const templates = (await callGitHubOperation(
      operations,
      "arco_issue_templates",
      { repo: FIXTURE_REPO },
    )) as IssueTemplates;
    const simple = templates.templates.find(
      (template) => template.kind === "simple",
    )!;
    const form = templates.templates.find(
      (template) => template.kind === "unsupported",
    )!;
    const created = await service.create({
      repo: FIXTURE_REPO,
      requestId: requestId(),
      title: `${simple.defaults?.title}Fixture`,
      body: simple.body!,
      labels: simple.defaults?.labels,
      assignees: simple.defaults?.assignees,
      issueTypeName: simple.defaults?.type,
    });
    expect(created.body).toBe(simple.body);
    expect(created.labels.map((label) => label.name)).toEqual(["bug"]);
    expect(created.issueType).toEqual({ id: 2, name: "Bug", color: "red" });
    expect((await operations.issueCatalog(created)).issueTypeId).toBe(2);
    expect(form.body).toBeUndefined();
    expect(form.defaults).toBeUndefined();
    expect(form.url).toContain("/issues/new/choose");
  });
});
