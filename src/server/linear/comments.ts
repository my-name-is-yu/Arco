import {
  assertSuccess,
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
        if (!input.body) throw new Error("Enter a comment body.");
        if (
          input.parentId &&
          (await (await client.comment({ id: input.parentId })).issue)?.id !==
            issue.id
        )
          throw new Error("The reply target does not belong to this issue.");
        const created = await client.createComment({
          issueId: issue.id,
          body: input.body,
          parentId: input.parentId,
        });
        assertSuccess(created);
        return refreshAfterWrite(
          input,
          `Comment ${created.commentId ?? "(source ID unavailable)"} was posted to Linear issue ${issue.id}. Do not post it again.`,
          {
            operation: "create_comment",
            ...(created.commentId ? { commentId: created.commentId } : {}),
          },
          created.commentId ? { commentId: created.commentId } : undefined,
        );
      } else {
        if (!input.commentId) throw new Error("Choose a target comment.");
        const comment = await client.comment({ id: input.commentId });
        if ((await comment.issue)?.id !== issue.id)
          throw new Error("The comment does not belong to the selected issue.");
        if (
          input.expectedUpdatedAt &&
          comment.updatedAt.toISOString() !== input.expectedUpdatedAt
        )
          throw new Error(
            "This Linear comment changed elsewhere. Keep your draft and refresh.",
          );
        if (input.action === "update" && !input.body)
          throw new Error("Enter a comment body.");
        assertSuccess(
          input.action === "delete"
            ? await client.deleteComment(comment.id)
            : await client.updateComment(comment.id, { body: input.body }),
        );
      }
      return refreshAfterWrite(
        input,
        undefined,
        undefined,
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
        throw new Error("The comment does not belong to this issue.");
      if (input.action === "add")
        assertSuccess(
          await client.createReaction({
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
          throw new Error("You can only remove your own matching reaction.");
        assertSuccess(await client.deleteReaction(existing.id));
      }
      return refreshAfterWrite(
        input,
        undefined,
        undefined,
        input.commentId ? { commentId: input.commentId } : undefined,
      );
    },
  } satisfies Pick<LinearHandlers, "linear_comment" | "linear_reaction">;
  return handlers;
}
