import { decodeLinearUpload } from "./upload";

import {
  assertSuccess,
  type LinearHandlers,
  type LinearOperation,
} from "./operation";
export function createAttachmentsHandlers(operation: LinearOperation) {
  const { request, context, checkedIssue, refreshAfterWrite } = operation;

  const handlers = {
    linear_upload: async (input) => {
      const { client } = await context(input);
      const issue = await checkedIssue(client, input);
      const bytes = decodeLinearUpload(input.base64);
      const prepared = await client.fileUpload(
        input.contentType,
        input.filename,
        bytes.length,
      );
      assertSuccess(prepared);
      const file = prepared.uploadFile;
      if (
        !file ||
        new URL(file.uploadUrl).protocol !== "https:" ||
        new URL(file.assetUrl).protocol !== "https:"
      )
        throw new Error("A secure Linear upload URL could not be loaded.");
      const headers = new Headers({
        "Content-Type": input.contentType,
        "Cache-Control": "public, max-age=31536000",
      });
      for (const header of file.headers) headers.set(header.key, header.value);
      const uploaded = await request(file.uploadUrl, {
        method: "PUT",
        headers,
        body: bytes,
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      });
      if (!uploaded.ok)
        throw new Error(
          `The Linear attachment upload failed (${uploaded.status}).`,
        );
      // Refetch before appending so a concurrently edited description is not replaced by our earlier snapshot.
      const latest = await checkedIssue(client, {
        ...input,
        issueId: issue.id,
      });
      const title = input.filename.replace(/[[\]\\\r\n]/g, "_");
      assertSuccess(
        await client.updateIssue(issue.id, {
          description: `${latest.description ?? ""}\n\n[${title}](${file.assetUrl})`,
        }),
      );
      return refreshAfterWrite(input);
    },
  } satisfies Pick<LinearHandlers, "linear_upload">;
  return handlers;
}
