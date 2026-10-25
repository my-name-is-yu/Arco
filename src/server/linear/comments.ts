import { LinearServiceError } from "./errors";
import {
  linearMutation,
  type LinearHandlers,
  type LinearOperation,
} from "./operation";
export function createCommentsHandlers(operation: LinearOperation) {
  const { context, checkedIssue, refreshAfterWrite } = operation;

  const handlers = {
    linear_comment: async (input) => {
      const { client } = await context(input);
      const issue = await checkedIssue(client, input);
      if (input.action === "create") {
        if (!input.body) throw new LinearServiceError("Enter a comment body.");
        if (
          input.parentId &&
          (await (await client.comment({ id: input.parentId })).issue)?.id !==
            issue.id
        )
          throw new LinearServiceError(
            "The reply target does not belong to this issue.",
          );
        const created = await linearMutation(() =>
          client.createComment({
            issueId: issue.id,
            body: input.body,
            parentId: input.parentId,
          }),
        );
        return refreshAfterWrite(
          input,
          "The comment was posted to Linear.",
          {
            operation: "create_comment",
            ...(created.commentId ? { commentId: created.commentId } : {}),
          },
          created.commentId ? { commentId: created.commentId } : undefined,
        );
      } else {
        if (!input.commentId)
          throw new LinearServiceError("Choose a target comment.");
        const comment = await client.comment({ id: input.commentId });
        if ((await comment.issue)?.id !== issue.id)
          throw new LinearServiceError(
            "The comment does not belong to the selected issue.",
          );
        if (
          input.expectedUpdatedAt &&
          comment.updatedAt.toISOString() !== input.expectedUpdatedAt
        )
          throw new LinearServiceError(
            "This Linear comment changed elsewhere. Keep your draft and refresh.",
            "conflict",
          );
        if (input.action === "update" && !input.body)
          throw new LinearServiceError("Enter a comment body.");
        await linearMutation<{ success: boolean }>(() =>
          input.action === "delete"
            ? client.deleteComment(comment.id)
            : client.updateComment(comment.id, { body: input.body }),
        );
      }
      return refreshAfterWrite(
        input,
        undefined,
        {
          operation:
            input.action === "delete" ? "delete_comment" : "update_comment",
        },
        input.action === "delete"
          ? { deletedCommentId: input.commentId }
          : { commentId: input.commentId },
      );
    },
    linear_reaction: async (input) => {
      const { client } = await context(input);
      const issue = await checkedIssue(client, input);
      const comment = input.commentId
        ? await client.comment({ id: input.commentId })
        : null;
      if (comment && (await comment.issue)?.id !== issue.id)
        throw new LinearServiceError(
          "The comment does not belong to this issue.",
        );
      if (input.action === "add")
        await linearMutation(() =>
          client.createReaction({
            emoji: input.emoji,
            ...(comment ? { commentId: comment.id } : { issueId: issue.id }),
          }),
        );
      else {
        const existing = (comment?.reactions ?? issue.reactions).find(
          (value) =>
            value.id === input.reactionId && value.emoji === input.emoji,
        );
        const viewer = await client.viewer;
        if (!existing || existing.userId !== viewer.id)
          throw new LinearServiceError(
            "You can only remove your own matching reaction.",
            "forbidden",
          );
        await linearMutation(() => client.deleteReaction(existing.id));
      }
      return refreshAfterWrite(
        input,
        undefined,
        { operation: "reaction" },
        input.commentId ? { commentId: input.commentId } : undefined,
      );
    },
  } satisfies Pick<LinearHandlers, "linear_comment" | "linear_reaction">;
  return handlers;
}
