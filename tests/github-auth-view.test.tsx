import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureService } from "../src/server/fixture";
import type {
  ArcoHost,
  Connection,
  IssueDetail,
} from "../src/shared/contracts";
import { GitHubAuthScopeContext, useGitHubCall } from "../src/ui/github-auth";
import {
  checkBulkChange,
  type BulkAttempt,
} from "../src/ui/github-bulk-recovery";
import { getCommandRequests } from "../src/ui/session-state";

const scopeA = "fixture-github-session";
const scopeB = "fixture-next-session";
const issue = createFixtureService().fixture.issues()[0];
const clients: QueryClient[] = [];
function clientFor(scope: string) {
  const client = new QueryClient();
  client.setQueryData(["connection"], {
    mode: "fixture",
    connected: true,
    account: "fixture-user",
    authGeneration: scope,
    message: "Fixture only",
  } satisfies Connection);
  clients.push(client);
  return client;
}
function changeScope(client: QueryClient, scope: string) {
  client.setQueryData<Connection>(["connection"], (previous) => ({
    ...previous!,
    authGeneration: scope,
  }));
}
function captureCall(client: QueryClient, host: ArcoHost, scope: string) {
  let captured: ArcoHost["call"] | undefined;
  function Probe() {
    captured = useGitHubCall(host);
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <GitHubAuthScopeContext.Provider value={scope}>
        <Probe />
      </GitHubAuthScopeContext.Provider>
    </QueryClientProvider>,
  );
  if (!captured) throw new Error("The hook did not return a call function.");
  return captured;
}
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
});

describe("GitHub view authentication lifetime", () => {
  it("rejects an old view before dispatch when the same account has a new generation", async () => {
    const client = clientFor(scopeA);
    const dispatch = vi.fn<ArcoHost["call"]>();
    const host = { call: dispatch } as unknown as ArcoHost;
    const call = captureCall(client, host, scopeA);
    const input = {
      repo: issue.repo,
      number: issue.number,
      patch: { title: "Rejected stale-view change" },
    };
    const requests = getCommandRequests(host, "github");
    changeScope(client, scopeB);
    await expect(
      call("arco_update_issue", { ...input, requestId: "never-dispatched" }),
    ).rejects.toMatchObject({ code: "auth" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(requests.size).toBe(0);

    const key = JSON.stringify(["arco_update_issue", input]);
    requests.set(key, "previous-unknown-request");
    await expect(
      call("arco_update_issue", { ...input, requestId: "new-candidate" }),
    ).rejects.toMatchObject({ code: "auth" });
    expect(dispatch).not.toHaveBeenCalled();
    expect([...requests]).toEqual([[key, "previous-unknown-request"]]);
  });

  it("settles a definite mutation acknowledgement after the generation changes so a deliberate repeat uses a new ID", async () => {
    const client = clientFor(scopeA);
    const acknowledged = { ...issue, title: "Acknowledged fixture change" };
    let acknowledge!: (value: typeof issue) => void;
    const pending = new Promise<typeof issue>((resolve) => {
      acknowledge = resolve;
    });
    const dispatch = vi
      .fn<ArcoHost["call"]>()
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(acknowledged);
    const host = { call: dispatch } as unknown as ArcoHost;
    const call = captureCall(client, host, scopeA);
    const intent = {
      repo: issue.repo,
      number: issue.number,
      patch: { title: "Acknowledged fixture change" },
    };
    const result = call("arco_update_issue", {
      ...intent,
      requestId: "late-ack-request-a",
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    changeScope(client, scopeB);
    acknowledge(acknowledged);
    await expect(result).resolves.toBe(acknowledged);
    expect(getCommandRequests(host, "github").size).toBe(0);
    await captureCall(
      client,
      host,
      scopeB,
    )("arco_update_issue", {
      ...intent,
      requestId: "late-ack-candidate-b",
    });
    expect(dispatch.mock.calls.map(([, args]) => args.requestId)).toEqual([
      "late-ack-request-a",
      "late-ack-candidate-b",
    ]);
  });

  it("blocks the next recovery catalog read after an old issue response arrives across a generation change", async () => {
    const client = clientFor(scopeA);
    let release!: (value: IssueDetail) => void;
    const firstRead = new Promise<IssueDetail>((resolve) => {
      release = resolve;
    });
    const dispatch = vi.fn<ArcoHost["call"]>().mockReturnValue(firstRead);
    const call = captureCall(
      client,
      { call: dispatch } as unknown as ArcoHost,
      scopeA,
    );
    const ref = { repo: issue.repo, number: issue.number };
    const attempt: BulkAttempt = {
      name: "arco_bulk_update",
      operation: "fixture-operation",
      targets: [ref],
      args: {
        issues: [ref],
        requestId: "fixture-request-id",
        patch: { milestoneNumber: 1 },
      },
    };
    const result = call<IssueDetail>("arco_get_issue", ref).then((current) =>
      checkBulkChange(call, attempt, current),
    );
    expect(dispatch).toHaveBeenCalledWith("arco_get_issue", ref, undefined);
    changeScope(client, scopeB);
    release(issue);
    await expect(result).rejects.toMatchObject({ code: "auth" });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(
      dispatch.mock.calls.some(([name]) => name === "arco_issue_catalog"),
    ).toBe(false);
  });

  it("requires an explicit authentication provider", () => {
    const client = clientFor(scopeA);
    const host = { call: vi.fn() } as unknown as ArcoHost;
    function Probe() {
      useGitHubCall(host);
      return null;
    }
    expect(() =>
      renderToStaticMarkup(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    ).toThrow("GitHub authentication scope is unavailable");
  });
});

describe("GitHub request identity across view generations", () => {
  const intent = {
    repo: issue.repo,
    number: issue.number,
    patch: { title: "Fixture intent" },
  };

  it("reuses an unacknowledged request ID when the new view supplies a new candidate for the same intent", async () => {
    const client = clientFor(scopeA);
    const dispatch = vi
      .fn<ArcoHost["call"]>()
      .mockRejectedValueOnce(new Error("Acknowledgement was lost"))
      .mockResolvedValueOnce(issue);
    const host = { call: dispatch } as unknown as ArcoHost;
    await expect(
      captureCall(
        client,
        host,
        scopeA,
      )("arco_update_issue", {
        ...intent,
        requestId: "unknown-request-a",
      }),
    ).rejects.toThrow("Acknowledgement was lost");
    expect([...getCommandRequests(host, "github").values()]).toEqual([
      "unknown-request-a",
    ]);
    changeScope(client, scopeB);
    await captureCall(
      client,
      host,
      scopeB,
    )("arco_update_issue", {
      ...intent,
      requestId: "new-candidate-b",
    });
    expect(dispatch.mock.calls.map(([, args]) => args.requestId)).toEqual([
      "unknown-request-a",
      "unknown-request-a",
    ]);
    expect(getCommandRequests(host, "github").size).toBe(0);
  });

  it("releases a same-scope acknowledgement so a deliberate repeat uses its new request ID", async () => {
    const client = clientFor(scopeA);
    const dispatch = vi.fn<ArcoHost["call"]>().mockResolvedValue(issue);
    const host = { call: dispatch } as unknown as ArcoHost;
    const call = captureCall(client, host, scopeA);
    await call("arco_update_issue", {
      ...intent,
      requestId: "acknowledged-request-a",
    });
    expect(getCommandRequests(host, "github").size).toBe(0);
    await call("arco_update_issue", {
      ...intent,
      requestId: "deliberate-repeat-a",
    });
    expect(dispatch.mock.calls.map(([, args]) => args.requestId)).toEqual([
      "acknowledged-request-a",
      "deliberate-repeat-a",
    ]);
    expect(getCommandRequests(host, "github").size).toBe(0);
  });

  it("retains a bulk request that needs confirmation across a new view's candidate ID", async () => {
    const client = clientFor(scopeA);
    const ref = { repo: issue.repo, number: issue.number };
    const intent = { issues: [ref], patch: { state: "closed" } };
    const uncertain = {
      results: [
        {
          ...ref,
          ok: false,
          needsConfirmation: true,
          error: "Read back the result before retrying.",
        },
      ],
    };
    const dispatch = vi.fn<ArcoHost["call"]>().mockResolvedValue(uncertain);
    const host = { call: dispatch } as unknown as ArcoHost;
    await expect(
      captureCall(
        client,
        host,
        scopeA,
      )("arco_bulk_update", {
        ...intent,
        requestId: "bulk-unconfirmed-a",
      }),
    ).resolves.toBe(uncertain);
    expect([...getCommandRequests(host, "github").values()]).toEqual([
      "bulk-unconfirmed-a",
    ]);
    changeScope(client, scopeB);
    await captureCall(
      client,
      host,
      scopeB,
    )("arco_bulk_update", {
      ...intent,
      requestId: "bulk-new-candidate-b",
    });
    expect(dispatch.mock.calls.map(([, args]) => args.requestId)).toEqual([
      "bulk-unconfirmed-a",
      "bulk-unconfirmed-a",
    ]);
    expect([...getCommandRequests(host, "github").values()]).toEqual([
      "bulk-unconfirmed-a",
    ]);
  });

  it("uses a new request ID for changed intent while retaining the previous unknown request", async () => {
    const client = clientFor(scopeA);
    const dispatch = vi
      .fn<ArcoHost["call"]>()
      .mockRejectedValueOnce(new Error("Acknowledgement was lost"))
      .mockResolvedValueOnce(issue);
    const host = { call: dispatch } as unknown as ArcoHost;
    await expect(
      captureCall(
        client,
        host,
        scopeA,
      )("arco_update_issue", {
        ...intent,
        requestId: "previous-unknown-a",
      }),
    ).rejects.toThrow("Acknowledgement was lost");
    changeScope(client, scopeB);
    const changed = { ...intent, patch: { title: "Changed fixture intent" } };
    await captureCall(
      client,
      host,
      scopeB,
    )("arco_update_issue", {
      ...changed,
      requestId: "changed-intent-b",
    });
    expect(dispatch.mock.calls.map(([, args]) => args.requestId)).toEqual([
      "previous-unknown-a",
      "changed-intent-b",
    ]);
    expect(dispatch).toHaveBeenLastCalledWith(
      "arco_update_issue",
      {
        ...changed,
        requestId: "changed-intent-b",
      },
      undefined,
    );
    expect([...getCommandRequests(host, "github").values()]).toEqual([
      "previous-unknown-a",
    ]);
  });
});
