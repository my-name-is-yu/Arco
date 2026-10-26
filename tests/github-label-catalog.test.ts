import { describe, expect, it } from "vitest";
import { createGitHubService, type GhRunner } from "../src/server/github";
import {
  callGitHubOperation,
  createGitHubOperations,
} from "../src/server/github-operations";
import { GitHubError } from "../src/server/github/transport";
import type { BulkUpdateResult } from "../src/shared/github-operations";

const repo = "fictional/labels";
const ref = { repo, number: 1 };
const keep = { id: 1, name: "keep", color: "eeeeee" };
const other = { id: 2, name: "other", color: "abcdef" };
const bug = { id: 3, name: "bug", color: "d73a4a" };
const catalogPath = `repos/${repo}/labels?per_page=100`;
const assigneesPath = `repos/${repo}/assignees?per_page=100`;

function source() {
  const calls: { endpoint: string; method: string; body?: string }[] = [];
  const assigned = new Map<number, (typeof keep)[]>();
  const controls: {
    catalog(read: number): (typeof keep)[][];
    addError?: Error;
    removeError?: Error;
  } = {
    catalog: () => [[keep, other], [bug]],
  };
  let catalogReads = 0;
  const run: GhRunner = async (args, body) => {
    const endpoint = args[3];
    const method = args[args.indexOf("--method") + 1];
    calls.push({ endpoint, method, body });
    if (endpoint === catalogPath) return controls.catalog(++catalogReads);
    if (endpoint === assigneesPath) return [[{ login: "fictional-user" }]];
    if (endpoint === "graphql") {
      const { query, variables } = JSON.parse(body!);
      if (!query.includes("ArcoIssueMemberships"))
        throw new Error("Unexpected fictional GraphQL request");
      return {
        data: {
          repository: {
            issue: {
              id: `I${variables.number}`,
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
    const target = /^repos\/fictional\/labels\/issues\/(\d+)(.*)$/.exec(
      endpoint,
    );
    if (!target) throw new Error(`Unexpected fictional request: ${endpoint}`);
    const number = Number(target[1]);
    const labels = assigned.get(number) ?? [keep, other];
    if (target[2] === "" && method === "GET")
      return {
        id: number,
        node_id: `I${number}`,
        number,
        title: "Fictional issue",
        body: "Fresh source body",
        state: "open",
        updated_at: "2026-10-26T00:00:00Z",
        html_url: `https://github.com/${repo}/issues/${number}`,
        repository_url: `https://api.github.com/repos/${repo}`,
        user: { login: "fictional-user" },
        labels,
        assignees: [],
      };
    if (target[2] === "/labels" && method === "POST") {
      if (controls.addError) throw controls.addError;
      const requested = JSON.parse(body!).labels as string[];
      assigned.set(number, [
        ...labels,
        ...requested.map((name) => ({ id: 3, name, color: "d73a4a" })),
      ]);
      return [];
    }
    if (target[2].startsWith("/labels/") && method === "DELETE") {
      if (controls.removeError) throw controls.removeError;
      assigned.set(
        number,
        labels.filter(
          (label) => label.name !== decodeURIComponent(target[2].slice(8)),
        ),
      );
      return [];
    }
    throw new Error(`Unexpected fictional write: ${method} ${endpoint}`);
  };
  const service = createGitHubService({
    credentialIdentity: async () => "test-credential",
    run,
  });
  const operations = createGitHubOperations({
    credentialIdentity: async () => "test-credential",
    service,
    run,
  });
  return { service, operations, calls, controls };
}

const mutations = (calls: ReturnType<typeof source>["calls"]) =>
  calls.filter((call) => call.method !== "GET" && call.endpoint !== "graphql");

describe("GitHub label catalog reads", () => {
  it("reads fresh paginated labels for each bulk issue without fetching assignees", async () => {
    const { operations, calls } = source();
    const result = (await callGitHubOperation(operations, "arco_bulk_update", {
      issues: [ref, { ...ref, number: 2 }],
      requestId: "label-catalog-bulk",
      labels: { add: [bug.name] },
    })) as BulkUpdateResult;
    expect(result.results.map((value) => value.ok)).toEqual([true, true]);
    expect(calls.filter((call) => call.endpoint === catalogPath)).toHaveLength(
      2,
    );
    expect(calls.filter((call) => call.endpoint === assigneesPath)).toEqual([]);
    expect(mutations(calls).map((call) => call.endpoint)).toEqual([
      `repos/${repo}/issues/1/labels`,
      `repos/${repo}/issues/2/labels`,
    ]);
    const updated = result.results[1];
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.issue.labels.map((label) => label.name)).toEqual([
      keep.name,
      other.name,
      bug.name,
    ]);
  });

  it("rejects a label removed from the catalog between sequential bulk issues", async () => {
    const { operations, calls, controls } = source();
    controls.catalog = (read) =>
      read === 1 ? [[keep, other, bug]] : [[keep, other]];
    const result = (await callGitHubOperation(operations, "arco_bulk_update", {
      issues: [ref, { ...ref, number: 2 }],
      requestId: "label-catalog-changed",
      labels: { add: [bug.name] },
    })) as BulkUpdateResult;
    expect(result.results[0].ok).toBe(true);
    expect(result.results[1]).toMatchObject({
      ok: false,
      errorCode: "invalid",
    });
    expect(calls.filter((call) => call.endpoint === catalogPath)).toHaveLength(
      2,
    );
    expect(mutations(calls)).toHaveLength(1);
  });

  it("keeps the public metadata result complete", async () => {
    const { service, calls } = source();
    expect(await service.metadata(repo)).toMatchObject({
      labels: [keep, other, bug].map((label) => ({
        ...label,
        id: String(label.id),
      })),
      assignees: ["fictional-user"],
    });
    expect(
      calls.filter((call) => call.endpoint === assigneesPath),
    ).toHaveLength(1);
  });

  it("keeps empty changes read-only without fetching unused catalogs", async () => {
    const { service, calls } = source();
    const issue = await service.labels({
      ...ref,
      requestId: "empty-label-delta",
      add: [],
      remove: [],
    });
    expect(issue.body).toBe("Fresh source body");
    expect(mutations(calls)).toEqual([]);
    expect(
      calls.filter(
        (call) =>
          call.endpoint === catalogPath || call.endpoint === assigneesPath,
      ),
    ).toEqual([]);
    expect(
      calls.filter((call) => call.endpoint === `repos/${repo}/issues/1`),
    ).toHaveLength(2);
  });

  it("removes an existing label without a catalog and preserves unspecified labels", async () => {
    const { service, calls } = source();
    const input = {
      ...ref,
      requestId: "remove-label-delta",
      add: [],
      remove: [keep.name],
    };
    expect(
      (await service.labels(input)).labels.map((label) => label.name),
    ).toEqual([other.name]);
    await service.labels(input);
    expect(mutations(calls)).toHaveLength(1);
    expect(mutations(calls)[0]).toMatchObject({
      method: "DELETE",
      endpoint: `repos/${repo}/issues/1/labels/keep`,
    });
    expect(
      calls.filter(
        (call) =>
          call.endpoint === catalogPath || call.endpoint === assigneesPath,
      ),
    ).toEqual([]);
  });

  it("does not write when a fresh catalog cannot be read", async () => {
    const { service, calls, controls } = source();
    controls.catalog = () => {
      throw new GitHubError("Catalog access denied.", "forbidden");
    };
    await expect(
      service.labels({
        ...ref,
        requestId: "label-catalog-denied",
        add: [bug.name],
        remove: [],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(mutations(calls)).toEqual([]);
  });

  it("does not replay a partly saved label delta", async () => {
    const { service, calls, controls } = source();
    controls.removeError = new GitHubError("Removal denied.", "forbidden");
    const input = {
      ...ref,
      requestId: "partial-label-delta",
      add: [bug.name],
      remove: [keep.name],
    };
    await expect(service.labels(input)).rejects.toMatchObject({
      code: "uncertain",
    });
    await expect(service.labels(input)).rejects.toMatchObject({
      code: "uncertain",
    });
    expect(mutations(calls).map((call) => call.method)).toEqual([
      "POST",
      "DELETE",
    ]);
  });

  it("does not replay an unconfirmed label addition", async () => {
    const { service, calls, controls } = source();
    controls.addError = new Error("Fictional transport secret");
    const input = {
      ...ref,
      requestId: "unknown-label-delta",
      add: [bug.name],
      remove: [],
    };
    await expect(service.labels(input)).rejects.toMatchObject({
      code: "uncertain",
      message: expect.not.stringContaining("Fictional transport secret"),
    });
    await expect(service.labels(input)).rejects.toMatchObject({
      code: "uncertain",
    });
    expect(mutations(calls)).toHaveLength(1);
  });
});
