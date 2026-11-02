import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { text } from "node:stream/consumers";
import { setTimeout } from "node:timers/promises";
import { expect, test } from "@playwright/test";

async function postSplitBody(url: URL, body: Buffer, split: number) {
  const outgoing = request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked",
    },
  });
  const response = new Promise<{ status: number | undefined; body: string }>(
    (resolve, reject) => {
      outgoing.once("error", reject);
      outgoing.once("response", (incoming) => {
        void text(incoming).then(
          (body) => resolve({ status: incoming.statusCode, body }),
          reject,
        );
      });
    },
  );
  outgoing.write(body.subarray(0, split));
  await setTimeout(25);
  outgoing.end(body.subarray(split));
  return response;
}

test("the real fixture host preserves a tool body split inside a UTF-8 character", async ({
  request,
  baseURL,
}) => {
  const created = await request.post("/session");
  expect(created.ok()).toBe(true);
  const { session } = (await created.json()) as { session: string };
  try {
    const body = "日本語🧭 — fictional fixture edit";
    const payload = Buffer.from(
      JSON.stringify({
        session,
        name: "arco_update_issue",
        arguments: {
          repo: "yu/Arco",
          number: 42,
          requestId: randomUUID(),
          patch: { body },
        },
      }),
    );
    const result = await postSplitBody(
      new URL("/tool", baseURL),
      payload,
      payload.indexOf(Buffer.from("🧭")) + 2,
    );
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).structuredContent.body).toBe(body);
    const refreshed = await request.post("/tool", {
      data: {
        session,
        name: "arco_get_issue",
        arguments: { repo: "yu/Arco", number: 42 },
      },
    });
    expect((await refreshed.json()).structuredContent.body).toBe(body);
  } finally {
    expect((await request.delete(`/session/${session}`)).ok()).toBe(true);
  }
});

test("the fixture host still rejects an oversized streamed request", async ({
  baseURL,
}) => {
  const result = await postSplitBody(
    new URL("/tool", baseURL),
    Buffer.alloc(1_000_001, "a"),
    500_000,
  );
  expect(result.status).toBe(500);
  expect(JSON.parse(result.body)).toEqual({ error: "Request too large" });
});

test("closing a fixture session is idempotent and rejects further tool calls", async ({
  request,
}) => {
  const created = await request.post("/session");
  expect(created.ok()).toBe(true);
  const { session } = (await created.json()) as { session: string };
  try {
    const closed = await request.delete(`/session/${session}`);
    expect(closed.ok()).toBe(true);
    expect(await closed.json()).toEqual({ closed: true });
    const tool = await request.post("/tool", {
      data: { session, name: "arco_connection", arguments: {} },
    });
    expect(tool.status()).toBe(404);
    expect((await request.delete(`/session/${session}`)).ok()).toBe(true);
    expect((await request.delete("/session/not-a-session")).status()).toBe(400);
  } finally {
    expect((await request.delete(`/session/${session}`)).ok()).toBe(true);
  }
});
