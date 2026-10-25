import { z } from "zod";
import {
  type IssueProjectMemberships,
  type ProjectChoices,
  type ProjectFieldList,
} from "../../shared/github-operations";
import { readProjectFields, readProjectMemberships } from "../github-projects";
import { checkFieldValue } from "./field-values";
import {
  invalid,
  type GitHubOperationContext,
  type Input,
} from "./operations-context";
import { parse } from "./transport";
const connectionSchema = z.object({
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().nullable().optional(),
  }),
  nodes: z.array(z.unknown()),
});
export function createProjectsOperations(context: GitHubOperationContext) {
  const { once, graphql, mutate, issueRecord, refresh } = context;
  async function projects(
    input: Input<"arco_projects">,
  ): Promise<ProjectChoices> {
    const owner = input.owner ?? input.repo.split("/")[0];
    const query = `query ArcoProjects($owner:String!,$cursor:String){ ${input.ownerType}(login:$owner){ projectsV2(first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id number title url closed}}}}`;
    const response = parse(
      z.object({ data: z.record(z.string(), z.unknown()) }),
      await graphql(query, { owner, cursor: input.cursor ?? null }),
    );
    const account = parse(
      z.object({ projectsV2: connectionSchema }),
      response.data[input.ownerType],
    );
    return {
      repo: input.repo,
      owner,
      ownerType: input.ownerType,
      projects: account.projectsV2.nodes.map((item) =>
        parse(
          z.object({
            id: z.string(),
            number: z.number(),
            title: z.string(),
            url: z.string(),
            closed: z.boolean(),
          }),
          item,
        ),
      ),
      hasMore: account.projectsV2.pageInfo.hasNextPage,
      cursor: account.projectsV2.pageInfo.endCursor ?? null,
    };
  }

  async function issueProjects(
    input: Input<"arco_issue_projects">,
  ): Promise<IssueProjectMemberships> {
    const issue = await issueRecord(input);
    return {
      repo: input.repo,
      number: input.number,
      memberships: await readProjectMemberships(graphql, input, issue.node_id),
      errors: [],
    };
  }

  function projectMembership(input: Input<"arco_project_membership">) {
    return once(input.requestId, ["projectMembership", input], async () => {
      const issue = await issueRecord(input);
      if (input.action === "add") {
        const project = parse(
          z.object({
            data: z.object({ node: z.object({ id: z.string() }).nullable() }),
          }),
          await graphql(
            "query ArcoProjectIdentity($id:ID!){node(id:$id){... on ProjectV2{id}}}",
            { id: input.projectId },
          ),
        );
        if (project.data.node?.id !== input.projectId)
          return invalid("Select an existing Project you can access.");
        const response = parse(
          z.object({
            data: z.object({
              addProjectV2ItemById: z.object({
                item: z.object({ id: z.string() }),
              }),
            }),
          }),
          await mutate(
            "mutation ArcoAddProject($projectId:ID!,$contentId:ID!){addProjectV2ItemById(input:{projectId:$projectId,contentId:$contentId}){item{id}}}",
            { projectId: input.projectId, contentId: issue.node_id },
          ),
        );
        return {
          ...(await refresh(input)),
          projectItemId: response.data.addProjectV2ItemById.item.id,
        };
      }
      const membership = (await issueProjects(input)).memberships.find(
        (item) =>
          item.projectId === input.projectId && item.itemId === input.itemId,
      );
      if (!membership)
        return invalid("The issue, Project, and item do not belong together.");
      await mutate(
        "mutation ArcoRemoveProject($projectId:ID!,$itemId:ID!){deleteProjectV2Item(input:{projectId:$projectId,itemId:$itemId}){deletedItemId}}",
        { projectId: input.projectId, itemId: membership.itemId },
      );
      return refresh(input);
    });
  }

  async function projectFields(
    input: Input<"arco_project_fields">,
  ): Promise<ProjectFieldList> {
    const issue = await issueRecord(input);
    const fields = await readProjectFields(graphql, {
      projectId: input.projectId,
      itemId: input.itemId,
      issueId: issue.node_id,
    });
    return {
      repo: input.repo,
      number: input.number,
      projectId: input.projectId,
      itemId: input.itemId,
      fields,
      hasMore: false,
    };
  }

  function setProjectField(input: Input<"arco_set_project_field">) {
    return once(input.requestId, ["setProjectField", input], async () => {
      const field = (await projectFields(input)).fields.find(
        (item) => item.id === input.fieldId,
      );
      if (!field?.supported)
        return invalid(
          "This Project field is unavailable. Refresh and select a field again.",
        );
      checkFieldValue(
        field.type,
        input.value,
        field.options.map((option) => option.id),
        field.iterations.map((iteration) => iteration.id),
      );
      const variables = {
        projectId: input.projectId,
        itemId: input.itemId,
        fieldId: input.fieldId,
      };
      if (input.value === null)
        await mutate(
          "mutation ArcoClearProjectField($projectId:ID!,$itemId:ID!,$fieldId:ID!){clearProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId}){projectV2Item{id}}}",
          variables,
        );
      else {
        const key = {
          text: "text",
          number: "number",
          date: "date",
          single_select: "singleSelectOptionId",
          iteration: "iterationId",
        }[field.type];
        if (!key) return invalid("This field type is not supported.");
        await mutate(
          "mutation ArcoSetProjectField($projectId:ID!,$itemId:ID!,$fieldId:ID!,$value:ProjectV2FieldValue!){updateProjectV2ItemFieldValue(input:{projectId:$projectId,itemId:$itemId,fieldId:$fieldId,value:$value}){projectV2Item{id}}}",
          { ...variables, value: { [key]: input.value } },
        );
      }
      return refresh(input);
    });
  }
  return {
    projects,
    issueProjects,
    projectMembership,
    projectFields,
    setProjectField,
  };
}
