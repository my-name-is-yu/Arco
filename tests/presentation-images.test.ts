import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArcoHost, IssueDetail } from "../src/shared/contracts";
import type { ImageData } from "../src/shared/images";
import type { LinearIssue } from "../src/shared/linear";
import { createFixtureService } from "../src/server/fixture";
import {
  createLinearFixtureService,
  LINEAR_FIXTURE_SCOPE,
} from "../src/server/linear/fixture";
import {
  firstMarkdownImage,
  presentationImageQueries,
  sourceImageQueryOptions,
} from "../src/ui/presentation-images";
import { createToolQueue } from "../src/ui/tool-queue";

const url = "https://example.com/first.png";
const image: ImageData = {
  mimeType: "image/png",
  data: "dGVzdA==",
  sourceUrl: url,
};
const fixtureIssue = createFixtureService().fixture.issues()[0];
function github(number = 42, body = `![First](${url})`): IssueDetail {
  return { ...fixtureIssue, number, body };
}
const clients: QueryClient[] = [];
function queryClient() {
  const client = new QueryClient();
  clients.push(client);
  return client;
}
function imageHost(
  readImage = vi.fn<ArcoHost["readImage"]>().mockResolvedValue(image),
) {
  return { readImage };
}
afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

describe("leading presentation images", () => {
  it("finds the first rendered Markdown image and normalizes its URL", () => {
    expect(
      firstMarkdownImage(
        "[Ordinary link](https://example.com/link.png)\n\n" +
          "`![Inline code](https://example.com/code.png)`\n\n" +
          "```md\n![Fenced](https://example.com/fence.png)\n```\n\n" +
          '<img src="https://example.com/html.png">\n\n' +
          "> [![Nested](HtTpS://EXAMPLE.com/first.png)](https://example.com)\n\n" +
          "![Second](https://example.com/second.png)",
      ),
    ).toBe(url);
  });

  it.each([
    "![First][MiXeD   Label]\n\n[mixed label]: HTTPS://EXAMPLE.com/first.png",
    "![Label][]\n\n[label]: https://example.com/first.png",
    "![Label]\n\n[label]: https://example.com/first.png",
  ])("resolves image reference definitions: %s", (body) => {
    expect(firstMarkdownImage(body)).toBe(url);
  });

  it("ignores unsafe images, ordinary links, HTML and code", () => {
    expect(
      firstMarkdownImage(
        "![Unsafe](javascript:alert(1))\n\n![Data](data:image/png;base64,YQ==)\n\n" +
          "![Relative](/image.png)\n\n![Safe](https://example.com/first.png)",
      ),
    ).toBe(url);
    expect(
      firstMarkdownImage(
        '[Link](https://example.com/link.png)\n\n<img src="https://example.com/html.png">\n\n' +
          "    ![Indented code](https://example.com/code.png)\n\n" +
          "\\![Escaped](https://example.com/escaped.png)",
      ),
    ).toBeUndefined();
  });

  it("limits the batch to four body images and leaves comment images deferred", async () => {
    const host = imageHost();
    const issues = Array.from({ length: 5 }, (_, index) =>
      github(
        index + 1,
        `![First](${url})\n\n![Later](https://example.com/later.png)`,
      ),
    );
    const options = presentationImageQueries(host, issues);
    expect(options).toHaveLength(4);
    const client = queryClient();
    await Promise.all(options.map((option) => client.prefetchQuery(option)));
    expect(host.readImage).toHaveBeenCalledTimes(4);
    for (const call of vi.mocked(host.readImage).mock.calls) {
      expect(call[1]).toBe(url);
      expect(call[2]).toBeUndefined();
      expect(call[3]).toMatchObject({ priority: "background" });
    }
    const noBodyImage = github(6, "Only text");
    noBodyImage.comments = [
      { ...fixtureIssue.comments[0], body: `![Comment](${url})` },
    ];
    expect(presentationImageQueries(host, [noBodyImage])).toEqual([]);
  });

  it("uses the same cache keys for visible previews and native provider scopes", async () => {
    const host = imageHost();
    const issue = github();
    expect(presentationImageQueries(host, [issue])[0].queryKey).toEqual(
      sourceImageQueryOptions(host, issue, url).queryKey,
    );
    expect(sourceImageQueryOptions(host, issue, url).queryKey).toEqual([
      "source-image",
      "github",
      "yu/Arco",
      42,
      undefined,
      url,
    ]);
    expect(sourceImageQueryOptions(host, issue, url, 9).queryKey).not.toEqual(
      sourceImageQueryOptions(host, issue, url).queryKey,
    );
    const linear = (await createLinearFixtureService().call(
      "linear_get_issue",
      {
        ...LINEAR_FIXTURE_SCOPE,
        issueId: "fixture-linear-42",
      },
    )) as LinearIssue;
    const key = sourceImageQueryOptions(host, linear, url).queryKey;
    expect(key).toEqual([
      "source-image",
      "linear",
      "default",
      "fixture-linear-workspace",
      "fixture-linear-team",
      "fixture-linear-42",
      undefined,
      url,
    ]);
    expect(
      sourceImageQueryOptions(host, { ...linear, workspaceId: "other" }, url)
        .queryKey,
    ).not.toEqual(key);
    const client = queryClient();
    await client.prefetchQuery(presentationImageQueries(host, [issue])[0]);
    await client.fetchQuery(sourceImageQueryOptions(host, issue, url));
    expect(host.readImage).toHaveBeenCalledTimes(1);
  });

  it("keeps an image read alive across deferred previews and fullscreen handoff", async () => {
    let finish!: (value: ImageData) => void;
    const host = imageHost(
      vi.fn<ArcoHost["readImage"]>(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const client = queryClient();
    const options = presentationImageQueries(host, [github()])[0];
    const group = new QueryObserver(client, options);
    const stopGroup = group.subscribe(() => {});
    const signal = vi.mocked(host.readImage).mock.calls[0][3]!.signal!;
    const deferred = new QueryObserver(client, { ...options, enabled: false });
    const stopDeferred = deferred.subscribe(() => {});
    stopDeferred();
    expect(signal.aborted).toBe(false);
    const visible = new QueryObserver(
      client,
      sourceImageQueryOptions(host, github(), url),
    );
    const stopVisible = visible.subscribe(() => {});
    stopGroup();
    expect(signal.aborted).toBe(false);
    finish(image);
    await vi.waitFor(() =>
      expect(visible.getCurrentResult().data).toEqual(image),
    );
    expect(host.readImage).toHaveBeenCalledTimes(1);
    stopVisible();
  });

  it("cancels queued background reads when the final group observers leave", async () => {
    const queue = createToolQueue();
    const finishes: (() => void)[] = [];
    const start = vi.fn(
      () =>
        new Promise<ImageData>((resolve) => {
          finishes.push(() => resolve(image));
        }),
    );
    const host = imageHost(
      vi.fn<ArcoHost["readImage"]>((_issue, _url, _comment, options) =>
        queue.run(start, options),
      ),
    );
    const client = queryClient();
    const options = presentationImageQueries(host, [
      github(1),
      github(2),
      github(3),
      github(4),
    ]);
    const stop = options.map((option) =>
      new QueryObserver(client, option).subscribe(() => {}),
    );
    expect(start).toHaveBeenCalledTimes(2);
    stop.forEach((unsubscribe) => unsubscribe());
    for (const finish of finishes) finish();
    await vi.waitFor(() => {
      for (const option of options)
        expect(client.getQueryState(option.queryKey)?.fetchStatus).toBe("idle");
    });
    expect(start).toHaveBeenCalledTimes(2);
    for (const option of options)
      expect(client.getQueryState(option.queryKey)?.error).toBeNull();
    queue.close();
  });

  it("contains one image failure without rejecting the other image reads", async () => {
    const host = imageHost(
      vi.fn<ArcoHost["readImage"]>((issue) =>
        issue.source === "github" && issue.number === 1
          ? Promise.reject(new Error("Image unavailable"))
          : Promise.resolve(image),
      ),
    );
    const client = queryClient();
    const options = presentationImageQueries(host, [github(1), github(2)]);
    await expect(
      Promise.all(options.map((option) => client.prefetchQuery(option))),
    ).resolves.toEqual([undefined, undefined]);
    expect(client.getQueryState(options[0].queryKey)?.status).toBe("error");
    expect(client.getQueryData(options[1].queryKey)).toEqual(image);
  });
});
