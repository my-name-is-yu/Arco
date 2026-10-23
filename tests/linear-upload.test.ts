import { describe, expect, it } from "vitest";
import { decodeLinearUpload } from "../src/server/linear/upload";
import { LINEAR_UPLOAD_MAX_BYTES, linearSchemas } from "../src/shared/linear";

describe("Linear upload transfer boundary", () => {
  it("accepts a full 10 MiB file without a regexp stack overflow", () => {
    const base64 = Buffer.alloc(LINEAR_UPLOAD_MAX_BYTES, 0xab).toString(
      "base64",
    );
    const input = linearSchemas.linear_upload.parse({
      connectionId: "test",
      workspaceId: "workspace",
      teamId: "team",
      issueId: "issue",
      requestId: "request",
      filename: "boundary.bin",
      contentType: "application/octet-stream",
      base64,
    });
    const bytes = decodeLinearUpload(input.base64);
    expect(bytes.length).toBe(LINEAR_UPLOAD_MAX_BYTES);
    expect(bytes[0]).toBe(0xab);
    expect(bytes.at(-1)).toBe(0xab);
  });
  it("rejects decoded overflow and invalid alphabet, length, or padding", () => {
    const overflow = Buffer.alloc(LINEAR_UPLOAD_MAX_BYTES + 1).toString(
      "base64",
    );
    expect(() => decodeLinearUpload(overflow)).toThrow("10 MiB");
    for (const invalid of [
      "A",
      "AAAA=",
      "A===",
      "AA=A",
      "AAAA\n",
      "AA-_",
      "=AAA",
    ])
      expect(() => decodeLinearUpload(invalid)).toThrow("base64");
    expect(decodeLinearUpload("").length).toBe(0);
    expect(decodeLinearUpload("AA==").length).toBe(1);
    expect(decodeLinearUpload("AAA=").length).toBe(2);
    expect(decodeLinearUpload("AAAA").length).toBe(3);
  });
});
