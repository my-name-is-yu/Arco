import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { expect, it, vi } from "vitest";
import { createLiveBackend } from "../src/server/composition";

const credential = vi.hoisted(() => ({ identity: "private-A" }));
vi.mock("../src/server/github/credential-identity", () => ({
  credentialIdentity: async () => credential.identity,
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

it("shares observed sign-ins between the production core and extended operations", async () => {
  const writes: string[] = [];
  vi.mocked(spawn).mockImplementation((_command, args) => {
    const endpoint = args![3];
    const method = args![args!.indexOf("--method") + 1];
    const account =
      credential.identity === "private-B" ? "account-B" : "account-A";
    let stdout: string;
    if (endpoint === "user") {
      stdout = JSON.stringify({
        login: account,
        id: account === "account-A" ? 1 : 2,
      });
    } else if (
      endpoint === "repos/fictional/receipts/labels" &&
      method === "POST"
    ) {
      writes.push(account);
      stdout = JSON.stringify({
        id: 1,
        name: "new-label",
        color: "abcdef",
        description: `Private label for ${account}`,
      });
    } else if (endpoint.startsWith("issues?") && method === "GET") {
      stdout = `HTTP/2.0 200 OK\r\nETag: "${account}"\r\n\r\n[]`;
    } else {
      throw new Error(`Unexpected fictional GitHub CLI request: ${endpoint}`);
    }
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      child.stdout.emit("data", stdout);
      child.emit("close", 0);
    });
    return child as unknown as ReturnType<typeof spawn>;
  });
  const backend = createLiveBackend();
  const input = {
    repo: "fictional/receipts",
    requestId: "production-shared-label",
    name: "new-label",
    color: "abcdef",
    description: "Scope fixture",
  };
  expect(await backend.operations.createLabel(input)).toMatchObject({
    label: { description: "Private label for account-A" },
  });
  credential.identity = "private-B";
  await backend.service.accountIssues({
    filter: "assigned",
    state: "open",
    sort: "updated",
    order: "desc",
    page: 1,
  });
  credential.identity = "private-A";
  await expect(backend.operations.createLabel(input)).rejects.toMatchObject({
    code: "conflict",
  });
  expect(writes).toEqual(["account-A"]);
  backend.cleanup();
});
