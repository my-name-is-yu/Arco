import { expect, it } from "vitest";
import { createAttachmentsHandlers } from "../src/server/linear/attachments";
import type { LinearOperation } from "../src/server/linear/operation";
import { LinearServiceError } from "../src/server/linear/errors";
import { linearSchemas } from "../src/shared/linear";
import { createWriteGuard } from "../src/server/write-guard";

it("blocks an attachment PUT when authorization changes after its upload was prepared", async () => {
  let scope = "original-grant";
  let uploads = 0;
  let updates = 0;
  const once = createWriteGuard<object>(
    256,
    (message, code) => new LinearServiceError(message, code),
    async () => scope,
  );
  const operation = {
    context: async () => ({
      client: {
        fileUpload: async () => ({
          success: true,
          uploadFile: {
            uploadUrl: "https://uploads.linear.app/fictional-upload",
            assetUrl: "https://uploads.linear.app/fictional-asset",
            // Model a session transition after the SDK's preparation result is accepted.
            get headers() {
              scope = "replacement-grant";
              return [];
            },
          },
        }),
        updateIssue: async () => {
          updates++;
          return { success: true };
        },
      },
    }),
    checkedIssue: async () => ({ id: "issue", description: "Original body" }),
    request: async () => {
      uploads++;
      return new Response(null, { status: 200 });
    },
    refreshAfterWrite: async () => ({ saved: true }),
  } as unknown as LinearOperation;
  const input = linearSchemas.linear_upload.parse({
    connectionId: "fictional",
    workspaceId: "workspace",
    teamId: "team",
    issueId: "issue",
    requestId: "upload-session-transition",
    filename: "sample.bin",
    contentType: "application/octet-stream",
    base64: "AAAA",
  });
  const run = () =>
    once(input.requestId, input, () =>
      createAttachmentsHandlers(operation).linear_upload(input),
    );
  await expect(run()).rejects.toMatchObject({
    code: expect.stringMatching(/^(auth|conflict)$/),
  });
  await expect(run()).rejects.toMatchObject({
    code: expect.stringMatching(/^(auth|conflict)$/),
  });
  expect(uploads).toBe(0);
  expect(updates).toBe(0);
});
