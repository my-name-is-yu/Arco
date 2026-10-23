import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  FIXTURE_IMAGE_URL,
  markdownHasImage,
  readIssueImage,
  registerGitHubImageTool,
} from "../src/server/images";
import { createFixtureService } from "../src/server/fixture";
import { imageDataSchema } from "../src/shared/images";

const url = "https://user-images.githubusercontent.com/fixture/picture.png";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=",
  "base64",
);
const imageResponse = () =>
  new Response(png, { headers: { "Content-Type": "image/png" } });

describe("source-scoped image reads", () => {
  it("validates the full 5 MiB base64 boundary without overflowing the runtime stack", async () => {
    const maximum = Buffer.alloc(5 * 1024 * 1024);
    png.copy(maximum);
    const result = await readIssueImage(
      { url, markdown: `![Image](${url})` },
      {
        fetch: vi.fn<typeof fetch>(
          async () =>
            new Response(maximum, { headers: { "content-type": "image/png" } }),
        ),
      },
    );
    expect(imageDataSchema.parse(result).data).toBe(maximum.toString("base64"));
    expect(Buffer.from(result.data, "base64").length).toBe(maximum.length);
    const tooLarge = Buffer.alloc(maximum.length + 1).toString("base64");
    expect(
      imageDataSchema.safeParse({ ...result, data: tooLarge }).success,
    ).toBe(false);
    for (const data of ["", "AAA", "AAAA=", "AA=A", "A===", "AA A"])
      expect(imageDataSchema.safeParse({ ...result, data }).success).toBe(
        false,
      );
  });

  it("uses parsed inline/reference image targets and excludes code, links, prefixes, and unused definitions", () => {
    expect(markdownHasImage(`![Preview](${url})`, url)).toBe(true);
    expect(
      markdownHasImage(
        `![Preview][Screen Shot]\n\n[screen shot]: <${url}>`,
        url,
      ),
    ).toBe(true);
    expect(markdownHasImage(`![Preview](${url}?version=2)`, url)).toBe(false);
    expect(markdownHasImage(`[Open](${url})`, url)).toBe(false);
    expect(markdownHasImage(`\`![Preview](${url})\``, url)).toBe(false);
    expect(markdownHasImage(`\`\`\`\n![Preview](${url})\n\`\`\``, url)).toBe(
      false,
    );
    expect(markdownHasImage(`[Preview]: ${url}`, url)).toBe(false);
    expect(markdownHasImage(`<img src="${url}">`, url)).toBe(false);
  });

  it("rejects missing source targets and unsupported origins before any request", async () => {
    const request = vi.fn<typeof fetch>(async () => imageResponse());
    for (const candidate of [
      "http://user-images.githubusercontent.com/image.png",
      "https://user-images.githubusercontent.com.attacker.test/image.png",
      "https://127.0.0.1/image.png",
      "https://uploads.linear.app:8443/image.png",
      "https://name:secret@uploads.linear.app/image.png",
      "https://github.com/owner/repo/raw/main/image.png",
      "https://example.com/public-image.png",
    ])
      await expect(
        readIssueImage(
          { url: candidate, markdown: `![Image](${candidate})` },
          { fetch: request },
        ),
      ).rejects.toThrow();
    await expect(
      readIssueImage(
        { url, markdown: "No image in this issue" },
        { fetch: request },
      ),
    ).rejects.toThrow("not present");
    expect(request).not.toHaveBeenCalled();
  });

  it("returns raster bytes and source URL, with authorization only for the exact Linear storage origin", async () => {
    const request = vi.fn<typeof fetch>(async () => imageResponse());
    const linearUrl = "https://uploads.linear.app/workspace/file";
    const authorization = {
      hostname: "uploads.linear.app",
      value: "Bearer fake-private-token",
    };
    const result = await readIssueImage(
      { url: linearUrl, markdown: `![Image](${linearUrl})`, authorization },
      { fetch: request },
    );
    expect(imageDataSchema.parse(result)).toEqual({
      mimeType: "image/png",
      data: png.toString("base64"),
      sourceUrl: linearUrl,
    });
    expect(
      new Headers(request.mock.calls[0][1]?.headers).get("authorization"),
    ).toBe(authorization.value);
    await readIssueImage(
      { url, markdown: `![Image](${url})`, authorization },
      { fetch: request },
    );
    expect(
      new Headers(request.mock.calls[1][1]?.headers).has("authorization"),
    ).toBe(false);
    expect(
      request.mock.calls.every(([, init]) => init?.redirect === "manual"),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fake-private-token");
  });

  it("follows only bounded official-host redirects and never forwards credentials", async () => {
    const sourceUrl = "https://uploads.linear.app/workspace/file";
    const destination =
      "https://github-production-user-asset-6210df.s3.amazonaws.com/asset/image.png";
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: destination } }),
      )
      .mockResolvedValueOnce(imageResponse());
    const result = await readIssueImage(
      {
        url: sourceUrl,
        markdown: `![Image](${sourceUrl})`,
        authorization: {
          hostname: "uploads.linear.app",
          value: "Bearer fake-secret",
        },
      },
      { fetch: request },
    );
    expect(result.sourceUrl).toBe(sourceUrl);
    expect(request.mock.calls[1][0]).toBe(destination);
    expect(
      new Headers(request.mock.calls[1][1]?.headers).has("authorization"),
    ).toBe(false);
    const unsafe = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://127.0.0.1/private" },
        }),
    );
    await expect(
      readIssueImage({ url, markdown: `![Image](${url})` }, { fetch: unsafe }),
    ).rejects.toThrow("origin");
    expect(unsafe).toHaveBeenCalledTimes(1);
    const loop = vi.fn<typeof fetch>(
      async () =>
        new Response(null, { status: 302, headers: { location: url } }),
    );
    await expect(
      readIssueImage({ url, markdown: `![Image](${url})` }, { fetch: loop }),
    ).rejects.toThrow("too many");
    expect(loop).toHaveBeenCalledTimes(4);
  });

  it("rejects wrong MIME/magic, unavailable images, and declared or streamed oversize bodies", async () => {
    const responses = [
      new Response("<svg></svg>", {
        headers: { "content-type": "image/svg+xml" },
      }),
      new Response("<html>not an image</html>", {
        headers: { "content-type": "image/png" },
      }),
      new Response(null, { status: 403 }),
      new Response(png, {
        headers: {
          "content-type": "image/png",
          "content-length": String(5 * 1024 * 1024 + 1),
        },
      }),
      new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
        headers: { "content-type": "image/png" },
      }),
    ];
    for (const response of responses)
      await expect(
        readIssueImage(
          { url, markdown: `![Image](${url})` },
          { fetch: vi.fn<typeof fetch>(async () => response) },
        ),
      ).rejects.toThrow();
    await expect(
      readIssueImage(
        { url, markdown: `![Image](${url})` },
        {
          fetch: vi.fn<typeof fetch>(async () => {
            throw new Error("secret request internals");
          }),
        },
      ),
    ).rejects.toThrow("source image could not be loaded");
  });

  it("serves only the explicit local fixture image without network access", async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error("Fixture must not fetch");
    });
    const image = await readIssueImage(
      { url: FIXTURE_IMAGE_URL, markdown: `![Image](${FIXTURE_IMAGE_URL})` },
      { fixture: true, fetch: request },
    );
    expect(imageDataSchema.parse(image).mimeType).toBe("image/png");
    await expect(
      readIssueImage(
        { url, markdown: `![Image](${url})` },
        { fixture: true, fetch: request },
      ),
    ).rejects.toThrow("local fixture");
    expect(request).not.toHaveBeenCalled();
  });

  it("registers an app-only read and binds the requested comment, keeping bytes out of model content", async () => {
    const server = new McpServer({ name: "image test", version: "1" });
    const service = createFixtureService();
    registerGitHubImageTool(server, service, { fixture: true });
    const client = new Client({ name: "image test client", version: "1" });
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(tools.tools[0]._meta?.ui).toEqual({ visibility: ["app"] });
      const input = { repo: "yu/Arco", number: 42, url: FIXTURE_IMAGE_URL };
      const result = await client.callTool({
        name: "arco_read_image",
        arguments: input,
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([{ type: "text", text: "Image loaded." }]);
      expect(result.structuredContent).toBeUndefined();
      expect(imageDataSchema.parse(result._meta?.image).data).toBe(
        png.toString("base64"),
      );
      const commentResult = await client.callTool({
        name: "arco_read_image",
        arguments: { ...input, commentId: 999999 },
      });
      expect(commentResult.isError).toBe(true);
      expect(commentResult._meta).toBeUndefined();
      const wrongIssue = await client.callTool({
        name: "arco_read_image",
        arguments: { ...input, number: 43 },
      });
      expect(wrongIssue.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
