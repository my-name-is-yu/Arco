import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { text } from "node:stream/consumers";
import { LinearClient } from "@linear/sdk";
import { all } from "../src/server/linear/operation";

type Page = { cursor?: string | null; more: boolean; empty?: boolean };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function source(pages: Page[]) {
  const requests: { after?: string; first?: number }[] = [];
  const server = createServer(async (request, response) => {
    const input = JSON.parse(await text(request)) as {
      variables: { after?: string; first?: number };
    };
    requests.push(input.variables);
    response.setHeader("Content-Type", "application/json");
    // Bound this fixture so a helper without cycle detection cannot hang the test.
    if (requests.length === 7) {
      response.statusCode = 403;
      response.end(
        JSON.stringify({ errors: [{ message: "Fixture request limit" }] }),
      );
      return;
    }
    const page = pages[(requests.length - 1) % pages.length];
    response.end(
      JSON.stringify({
        data: {
          projectMilestones: {
            nodes: page.empty
              ? []
              : [
                  {
                    id: `page-${requests.length}`,
                    name: "Milestone",
                    project: { id: "project" },
                  },
                ],
            pageInfo: {
              hasNextPage: page.more,
              endCursor: page.cursor,
              hasPreviousPage: false,
              startCursor: null,
            },
          },
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server unavailable");
  const client = new LinearClient({
    accessToken: "test-token",
    apiUrl: `http://127.0.0.1:${address.port}/graphql`,
  });
  return {
    read: () => all(client.projectMilestones({ first: 100 })),
    requests,
  };
}

describe("Linear pagination through the official SDK HTTP transport", () => {
  it("rejects a continuing cursor cycle after its first recurrence", async () => {
    const { read, requests } = await source([
      { cursor: "A", more: true },
      { cursor: "B", more: true },
    ]);
    const failure = await read().catch((error) => error);
    expect(requests).toHaveLength(3);
    expect(failure).toMatchObject({
      code: "invalid-response",
      message: "Linear pagination did not advance. Refresh and try again.",
    });
  });

  it("keeps adjacent cursor stalls invalid even when the next page is terminal", async () => {
    const { read, requests } = await source([
      { cursor: "A", more: true },
      { cursor: "A", more: false },
    ]);
    await expect(read()).rejects.toMatchObject({
      code: "invalid-response",
      message: "Linear pagination did not advance. Refresh and try again.",
    });
    expect(requests).toHaveLength(2);
  });

  it.each([
    {
      name: "an initially terminal page",
      pages: [{ more: false }],
      after: [undefined],
    },
    {
      name: "an empty advancing page",
      pages: [
        { cursor: "A", more: true, empty: true },
        { cursor: "B", more: false },
      ],
      after: [undefined, "A"],
    },
    {
      name: "an earlier non-adjacent terminal cursor",
      pages: [
        { cursor: "A", more: true },
        { cursor: "B", more: true },
        { cursor: "A", more: false },
      ],
      after: [undefined, "A", "B"],
    },
    {
      name: "an initially null cursor",
      pages: [
        { cursor: null, more: true },
        { cursor: "B", more: false },
      ],
      after: [undefined, undefined],
    },
    {
      name: "an initially absent cursor",
      pages: [{ more: true }, { cursor: "B", more: false }],
      after: [undefined, undefined],
    },
    {
      name: "an initially empty cursor",
      pages: [
        { cursor: "", more: true },
        { cursor: "B", more: false },
      ],
      after: [undefined, ""],
    },
  ])("preserves $name", async ({ pages, after }) => {
    const { read, requests } = await source(pages);
    expect((await read()).map((node) => node.id)).toEqual(
      pages.flatMap((page: Page, index) =>
        page.empty ? [] : [`page-${index + 1}`],
      ),
    );
    expect(requests.map((request) => request.after)).toEqual(after);
  });
});
