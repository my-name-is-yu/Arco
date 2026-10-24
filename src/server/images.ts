import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { GitHubService } from "../shared/contracts";
import {
  githubImageInputSchema,
  imageDataSchema,
  type ImageData,
} from "../shared/images";
import { failureResult, imageResult } from "./tool-results";

declare const __ARCO_FIXTURE__: boolean;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const imageHosts = new Set([
  "uploads.linear.app",
  "user-images.githubusercontent.com",
  "private-user-images.githubusercontent.com",
  "user-attachments.githubusercontent.com",
  "camo.githubusercontent.com",
  "avatars.githubusercontent.com",
  "raw.githubusercontent.com",
  // Exact bucket returned by public github.com/user-attachments redirects; never wildcard S3.
  "github-production-user-asset-6210df.s3.amazonaws.com",
]);
const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const fixturePng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=";
export const FIXTURE_IMAGE_URL =
  "https://user-images.githubusercontent.com/arco-fixture/selection.png";

interface MarkdownNode {
  type: string;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
}
function normalizedUrl(value: string): string | undefined {
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

/** Match parsed image targets, including reference images, never arbitrary body substrings. */
export function markdownHasImage(markdown: string, url: string): boolean {
  const tree = fromMarkdown(markdown);
  const definitions = new Map<string, string>();
  const images: string[] = [];
  const references: string[] = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "definition" && node.identifier && node.url) {
      // CommonMark uses the first definition for a normalized reference label.
      if (!definitions.has(node.identifier))
        definitions.set(node.identifier, node.url);
    } else if (node.type === "image" && node.url) images.push(node.url);
    else if (node.type === "imageReference" && node.identifier)
      references.push(node.identifier);
    node.children?.forEach(visit);
  };
  visit(tree);
  for (const reference of references) {
    const value = definitions.get(reference);
    if (value) images.push(value);
  }
  const target = normalizedUrl(url);
  return Boolean(
    target && images.some((value) => normalizedUrl(value) === target),
  );
}

function allowedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The image URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    (!imageHosts.has(url.hostname) &&
      !(
        url.hostname === "github.com" &&
        /^\/user-attachments\/(?:assets|files)\/[^/]+/.test(url.pathname)
      ))
  )
    throw new Error(
      "This image origin is not supported in Arco. Open the image in the source service.",
    );
  return url;
}

function matchesImageType(bytes: Uint8Array, mimeType: string): boolean {
  const prefix = Buffer.from(bytes.subarray(0, 32));
  if (mimeType === "image/png")
    return prefix.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (mimeType === "image/jpeg")
    return prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  if (mimeType === "image/gif")
    return ["GIF87a", "GIF89a"].includes(prefix.toString("ascii", 0, 6));
  if (mimeType === "image/webp")
    return (
      prefix.toString("ascii", 0, 4) === "RIFF" &&
      prefix.toString("ascii", 8, 12) === "WEBP"
    );
  return (
    mimeType === "image/avif" &&
    prefix.toString("ascii", 4, 8) === "ftyp" &&
    ["avif", "avis"].some((brand) =>
      prefix.subarray(8).includes(Buffer.from(brand)),
    )
  );
}

/** Read only an image already present in selected source Markdown, from exact source-owned hosts. */
export async function readIssueImage(
  input: {
    url: string;
    markdown: string;
    authorization?: { hostname: string; value: string };
  },
  options: { fetch?: typeof fetch; fixture?: boolean } = {},
): Promise<ImageData> {
  if (!markdownHasImage(input.markdown, input.url))
    throw new Error(
      "The image is not present in the selected issue or comment. Refresh before loading it.",
    );
  let url = allowedUrl(input.url);
  const sourceUrl = url.href;
  if (
    options.fixture &&
    (typeof __ARCO_FIXTURE__ === "undefined" || __ARCO_FIXTURE__)
  ) {
    if (sourceUrl !== FIXTURE_IMAGE_URL)
      throw new Error("This image is not available in the local fixture.");
    return imageDataSchema.parse({
      mimeType: "image/png",
      data: fixturePng,
      sourceUrl,
    });
  }
  const request = options.fetch ?? fetch;
  const signal = AbortSignal.timeout(15_000);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const headers = new Headers({
      Accept: "image/png,image/jpeg,image/gif,image/webp,image/avif",
    });
    // Linear credentials can reach only its documented storage origin and never a redirect.
    if (
      redirect === 0 &&
      input.authorization?.hostname === "uploads.linear.app" &&
      url.hostname === "uploads.linear.app"
    )
      headers.set("Authorization", input.authorization.value);
    let response: Response;
    try {
      response = await request(url.href, {
        headers,
        redirect: "manual",
        signal,
      });
    } catch {
      throw new Error(
        "The source image could not be loaded. Open it in the source service.",
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const destination = response.headers.get("location");
      if (!destination || redirect === 3)
        throw new Error("The source image redirected too many times.");
      url = allowedUrl(new URL(destination, url).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        "The source image is unavailable or requires browser access. Open it in the source service.",
      );
    }
    const mimeType =
      response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        .trim()
        .toLowerCase() ?? "";
    if (!imageTypes.has(mimeType)) {
      await response.body?.cancel();
      throw new Error(
        "This image format is not supported in Arco. Open it in the source service.",
      );
    }
    if (
      Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES ||
      !response.body
    ) {
      await response.body?.cancel();
      throw new Error("Images larger than 5 MiB cannot be previewed in Arco.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        let next: ReadableStreamReadResult<Uint8Array>;
        try {
          next = await reader.read();
        } catch {
          throw new Error(
            "The source image download did not finish. Try loading it again.",
          );
        }
        if (next.done) break;
        length += next.value.byteLength;
        if (length > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new Error(
            "Images larger than 5 MiB cannot be previewed in Arco.",
          );
        }
        chunks.push(next.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    if (!matchesImageType(bytes, mimeType))
      throw new Error("The source did not return a supported image.");
    return imageDataSchema.parse({
      mimeType,
      data: bytes.toString("base64"),
      sourceUrl,
    });
  }
  throw new Error("The source image could not be loaded.");
}

export function registerGitHubImageTool(
  server: McpServer,
  service: GitHubService,
  options: { fetch?: typeof fetch; fixture?: boolean } = {},
) {
  server.registerTool(
    "arco_read_image",
    {
      title: "Read an issue image",
      description:
        "Read an existing image in the selected issue or comment. Image bytes are returned only to the app.",
      inputSchema: githubImageInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (raw): Promise<CallToolResult> => {
      try {
        const input = githubImageInputSchema.parse(raw);
        const markdown = await service.readMarkdown(
          { repo: input.repo, number: input.number },
          input.commentId,
        );
        const image = await readIssueImage(
          { url: input.url, markdown },
          options,
        );
        return imageResult({ ...image });
      } catch (error) {
        return failureResult(error, "The image could not be loaded.");
      }
    },
  );
}
