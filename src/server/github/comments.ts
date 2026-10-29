import { z } from "zod";
import { type IssueRef } from "../../shared/contracts";
import {
  reactionContentSchema,
  type ReactionList,
} from "../../shared/github-operations";
import { commentDto } from "./issue-model";
import {
  invalid,
  issuePath,
  type GitHubOperationContext,
  type Input,
} from "./operations-context";
import { GitHubError, parse } from "./transport";
const apiCommentSchema = z.object({
  id: z.number(),
  issue_url: z.string(),
  updated_at: z.string(),
});

const changedCommentSchema = apiCommentSchema.extend({
  node_id: z.string(),
  body: z.string(),
  html_url: z.string(),
  user: z.object({ login: z.string() }).nullable(),
});

const apiReactionSchema = z.object({
  id: z.number(),
  content: reactionContentSchema,
  user: z.object({ login: z.string() }).nullable(),
});
export function createCommentsOperations(context: GitHubOperationContext) {
  async function commentRecord(
    ref: IssueRef,
    commentId: number,
    expected?: string,
  ) {
    await context.issueRecord(ref);
    const comment = parse(
      apiCommentSchema,
      await context.api(
        "read",
        `repos/${ref.repo}/issues/comments/${commentId}`,
      ),
    );
    if (
      comment.id !== commentId ||
      comment.issue_url.toLowerCase() !==
        `https://api.github.com/${issuePath(ref)}`.toLowerCase()
    )
      return invalid("This comment does not belong to the selected issue.");
    if (expected && expected !== comment.updated_at)
      throw new GitHubError(
        "This comment has changed. Keep your draft and refresh.",
        "conflict",
      );
    return comment;
  }
  function editComment(input: Input<"arco_edit_comment">) {
    return context.once(input.requestId, ["editComment", input], async () => {
      await commentRecord(input, input.commentId, input.expectedUpdatedAt);
      const changed = parse(
        changedCommentSchema,
        await context.api(
          "write",
          `repos/${input.repo}/issues/comments/${input.commentId}`,
          "PATCH",
          { body: input.body },
        ),
      );
      if (
        changed.id !== input.commentId ||
        changed.issue_url.toLowerCase() !==
          `https://api.github.com/${issuePath(input)}`.toLowerCase()
      )
        return invalid("GitHub returned a different comment after editing.");
      return {
        ...(await context.refresh(input)),
        changedComment: commentDto(changed),
      };
    });
  }

  function deleteComment(input: Input<"arco_delete_comment">) {
    return context.once(input.requestId, ["deleteComment", input], async () => {
      await commentRecord(input, input.commentId, input.expectedUpdatedAt);
      await context.api(
        "write",
        `repos/${input.repo}/issues/comments/${input.commentId}`,
        "DELETE",
      );
      return { ...(await context.refresh(input)), deleted: true };
    });
  }

  async function reactionEndpoint(input: IssueRef & { commentId?: number }) {
    if (input.commentId !== undefined) {
      await commentRecord(input, input.commentId);
      return `repos/${input.repo}/issues/comments/${input.commentId}/reactions`;
    }
    await context.issueRecord(input);
    return `${issuePath(input)}/reactions`;
  }

  async function reactions(
    input: Input<"arco_reactions">,
  ): Promise<ReactionList> {
    const endpoint = await reactionEndpoint(input);
    const [items, connection] = await Promise.all([
      context.pages(`${endpoint}?per_page=100`, apiReactionSchema),
      context.service.connection(),
    ]);
    return {
      repo: input.repo,
      number: input.number,
      ...(input.commentId !== undefined ? { commentId: input.commentId } : {}),
      reactions: items.map((item) => ({
        id: item.id,
        content: item.content,
        author: item.user?.login ?? "ghost",
      })),
      account: connection.account,
    };
  }

  function addReaction(input: Input<"arco_add_reaction">) {
    return context.once(input.requestId, ["addReaction", input], async () => {
      const endpoint = await reactionEndpoint(input);
      await context.api("write", endpoint, "POST", { content: input.content });
      return context.refresh(input);
    });
  }

  function removeReaction(input: Input<"arco_remove_reaction">) {
    return context.once(
      input.requestId,
      ["removeReaction", input],
      async () => {
        const current = await reactions(input);
        if (
          !current.account ||
          !current.reactions.some(
            (item) =>
              item.id === input.reactionId &&
              item.author.toLowerCase() === current.account?.toLowerCase(),
          )
        )
          return invalid(
            "You can only remove your own reaction from this target.",
          );
        const endpoint =
          input.commentId === undefined
            ? `${issuePath(input)}/reactions`
            : `repos/${input.repo}/issues/comments/${input.commentId}/reactions`;
        await context.api("write", `${endpoint}/${input.reactionId}`, "DELETE");
        return context.refresh(input);
      },
    );
  }
  return { editComment, deleteComment, reactions, addReaction, removeReaction };
}
