import { LINEAR_UPLOAD_MAX_BYTES } from "../../shared/linear";

export function decodeLinearUpload(base64: string): Buffer<ArrayBuffer> {
  if (base64.length % 4 !== 0 || !/^[A-Za-z\d+/]*={0,2}$/.test(base64))
    throw new Error("The attachment is not valid base64.");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if ((base64.length / 4) * 3 - padding > LINEAR_UPLOAD_MAX_BYTES)
    throw new Error("Attachments can be up to 10 MiB in this upload form.");
  return Buffer.from(base64, "base64");
}
