import { z } from "zod";
import {
  commentInputSchema,
  createInputSchema,
  labelInputSchema,
  projectInputSchema,
  updateInputSchema,
  type GitHubService,
  type IssueDetail,
  type IssueRef,
  type ProjectInput,
  type ProjectStatus,
} from "../../shared/contracts.js";
import { apiCommentSchema, apiIssueSchema, commentDto } from "./issue-model";
import type { GitHubTransport } from "./transport";
import { createGitHubWriteGuard, GitHubError, parse } from "./transport";
const PROJECT_MUTATION = `mutation ArcoProjectStatus($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
    value: { singleSelectOptionId: $optionId } }) { projectV2Item { id } }
}`;

export function validateProjectStatus(
  issue: IssueDetail,
  input: ProjectInput,
): ProjectStatus {
  const field = issue.projects.find(
    (project) =>
      project.projectId === input.projectId &&
      project.itemId === input.itemId &&
      project.fieldId === input.fieldId,
  );
  if (!field || !field.options.some((option) => option.id === input.optionId)) {
    throw new GitHubError(
      "The issue, Project, field, and option do not match. Refresh and select them again.",
      "invalid",
    );
  }
  return field;
}
interface IssueWriteContext {
  api: GitHubTransport["request"];
  once: ReturnType<typeof createGitHubWriteGuard<IssueDetail>>;
  issueRecord(ref: IssueRef): Promise<z.output<typeof apiIssueSchema>>;
  metadata: GitHubService["metadata"];
  get: GitHubService["get"];
  refreshAfterWrite(ref: IssueRef): Promise<IssueDetail>;
}
export function createIssueWrites({
  api,
  once,
  issueRecord,
  metadata,
  get,
  refreshAfterWrite,
}: IssueWriteContext) {
  return {
    update(raw) {
      const input = updateInputSchema.parse(raw);
      return once(input.requestId, ["update", input], async () => {
        if (!Object.keys(input.patch).length)
          throw new GitHubError("Select the fields to change.", "invalid");
        const latest = await issueRecord(input);
        if (input.expectedUpdatedAt) {
          if (latest.updated_at !== input.expectedUpdatedAt)
            throw new GitHubError(
              "This issue has changed elsewhere. Keep your draft and refresh.",
              "conflict",
            );
        }
        const { stateReason, ...patch } = input.patch;
        await api(
          "write",
          `repos/${input.repo}/issues/${input.number}`,
          "PATCH",
          {
            ...patch,
            ...(stateReason !== undefined ? { state_reason: stateReason } : {}),
          },
          false,
        );
        const saved = await refreshAfterWrite(input);
        if (
          input.patch.assignees !== undefined &&
          JSON.stringify(
            [
              ...new Set(
                input.patch.assignees.map((login) => login.toLowerCase()),
              ),
            ].sort(),
          ) !==
            JSON.stringify(
              saved.assignees.map((login) => login.toLowerCase()).sort(),
            )
        ) {
          throw new GitHubError(
            "The saved assignees do not match your selection. Check your permissions and refresh.",
            "not-applied",
          );
        }
        return saved;
      });
    },
    labels(raw) {
      const input = labelInputSchema.parse(raw);
      return once(input.requestId, ["labels", input], async () => {
        if (
          input.add.some((add) =>
            input.remove.some(
              (remove) => add.toLowerCase() === remove.toLowerCase(),
            ),
          )
        ) {
          throw new GitHubError(
            "The same label cannot be added and removed in one change.",
            "invalid",
          );
        }
        const [issue, choices] = await Promise.all([
          issueRecord(input),
          metadata(input.repo),
        ]);
        if (
          input.add.some(
            (name) =>
              !choices.labels.some(
                (label) => label.name.toLowerCase() === name.toLowerCase(),
              ),
          )
        ) {
          throw new GitHubError(
            "Select labels that already exist in this repository.",
            "invalid",
          );
        }
        const add = input.add.filter(
          (name) =>
            !issue.labels.some(
              (label) => label.name.toLowerCase() === name.toLowerCase(),
            ),
        );
        let saved = false;
        try {
          if (add.length) {
            await api(
              "write",
              `repos/${input.repo}/issues/${input.number}/labels`,
              "POST",
              { labels: add },
              false,
            );
            saved = true;
          }
          for (const name of input.remove) {
            const existing = issue.labels.find(
              (label) => label.name.toLowerCase() === name.toLowerCase(),
            );
            if (existing) {
              await api(
                "write",
                `repos/${input.repo}/issues/${input.number}/labels/${encodeURIComponent(existing.name)}`,
                "DELETE",
                undefined,
                false,
              );
              saved = true;
            }
          }
        } catch (error) {
          if (saved)
            throw new GitHubError(
              "Some label changes were saved to GitHub, but the remaining changes could not be confirmed. Check GitHub and refresh before retrying.",
              "uncertain",
            );
          throw error;
        }
        return refreshAfterWrite(input);
      });
    },
    comment(raw) {
      const input = commentInputSchema.parse(raw);
      return once(input.requestId, ["comment", input], async () => {
        await issueRecord(input);
        const posted = parse(
          apiCommentSchema,
          await api(
            "write",
            `repos/${input.repo}/issues/${input.number}/comments`,
            "POST",
            { body: input.body },
            false,
          ),
        );
        return {
          ...(await refreshAfterWrite(input)),
          postedComment: commentDto(posted),
        };
      });
    },
    create(raw) {
      const input = createInputSchema.parse(raw);
      return once(input.requestId, ["create", input], async () => {
        let issueType: { id: number; name: string } | undefined;
        if (input.issueTypeName !== undefined) {
          const repository = parse(
            z.object({
              owner: z.object({ login: z.string(), type: z.string() }),
            }),
            await api("read", `repos/${input.repo}`),
          );
          if (repository.owner.type !== "Organization")
            throw new GitHubError(
              "Issue types are available only in organization repositories. Remove the template type default or create the issue on GitHub.",
              "invalid",
            );
          const types = parse(
            z.array(
              z.object({ id: z.number().int().positive(), name: z.string() }),
            ),
            await api("read", `orgs/${repository.owner.login}/issue-types`),
          );
          const matches = types.filter(
            (type) =>
              type.name.toLowerCase() === input.issueTypeName?.toLowerCase(),
          );
          if (matches.length !== 1)
            throw new GitHubError(
              "The template issue type is not an existing type in this organization. Refresh the template or remove its type default.",
              "invalid",
            );
          issueType = matches[0];
        }
        if (input.labels !== undefined || input.assignees !== undefined) {
          const choices = await metadata(input.repo);
          if (
            input.labels?.some(
              (name) =>
                !choices.labels.some(
                  (label) => label.name.toLowerCase() === name.toLowerCase(),
                ),
            ) ||
            input.assignees?.some(
              (name) =>
                !choices.assignees.some(
                  (login) => login.toLowerCase() === name.toLowerCase(),
                ),
            )
          ) {
            throw new GitHubError(
              "Select existing labels and eligible assignees in the target repository.",
              "invalid",
            );
          }
        }
        const created = parse(
          apiIssueSchema,
          await api(
            "write",
            `repos/${input.repo}/issues`,
            "POST",
            {
              title: input.title,
              body: input.body,
              ...(issueType ? { type: issueType.name } : {}),
              ...(input.labels !== undefined ? { labels: input.labels } : {}),
              ...(input.assignees !== undefined
                ? { assignees: input.assignees }
                : {}),
            },
            false,
          ),
        );
        let saved: IssueDetail;
        try {
          saved = await refreshAfterWrite({
            repo: input.repo,
            number: created.number,
          });
        } catch {
          throw new GitHubError(
            `Issue ${input.repo} #${created.number} was created, but its details could not be refreshed. Check ${created.html_url} and do not create it again.`,
            "refresh",
          );
        }
        if (
          (issueType !== undefined && saved.issueType?.id !== issueType.id) ||
          input.labels?.some(
            (name) =>
              !saved.labels.some(
                (label) => label.name.toLowerCase() === name.toLowerCase(),
              ),
          ) ||
          input.assignees?.some(
            (name) =>
              !saved.assignees.some(
                (login) => login.toLowerCase() === name.toLowerCase(),
              ),
          )
        ) {
          throw new GitHubError(
            `Issue #${saved.number} was created, but some selected attributes were not applied. Check ${saved.url}.`,
            "not-applied",
          );
        }
        return saved;
      });
    },
    projectStatus(raw) {
      const input = projectInputSchema.parse(raw);
      return once(input.requestId, ["projectStatus", input], async () => {
        validateProjectStatus(await get(input), input);
        await api(
          "write",
          "graphql",
          "POST",
          {
            query: PROJECT_MUTATION,
            variables: {
              projectId: input.projectId,
              itemId: input.itemId,
              fieldId: input.fieldId,
              optionId: input.optionId,
            },
          },
          false,
        );
        return refreshAfterWrite(input);
      });
    },
  } satisfies Pick<
    GitHubService,
    "update" | "labels" | "comment" | "create" | "projectStatus"
  >;
}
