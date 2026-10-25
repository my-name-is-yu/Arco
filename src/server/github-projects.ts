import { z } from "zod";
import { OperationError } from "../shared/errors";
import type { IssueRef } from "../shared/contracts";
import type {
  FieldValue,
  IssueProjectMemberships,
  ProjectField,
} from "../shared/github-operations";
import { optionColorSchema } from "./github/option-color";

type Graphql = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<unknown>;
const connectionSchema = z.object({
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable().optional(),
  }),
  nodes: z.array(z.unknown()),
});
const definitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  dataType: z.string(),
  options: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: optionColorSchema,
      }),
    )
    .optional(),
  configuration: z
    .object({
      iterations: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          startDate: z.string(),
          duration: z.number(),
        }),
      ),
      completedIterations: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          startDate: z.string(),
          duration: z.number(),
        }),
      ),
    })
    .optional(),
});
const valueFieldSchema = z.object({ id: z.string().min(1) });
const valueSchema = z.discriminatedUnion("__typename", [
  z.object({
    __typename: z.literal("ProjectV2ItemFieldTextValue"),
    field: valueFieldSchema,
    text: z.string().nullable(),
  }),
  z.object({
    __typename: z.literal("ProjectV2ItemFieldNumberValue"),
    field: valueFieldSchema,
    number: z.number().finite().nullable(),
  }),
  z.object({
    __typename: z.literal("ProjectV2ItemFieldDateValue"),
    field: valueFieldSchema,
    date: z.string().nullable(),
  }),
  z.object({
    __typename: z.literal("ProjectV2ItemFieldSingleSelectValue"),
    field: valueFieldSchema,
    optionId: z.string().nullable(),
  }),
  z.object({
    __typename: z.literal("ProjectV2ItemFieldIterationValue"),
    field: valueFieldSchema,
    iterationId: z.string().nullable(),
  }),
  z.object({
    __typename: z.enum([
      "ProjectV2ItemFieldLabelValue",
      "ProjectV2ItemFieldMilestoneValue",
      "ProjectV2ItemFieldMultiSelectValue",
      "ProjectV2ItemFieldPullRequestValue",
      "ProjectV2ItemFieldRepositoryValue",
      "ProjectV2ItemFieldReviewerValue",
      "ProjectV2ItemFieldUserValue",
      "ProjectV2ItemIssueFieldValue",
    ]),
  }),
]);

export class GitHubProjectsError extends OperationError {
  constructor(
    message: string,
    readonly code = "unavailable",
  ) {
    super(message, code);
    this.name = "GitHubProjectsError";
  }
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new GitHubProjectsError(
      "GitHub returned an unexpected Projects response format.",
      "invalid-response",
    );
  return result.data;
}
function nextCursor(
  connection: z.infer<typeof connectionSchema>,
  seen: Set<string>,
): string | null {
  if (!connection.pageInfo.hasNextPage) return null;
  const next = connection.pageInfo.endCursor;
  if (!next?.trim() || seen.has(next))
    throw new GitHubProjectsError(
      "GitHub Projects pagination did not advance. Refresh and try again.",
    );
  seen.add(next);
  return next;
}
function addUnique<T>(values: Map<string, T>, id: string, value: T) {
  if (
    values.has(id) &&
    JSON.stringify(values.get(id)) !== JSON.stringify(value)
  )
    throw new GitHubProjectsError(
      "GitHub Projects data changed while loading. Refresh and try again.",
    );
  values.set(id, value);
}

export async function readProjectMemberships(
  graphql: Graphql,
  input: IssueRef,
  issueId: string,
): Promise<IssueProjectMemberships["memberships"]> {
  const [owner, name] = input.repo.split("/");
  const responseSchema = z.object({
    data: z.object({
      repository: z.object({
        issue: z.object({ id: z.string(), projectItems: connectionSchema }),
      }),
    }),
  });
  const itemSchema = z.object({
    id: z.string(),
    project: z.object({ id: z.string(), title: z.string(), url: z.string() }),
  });
  const memberships = new Map<
    string,
    IssueProjectMemberships["memberships"][number]
  >();
  const seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const response = parse(
      responseSchema,
      await graphql(
        "query ArcoIssueMemberships($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){issue(number:$number){id projectItems(first:100,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id project{id title url}}}}}}",
        { owner, name, number: input.number, cursor },
      ),
    );
    const issue = response.data.repository.issue;
    if (issue.id !== issueId)
      throw new GitHubProjectsError(
        "The issue repository or number has changed.",
        "invalid",
      );
    for (const raw of issue.projectItems.nodes) {
      const item = parse(itemSchema, raw);
      addUnique(memberships, item.id, {
        projectId: item.project.id,
        itemId: item.id,
        title: item.project.title,
        url: item.project.url,
      });
    }
    cursor = nextCursor(issue.projectItems, seen);
  } while (cursor);
  return [...memberships.values()];
}

export async function readProjectFields(
  graphql: Graphql,
  input: { projectId: string; itemId: string; issueId: string },
): Promise<ProjectField[]> {
  const query = `query ArcoProjectFields($projectId:ID!,$itemId:ID!,$fieldsCursor:String,$valuesCursor:String,$includeFields:Boolean!,$includeValues:Boolean!) {
    project: node(id:$projectId) { ... on ProjectV2 {
      id
      fields(first:100,after:$fieldsCursor) @include(if:$includeFields) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField { options { id name color } }
          ... on ProjectV2IterationField { configuration {
            iterations { id title startDate duration }
            completedIterations { id title startDate duration }
          } }
        }
      }
    } }
    item: node(id:$itemId) { ... on ProjectV2Item {
      id project { id } content { ... on Issue { id } }
      fieldValues(first:100,after:$valuesCursor) @include(if:$includeValues) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { id } } }
          ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { id } } }
          ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { id } } }
          ... on ProjectV2ItemFieldSingleSelectValue { optionId field { ... on ProjectV2FieldCommon { id } } }
          ... on ProjectV2ItemFieldIterationValue { iterationId field { ... on ProjectV2FieldCommon { id } } }
        }
      }
    } }
  }`;
  const responseSchema = z.object({
    data: z.object({
      project: z
        .object({ id: z.string(), fields: connectionSchema.optional() })
        .nullable(),
      item: z
        .object({
          id: z.string(),
          project: z.object({ id: z.string() }),
          content: z.object({ id: z.string() }).nullable(),
          fieldValues: connectionSchema.optional(),
        })
        .nullable(),
    }),
  });
  const definitions = new Map<string, z.infer<typeof definitionSchema>>();
  const values = new Map<string, FieldValue>();
  const seenFields = new Set<string>();
  const seenValues = new Set<string>();
  let fieldsCursor: string | null = null;
  let valuesCursor: string | null = null;
  let includeFields = true;
  let includeValues = true;
  do {
    const { project, item } = parse(
      responseSchema,
      await graphql(query, {
        projectId: input.projectId,
        itemId: input.itemId,
        fieldsCursor,
        valuesCursor,
        includeFields,
        includeValues,
      }),
    ).data;
    if (
      !project ||
      !item ||
      project.id !== input.projectId ||
      item.id !== input.itemId ||
      item.project.id !== project.id ||
      item.content?.id !== input.issueId
    )
      throw new GitHubProjectsError(
        "The issue, Project, and item do not belong together.",
        "invalid",
      );
    if (includeFields) {
      const connection = parse(connectionSchema, project.fields);
      for (const raw of connection.nodes) {
        const field = parse(definitionSchema, raw);
        addUnique(definitions, field.id, field);
      }
      fieldsCursor = nextCursor(connection, seenFields);
      includeFields = fieldsCursor !== null;
    }
    if (includeValues) {
      const connection = parse(connectionSchema, item.fieldValues);
      for (const raw of connection.nodes) {
        const data = parse(valueSchema, raw);
        // The query deliberately omits values for native field types Arco does not edit.
        if (!("field" in data)) continue;
        addUnique(
          values,
          data.field.id,
          "text" in data
            ? data.text
            : "number" in data
              ? data.number
              : "date" in data
                ? data.date
                : "optionId" in data
                  ? data.optionId
                  : data.iterationId,
        );
      }
      valuesCursor = nextCursor(connection, seenValues);
      includeValues = valuesCursor !== null;
    }
  } while (includeFields || includeValues);
  return [...definitions.values()].map((field) => {
    const type = field.dataType.toLowerCase();
    return {
      id: field.id,
      name: field.name,
      type,
      supported: [
        "text",
        "number",
        "date",
        "single_select",
        "iteration",
      ].includes(type),
      value: values.get(field.id) ?? null,
      options: (field.options ?? []).map(({ color, ...option }) => ({
        ...option,
        ...(color ? { color } : {}),
      })),
      iterations: [
        ...(field.configuration?.iterations ?? []),
        ...(field.configuration?.completedIterations ?? []),
      ],
    };
  });
}
