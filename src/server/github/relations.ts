import { repoSchema, type IssueRef } from "../../shared/contracts";
import {
  type IssueRelations,
  type RelatedIssue,
} from "../../shared/github-operations";
import {
  apiIssueSchema,
  childRequestId,
  invalid,
  issuePath,
  type GitHubOperationContext,
  type Input,
} from "./operations-context";
import { GitHubError, parse } from "./transport";
function related(raw: unknown): RelatedIssue {
  const issue = parse(apiIssueSchema, raw);
  if (issue.pull_request !== undefined)
    return invalid("The selection includes a target that is not an issue.");
  const url = new URL(issue.repository_url);
  if (
    url.origin !== "https://api.github.com" ||
    !url.pathname.startsWith("/repos/")
  )
    return invalid("Unable to verify the issue repository.");
  return {
    repo: repoSchema.parse(url.pathname.slice("/repos/".length)),
    number: issue.number,
    id: issue.id,
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
  };
}
export function createRelationsOperations(context: GitHubOperationContext) {
  async function issueRelations(
    input: Input<"arco_issue_relations">,
  ): Promise<IssueRelations> {
    await context.issueRecord(input);
    const errors: string[] = [];
    const parent = await context
      .api("read", `${issuePath(input)}/parent`)
      .then(related)
      .catch((error) => {
        if (!(error instanceof GitHubError && error.code === "not-found"))
          errors.push("Unable to load the parent issue.");
        return null;
      });
    const lists = await Promise.all(
      ["sub_issues", "dependencies/blocked_by", "dependencies/blocking"].map(
        (path) =>
          context
            .pages(`${issuePath(input)}/${path}?per_page=100`, apiIssueSchema)
            .then((items) => items.map(related))
            .catch(() => {
              errors.push(`Unable to load ${path}.`);
              return [];
            }),
      ),
    );
    return {
      repo: input.repo,
      number: input.number,
      parent,
      children: lists[0],
      blockedBy: lists[1],
      blocking: lists[2],
      errors,
    };
  }

  function checkDifferent(a: IssueRef, b: IssueRef) {
    if (a.repo.toLowerCase() === b.repo.toLowerCase() && a.number === b.number)
      return invalid(
        "An issue cannot be its own parent, child, or dependency.",
      );
  }

  function setParent(input: Input<"arco_set_parent">) {
    return context.once(input.requestId, ["setParent", input], async () => {
      checkDifferent(input, input.parent);
      if (
        input.repo.split("/")[0].toLowerCase() !==
        input.parent.repo.split("/")[0].toLowerCase()
      )
        return invalid(
          "Parent and child issues must have the same repository owner.",
        );
      const [child] = await Promise.all([
        context.issueRecord(input),
        context.issueRecord(input.parent),
      ]);
      await context.api(
        "write",
        `${issuePath(input.parent)}/sub_issues`,
        "POST",
        {
          sub_issue_id: child.id,
          replace_parent: input.replace,
        },
      );
      return context.refresh(input);
    });
  }

  function removeParent(input: Input<"arco_remove_parent">) {
    return context.once(input.requestId, ["removeParent", input], async () => {
      checkDifferent(input, input.parent);
      const child = await context.issueRecord(input);
      await context.issueRecord(input.parent);
      const actual = related(
        await context.api("read", `${issuePath(input)}/parent`),
      );
      if (
        actual.repo.toLowerCase() !== input.parent.repo.toLowerCase() ||
        actual.number !== input.parent.number
      )
        return invalid(
          "The selected parent does not match the current parent issue.",
        );
      await context.api(
        "write",
        `${issuePath(input.parent)}/sub_issue`,
        "DELETE",
        {
          sub_issue_id: child.id,
        },
      );
      return context.refresh(input);
    });
  }

  function createSubIssue(input: Input<"arco_create_sub_issue">) {
    return context.once(
      input.requestId,
      ["createSubIssue", input],
      async () => {
        await context.issueRecord(input);
        if (
          input.repo.split("/")[0].toLowerCase() !==
          input.childRepo.split("/")[0].toLowerCase()
        )
          return invalid(
            "Create the child issue under the same repository owner as its parent.",
          );
        const createdIssue = await context.service.create({
          repo: input.childRepo,
          requestId: childRequestId(input.requestId, "child"),
          title: input.title,
          body: input.body,
        });
        try {
          const child = await context.issueRecord(createdIssue);
          await context.api("write", `${issuePath(input)}/sub_issues`, "POST", {
            sub_issue_id: child.id,
          });
        } catch {
          throw new GitHubError(
            `Child issue ${createdIssue.repo} #${createdIssue.number} was created, but its parent relationship could not be confirmed. Check ${createdIssue.url} and do not create it again.`,
            "partial",
          );
        }
        return { ...(await context.refresh(input)), createdIssue };
      },
    );
  }

  function addDependency(input: Input<"arco_add_dependency">) {
    return context.once(input.requestId, ["addDependency", input], async () => {
      checkDifferent(input, input.blockedBy);
      const [, blocker] = await Promise.all([
        context.issueRecord(input),
        context.issueRecord(input.blockedBy),
      ]);
      await context.api(
        "write",
        `${issuePath(input)}/dependencies/blocked_by`,
        "POST",
        {
          issue_id: blocker.id,
        },
      );
      return context.refresh(input);
    });
  }

  function removeDependency(input: Input<"arco_remove_dependency">) {
    return context.once(
      input.requestId,
      ["removeDependency", input],
      async () => {
        checkDifferent(input, input.blockedBy);
        const [, blocker] = await Promise.all([
          context.issueRecord(input),
          context.issueRecord(input.blockedBy),
        ]);
        const existing = await context.pages(
          `${issuePath(input)}/dependencies/blocked_by?per_page=100`,
          apiIssueSchema,
        );
        if (!existing.some((issue) => issue.id === blocker.id))
          return invalid(
            "The selected issue is not an existing blocked-by dependency.",
          );
        await context.api(
          "write",
          `${issuePath(input)}/dependencies/blocked_by/${blocker.id}`,
          "DELETE",
        );
        return context.refresh(input);
      },
    );
  }
  return {
    issueRelations,
    setParent,
    removeParent,
    createSubIssue,
    addDependency,
    removeDependency,
  };
}
