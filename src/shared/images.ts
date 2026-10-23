import { z } from "zod";
import { issueRefSchema } from "./contracts";

export const imageDataSchema = z
  .object({
    mimeType: z.enum([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/avif",
    ]),
    data: z
      .string()
      .max(6_990_508)
      .regex(/^[A-Za-z\d+/]*={0,2}$/)
      .refine(
        (value) =>
          value.length > 0 &&
          value.length % 4 === 0 &&
          (value.length / 4) * 3 -
            (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0) <=
            5 * 1024 * 1024,
      ),
    sourceUrl: z
      .url()
      .max(8192)
      .refine((value) => new URL(value).protocol === "https:"),
  })
  .strict();
export type ImageData = z.infer<typeof imageDataSchema>;

export const githubImageInputSchema = issueRefSchema
  .extend({
    commentId: z.number().int().positive().optional(),
    url: z.string().min(1).max(8192),
  })
  .strict();
