import { describe, expect, it } from "vitest";
import { createGitHubService, type GhRunner } from "../src/server/github";
import { createGitHubOperations } from "../src/server/github-operations";
import { GitHubError } from "../src/server/github/transport";
import { createGitHubAuthSession } from "../src/server/github/auth-session";
import { createFixtureService, FIXTURE_REPO } from "../src/server/fixture";
import { createBulkOperations } from "../src/server/github/bulk";
import { createFieldsOperations } from "../src/server/github/fields";
import { createGitHubOperationContext } from "../src/server/github/operations-context";
import { createProjectsOperations } from "../src/server/github/projects";

const repo = "fictional/receipts";
const ref = { repo, number: 1 };
const comment = {
  ...ref,
  requestId: "same-comment-request",
  body: "Post once",
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function source() {
  const controls: {
    identity: string;
    identityFailure: boolean;
    denyIssue: boolean;
    unknownWrite: boolean;
    beforeIssue?: () => Promise<void>;
    afterComment?: () => Promise<void>;
  } = {
    identity: "private-scope-A",
    identityFailure: false,
    denyIssue: false,
    unknownWrite: false,
  };
  const writes: { endpoint: string; account: string }[] = [];
  const states = new Map<number, string>();
  const credentialIdentity = async () => {
    if (controls.identityFailure)
      throw new GitHubError("Sign in again.", "auth");
    return controls.identity;
  };
  const run: GhRunner = async (args, input) => {
    const endpoint = args[3];
    const method = args[args.indexOf("--method") + 1];
    const account = controls.identity.endsWith("B") ? "account-B" : "account-A";
    const body = JSON.parse(input ?? "{}");
    if (endpoint.startsWith("issues?"))
      return `HTTP/2.0 200 OK\r\nETag: "${account}"\r\n\r\n[]`;
    if (endpoint === "graphql") {
      if (!body.query.includes("ArcoIssueMemberships"))
        throw new Error("Unexpected fictional GraphQL query");
      return {
        data: {
          repository: {
            issue: {
              id: `I${body.variables.number}`,
              projectItems: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      };
    }
    if (/\/comments\?/.test(endpoint)) return [];
    if (method === "POST" && endpoint === `repos/${repo}/labels`) {
      writes.push({ endpoint, account });
      return {
        id: 1,
        name: body.name,
        color: body.color,
        description: `Label for ${account}`,
      };
    }
    const issue = /^repos\/fictional\/receipts\/issues\/(\d+)(.*)$/.exec(
      endpoint,
    );
    if (!issue) throw new Error(`Unexpected fictional endpoint: ${endpoint}`);
    const number = Number(issue[1]);
    if (method === "GET" && !issue[2]) {
      await controls.beforeIssue?.();
      if (controls.denyIssue)
        throw new GitHubError("No issue permission.", "forbidden");
      return {
        id: number,
        node_id: `I${number}`,
        number,
        title: `Issue for ${account}`,
        body: `Private body for ${account}`,
        state: states.get(number) ?? "open",
        updated_at: "2026-10-26T00:00:00Z",
        html_url: `https://github.com/${repo}/issues/${number}`,
        repository_url: `https://api.github.com/repos/${repo}`,
        user: { login: account },
        labels: [],
        assignees: [],
      };
    }
    if (method === "PATCH" && !issue[2]) {
      writes.push({ endpoint, account });
      states.set(number, body.state ?? "open");
      return {};
    }
    if (method === "POST" && issue[2] === "/comments") {
      writes.push({ endpoint, account });
      await controls.afterComment?.();
      if (controls.unknownWrite)
        throw new Error("Fictional unconfirmed response");
      return {
        id: 1,
        node_id: "C1",
        body: body.body,
        user: { login: account },
        html_url: `https://github.com/${repo}/issues/${number}#issuecomment-1`,
        updated_at: "2026-10-26T00:00:00Z",
      };
    }
    throw new Error(`Unexpected fictional operation: ${method} ${endpoint}`);
  };
  const authSession = createGitHubAuthSession(credentialIdentity);
  const service = createGitHubService({ run, authSession });
  const operations = createGitHubOperations({
    service,
    run,
    authSession,
  });
  return { service, operations, controls, writes };
}

const scopeFailure = {
  code: expect.stringMatching(/^(?:auth|conflict|refresh|uncertain)$/),
};

describe("GitHub write receipts follow the current credential", () => {
  it("deduplicates an unchanged credential but never exposes its receipt after a switch", async () => {
    const { service, controls, writes } = source();
    const first = await service.comment(comment);
    expect(first.body).toBe("Private body for account-A");
    expect(await service.comment(comment)).toEqual(first);
    controls.identity = "private-scope-B";
    await expect(service.comment(comment)).rejects.toMatchObject(scopeFailure);
    expect(writes).toHaveLength(1);
    const currentRequest = {
      ...comment,
      requestId: "new-account-request",
    };
    controls.denyIssue = true;
    await expect(service.comment(currentRequest)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(writes).toHaveLength(1);
    controls.denyIssue = false;
    const next = await service.comment(currentRequest);
    expect(next.body).toBe("Private body for account-B");
    expect(JSON.stringify(next)).not.toContain("private-scope");
    expect(writes.map((write) => write.account)).toEqual([
      "account-A",
      "account-B",
    ]);
  });

  it("does not reuse a receipt after a same-account credential rotation", async () => {
    const { service, controls, writes } = source();
    await service.comment(comment);
    controls.identity = "private-scope-A2";
    await expect(service.comment(comment)).rejects.toMatchObject(scopeFailure);
    expect(writes).toHaveLength(1);
    expect(
      (
        await service.comment({
          ...comment,
          requestId: "rotated-account-request",
        })
      ).author,
    ).toBe("account-A");
  });

  it("does not revive an old receipt after an observed A-to-B-to-A transition", async () => {
    const { service, controls, writes } = source();
    await service.comment(comment);
    controls.identity = "private-scope-B";
    await expect(service.comment(comment)).rejects.toMatchObject(scopeFailure);
    controls.identity = "private-scope-A";
    await expect(service.comment(comment)).rejects.toMatchObject(scopeFailure);
    expect(writes).toHaveLength(1);
  });

  it.each(["core", "extended"] as const)(
    "shares observed credential changes across the %s and other operation paths",
    async (cached) => {
      const { service, operations, controls, writes } = source();
      const input = {
        repo,
        requestId: "shared-label-request",
        name: "shared-label",
        color: "abcdef",
        description: "Scope fixture",
      };
      const previous =
        cached === "core"
          ? () => service.comment(comment)
          : () => operations.createLabel(input);
      await previous();
      controls.identity = "private-scope-B";
      if (cached === "core") await operations.createLabel(input);
      if (cached === "extended") await service.comment(comment);
      controls.identity = "private-scope-A";
      await expect(previous()).rejects.toMatchObject(scopeFailure);
      expect(writes).toHaveLength(2);
    },
  );

  it.each(["core", "extended"] as const)(
    "does not revive a %s receipt when only an account list observed the other credential",
    async (cached) => {
      const { service, operations, controls, writes } = source();
      const previous =
        cached === "core"
          ? () => service.comment(comment)
          : () =>
              operations.createLabel({
                repo,
                requestId: "read-observed-label",
                name: "read-observed",
                color: "abcdef",
                description: "Scope fixture",
              });
      await previous();
      controls.identity = "private-scope-B";
      await service.accountIssues({
        filter: "assigned",
        state: "open",
        sort: "updated",
        order: "desc",
        page: 1,
      });
      controls.identity = "private-scope-A";
      await expect(previous()).rejects.toMatchObject(scopeFailure);
      expect(writes).toHaveLength(1);
    },
  );

  it("binds extended operation receipts to the credential", async () => {
    const { operations, controls, writes } = source();
    const input = {
      repo,
      requestId: "same-label-request",
      name: "new-label",
      color: "abcdef",
      description: "Scope fixture",
    };
    expect(await operations.createLabel(input)).toMatchObject({
      label: { description: "Label for account-A" },
    });
    controls.identity = "private-scope-B";
    await expect(operations.createLabel(input)).rejects.toMatchObject(
      scopeFailure,
    );
    expect(writes).toHaveLength(1);
  });

  it("binds bulk results while new requests retain normal issue checks", async () => {
    const { operations, controls, writes } = source();
    const input = {
      requestId: "same-bulk-request",
      issues: [ref],
      patch: { state: "closed" as const },
    };
    const first = await operations.bulkUpdate(input);
    expect(first).toMatchObject({
      results: [{ ok: true, issue: { body: "Private body for account-A" } }],
    });
    controls.identity = "private-scope-B";
    await expect(operations.bulkUpdate(input)).rejects.toMatchObject(
      scopeFailure,
    );
    expect(writes).toHaveLength(1);
    const next = await operations.bulkUpdate({
      ...input,
      requestId: "new-bulk-request",
    });
    expect(next).toMatchObject({
      results: [{ ok: true, issue: { body: "Private body for account-B" } }],
    });
    expect(writes).toHaveLength(2);
  });

  it("binds bulk-member receipts independently of the outer scheduler", async () => {
    let identity = "member-scope-A";
    const context = createGitHubOperationContext({
      service: createFixtureService(),
      credentialIdentity: async () => identity,
    });
    context.once = (...args) => args[2]();
    const operations = createBulkOperations(
      context,
      createFieldsOperations(context),
      createProjectsOperations(context),
    );
    const input = {
      requestId: "member-only-request",
      issues: [{ repo: FIXTURE_REPO, number: 42 }],
      patch: { state: "closed" as const },
    };
    expect(await operations.bulkUpdate(input)).toMatchObject({
      results: [{ ok: true }],
    });
    identity = "member-scope-B";
    await expect(operations.bulkUpdate(input)).rejects.toMatchObject(
      scopeFailure,
    );
  });

  it("does not dispatch a mutation when credentials change during preflight", async () => {
    const { service, controls, writes } = source();
    const started = deferred();
    const resume = deferred();
    controls.beforeIssue = async () => {
      controls.beforeIssue = undefined;
      started.resolve();
      await resume.promise;
    };
    const pending = service.comment(comment);
    await started.promise;
    controls.identity = "private-scope-B";
    resume.resolve();
    await expect(pending).rejects.toMatchObject(scopeFailure);
    expect(writes).toEqual([]);
  });

  it("does not expose a late result or replay a dispatched mutation after a switch", async () => {
    const { service, controls, writes } = source();
    const started = deferred();
    const resume = deferred();
    controls.afterComment = async () => {
      controls.afterComment = undefined;
      started.resolve();
      await resume.promise;
    };
    const pending = service.comment(comment);
    await started.promise;
    controls.identity = "private-scope-B";
    resume.resolve();
    await expect(pending).rejects.toMatchObject(scopeFailure);
    await expect(service.comment(comment)).rejects.toMatchObject(scopeFailure);
    expect(writes).toHaveLength(1);
  });

  it("keeps a definite same-credential preflight rejection retryable", async () => {
    const { service, controls, writes } = source();
    controls.denyIssue = true;
    await expect(service.comment(comment)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(writes).toEqual([]);
    controls.denyIssue = false;
    await expect(service.comment(comment)).resolves.toMatchObject({
      body: "Private body for account-A",
    });
    expect(writes).toHaveLength(1);
  });

  it("keeps unconfirmed writes blocked across credential changes", async () => {
    const { service, controls, writes } = source();
    controls.unknownWrite = true;
    await expect(service.comment(comment)).rejects.toMatchObject({
      code: "uncertain",
    });
    controls.identity = "private-scope-B";
    await expect(service.comment(comment)).rejects.toMatchObject(scopeFailure);
    expect(writes).toHaveLength(1);
  });

  it("does not return cached data when the current credential cannot be read", async () => {
    const { service, controls, writes } = source();
    await service.comment(comment);
    controls.identityFailure = true;
    await expect(service.comment(comment)).rejects.toMatchObject({
      code: "auth",
    });
    controls.identityFailure = false;
    await expect(service.comment(comment)).rejects.toMatchObject(scopeFailure);
    expect(
      (
        await service.comment({
          ...comment,
          requestId: "reauthenticated-request",
        })
      ).body,
    ).toBe("Private body for account-A");
    expect(writes).toHaveLength(2);
  });
});
