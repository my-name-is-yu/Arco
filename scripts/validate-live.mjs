import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repo = process.argv[process.argv.indexOf("--repo") + 1];
assert(
  process.argv.includes("--write") && /^[\w.-]+\/[\w.-]+$/.test(repo),
  "Pass --repo owner/name --write to create and exercise a dedicated validation Issue.",
);
const client = new Client({
  name: "Arco explicit live validation",
  version: "1",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/plugin/server.mjs"],
  env: { ...process.env },
  stderr: "pipe",
});
const run = randomUUID();
let created;
const checks = [];
async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError)
    throw new Error(
      result.content.find((item) => item.type === "text")?.text ??
        "Tool failed",
    );
  return result.structuredContent;
}
async function write(name, args, key) {
  return call(name, { ...args, requestId: `${run}-${key}` });
}
try {
  await client.connect(transport);
  const connection = await call("arco_connection");
  assert.equal(connection.mode, "github");
  assert(connection.connected);
  created = await write(
    "arco_create_issue",
    {
      repo,
      title: "[Arco validation] GitHub Issue round trip",
      body: "Dedicated Arco validation issue for body, property, comment, and state checks. Closed when validation finishes.\n\n- [ ] Save and refetch\n\nExisting issues are not modified.",
    },
    "create",
  );
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/live-validation.json",
    JSON.stringify(
      { repo, number: created.number, url: created.url, state: "running" },
      null,
      2,
    ),
  );
  const ref = { repo, number: created.number };
  checks.push("dedicated Issue created through production MCP");
  const body =
    "# Arco validation\n\n- [x] Markdown body edit and refetch\n\n| Scope | Result |\n| --- | --- |\n| GitHub source | round trip |\n\nThis issue is reserved for Arco validation.";
  let issue = await write(
    "arco_update_issue",
    {
      ...ref,
      expectedUpdatedAt: created.updatedAt,
      patch: {
        title:
          "[Arco validation] Issue edit / labels / comments / state verified",
        body,
      },
    },
    "edit",
  );
  assert.equal(issue.body, body);
  checks.push("title/body edit and authoritative refetch");
  const labels = await call("arco_repo_metadata", { repo });
  const names = ["bug", "documentation"];
  assert(
    names.every((name) => labels.labels.some((label) => label.name === name)),
  );
  issue = await write(
    "arco_change_labels",
    { ...ref, add: names, remove: [] },
    "labels-add",
  );
  assert(
    names.every((name) => issue.labels.some((label) => label.name === name)),
  );
  issue = await write(
    "arco_change_labels",
    { ...ref, add: [], remove: ["bug"] },
    "labels-remove",
  );
  assert(!issue.labels.some((label) => label.name === "bug"));
  assert(issue.labels.some((label) => label.name === "documentation"));
  checks.push("label delta preserves unrelated label");
  if (labels.assignees.includes(connection.account)) {
    issue = await write(
      "arco_update_issue",
      { ...ref, patch: { assignees: [connection.account] } },
      "assign",
    );
    assert(issue.assignees.includes(connection.account));
    issue = await write(
      "arco_update_issue",
      { ...ref, patch: { assignees: [] } },
      "unassign",
    );
    assert.deepEqual(issue.assignees, []);
    checks.push("assignee add/remove");
  }
  const commentBody = `Arco MCP validation: verify comment creation and duplicate calls with the same requestId. run=${run}`;
  const commentArgs = {
    ...ref,
    body: commentBody,
    requestId: `${run}-comment`,
  };
  await call("arco_comment", commentArgs);
  await call("arco_comment", commentArgs);
  issue = await call("arco_get_issue", ref);
  assert.equal(
    issue.comments.filter((comment) => comment.body === commentBody).length,
    1,
  );
  checks.push("comment write / duplicate same requestId executes once");
  issue = await write(
    "arco_update_issue",
    { ...ref, patch: { state: "closed", stateReason: "completed" } },
    "close",
  );
  assert.equal(issue.state, "closed");
  issue = await write(
    "arco_update_issue",
    { ...ref, patch: { state: "open", stateReason: "reopened" } },
    "reopen",
  );
  assert.equal(issue.state, "open");
  checks.push("Close and Reopen independent from Projects");
  const search = await call("search_mentions", {
    query: `repo:${repo} Arco validation`,
  });
  assert(
    search.items.some(
      (item) => item.resourceUri === `issue://github/${repo}/${created.number}`,
    ),
  );
  const resource = await client.readResource({
    uri: `issue://github/${repo}/${created.number}`,
  });
  assert(resource.contents[0].text.includes(body));
  checks.push("mention search and selected context resource");
  await writeFile(
    "test-results/live-validation.json",
    JSON.stringify(
      {
        repo,
        number: created.number,
        url: created.url,
        checks,
        projects:
          issue.projectsError ?? "No Project selected; no Project writes",
        state: "verified",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { url: created.url, checks, projects: issue.projectsError },
      null,
      2,
    ),
  );
} finally {
  if (created) {
    const final = await write(
      "arco_update_issue",
      {
        repo,
        number: created.number,
        patch: { state: "closed", stateReason: "not_planned" },
      },
      "finish",
    );
    assert.equal(final.state, "closed");
    console.log(`Validation Issue left closed: ${created.url}`);
  }
  await client.close();
}
