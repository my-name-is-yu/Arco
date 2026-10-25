import { z } from "zod";
import {
  type IssueCatalog,
  type IssueFieldList,
} from "../../shared/github-operations";
import { checkFieldValue, fieldValue } from "./field-values";
import {
  invalid,
  issuePath,
  type GitHubOperationContext,
  type Input,
} from "./operations-context";
import { GitHubError, parse } from "./transport";
import { optionColorSchema } from "./option-color";
export function createFieldsOperations(context: GitHubOperationContext) {
  async function issueCatalog(
    input: Input<"arco_issue_catalog">,
  ): Promise<IssueCatalog> {
    const [issue, owner] = await Promise.all([
      context.issueRecord(input),
      context.repoOwner(input.repo),
    ]);
    return readCatalog(input, issue, owner);
  }

  async function readCatalog(
    input: Input<"arco_issue_catalog">,
    issue: Awaited<ReturnType<typeof context.issueRecord>>,
    owner: Awaited<ReturnType<typeof context.repoOwner>>,
  ): Promise<IssueCatalog> {
    const errors: string[] = [];
    const milestones = await context.pages(
      `repos/${input.repo}/milestones?state=all&per_page=100`,
      z.object({
        number: z.number(),
        title: z.string(),
        state: z.enum(["open", "closed"]),
      }),
    );
    let issueTypes: IssueCatalog["issueTypes"] = [];
    if (owner.type === "Organization") {
      try {
        issueTypes = parse(
          z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              description: z.string().nullable().optional(),
              color: optionColorSchema,
            }),
          ),
          await context.api("read", `orgs/${owner.login}/issue-types`),
        ).map((type) => ({
          id: type.id,
          name: type.name,
          description: type.description ?? "",
          ...(type.color ? { color: type.color } : {}),
        }));
      } catch {
        errors.push(
          "Unable to load issue types. Check your access to Issue Types in this organization.",
        );
      }
    }
    return {
      repo: input.repo,
      number: input.number,
      milestoneNumber: issue.milestone?.number ?? null,
      issueTypeId: issue.type?.id ?? null,
      milestones,
      issueTypes,
      errors,
    };
  }

  function issueAttributes(input: Input<"arco_issue_attributes">) {
    return context.once(
      input.requestId,
      ["issueAttributes", input],
      async () => {
        if (!Object.keys(input.patch).length)
          return invalid("Select the attributes to change.");
        const issue = await context.issueRecord(input);
        if (
          input.expectedUpdatedAt &&
          input.expectedUpdatedAt !== issue.updated_at
        )
          throw new GitHubError(
            "This issue has changed. Refresh before saving.",
            "conflict",
          );
        const catalog = await readCatalog(
          input,
          issue,
          await context.repoOwner(input.repo),
        );
        const { milestoneNumber, issueTypeId } = input.patch;
        if (
          milestoneNumber != null &&
          !catalog.milestones.some((item) => item.number === milestoneNumber)
        )
          return invalid("Select an existing milestone in this repository.");
        const issueType =
          issueTypeId == null
            ? null
            : catalog.issueTypes.find((item) => item.id === issueTypeId);
        if (issueTypeId != null && !issueType)
          return invalid("Select an existing issue type in this organization.");
        await context.api("write", issuePath(input), "PATCH", {
          ...(milestoneNumber !== undefined
            ? { milestone: milestoneNumber }
            : {}),
          ...(issueTypeId !== undefined
            ? { type: issueType?.name ?? null }
            : {}),
        });
        const saved = await context.issueRecord(input);
        if (
          (milestoneNumber !== undefined &&
            (saved.milestone?.number ?? null) !== milestoneNumber) ||
          (issueTypeId !== undefined &&
            (saved.type?.id ?? null) !== issueTypeId)
        )
          throw new GitHubError(
            "The saved attributes do not match your selection. Check your permissions and refresh.",
            "not-applied",
          );
        return context.refresh(input);
      },
    );
  }

  async function issueFields(
    input: Input<"arco_issue_fields">,
  ): Promise<IssueFieldList> {
    await context.issueRecord(input);
    const owner = await context.repoOwner(input.repo);
    if (owner.type !== "Organization")
      return {
        repo: input.repo,
        number: input.number,
        organization: null,
        fields: [],
      };
    const definitions = parse(
      z.array(
        z.object({
          id: z.number(),
          name: z.string(),
          data_type: z.string(),
          options: z
            .array(
              z.object({
                id: z.number(),
                name: z.string(),
                color: optionColorSchema,
              }),
            )
            .optional(),
        }),
      ),
      await context.api("read", `orgs/${owner.login}/issue-fields`),
    );
    const values = await context.pages(
      `${issuePath(input)}/issue-field-values?per_page=100`,
      z.object({
        issue_field_id: z.number(),
        value: z.unknown(),
        single_select_option: z.object({ name: z.string() }).optional(),
        multi_select_options: z
          .array(z.object({ name: z.string() }))
          .optional(),
      }),
    );
    return {
      repo: input.repo,
      number: input.number,
      organization: owner.login,
      fields: definitions.map((definition) => {
        const current = values.find(
          (value) => value.issue_field_id === definition.id,
        );
        return {
          id: definition.id,
          name: definition.name,
          type: definition.data_type,
          supported: [
            "text",
            "number",
            "date",
            "single_select",
            "multi_select",
          ].includes(definition.data_type),
          options: (definition.options ?? []).map(({ color, ...option }) => ({
            ...option,
            ...(color ? { color } : {}),
          })),
          value: current
            ? (current.multi_select_options?.map((option) => option.name) ??
              current.single_select_option?.name ??
              fieldValue(current.value))
            : null,
        };
      }),
    };
  }

  function setIssueField(input: Input<"arco_set_issue_field">) {
    return context.once(input.requestId, ["setIssueField", input], async () => {
      const field = (await issueFields(input)).fields.find(
        (item) => item.id === input.fieldId,
      );
      if (!field?.supported)
        return invalid(
          "This Issue field is unavailable. Refresh and select a field again.",
        );
      checkFieldValue(
        field.type,
        input.value,
        field.options.map((option) => option.name),
      );
      const value = input.value;
      if (value === null && field.value !== null)
        await context.api(
          "write",
          `${issuePath(input)}/issue-field-values/${field.id}`,
          "DELETE",
        );
      if (value !== null)
        await context.api(
          "write",
          `${issuePath(input)}/issue-field-values`,
          "POST",
          {
            issue_field_values: [{ field_id: field.id, value }],
          },
        );
      return context.refresh(input);
    });
  }
  return { issueCatalog, issueAttributes, issueFields, setIssueField };
}
