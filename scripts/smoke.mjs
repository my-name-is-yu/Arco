import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/dev/server.mjs"],
  env: { ...process.env },
  stderr: "pipe",
});
let stderr = "";
transport.stderr?.on("data", (chunk) => {
  stderr += chunk;
});
const client = new Client({ name: "Arco smoke", version: "1" });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  for (const name of [
    "arco_open",
    "arco_get_issue",
    "arco_account_issues",
    "arco_repositories",
    "arco_update_issue",
    "arco_create_issue",
    "arco_change_labels",
    "arco_project_status",
    "search_mentions",
    "arco_read_draft",
    "arco_write_draft",
  ])
    assert(
      tools.tools.some((tool) => tool.name === name),
      `Missing ${name}`,
    );
  const open = tools.tools.find((tool) => tool.name === "arco_open");
  assert.equal(open._meta.ui.resourceUri, "ui://arco/issues");
  assert.deepEqual(open._meta["openai/ui"].entrypoints, [
    { type: "global" },
    { type: "thread" },
  ]);
  const resources = await client.listResources();
  assert(
    resources.resources.some((resource) => resource.uri === "ui://arco/issues"),
  );
  const html = await client.readResource({ uri: "ui://arco/issues" });
  assert.equal(html.contents[0].mimeType, "text/html;profile=mcp-app");
  assert.deepEqual(html.contents[0]._meta["openai/ui"].availableDisplayModes, [
    "inline",
    "fullscreen",
  ]);
  assert(html.contents[0].text.includes("<!doctype html>"));
  const search = await client.callTool({
    name: "search_mentions",
    arguments: { query: "repo:yu/Arco" },
  });
  assert.equal(search.isError, undefined);
  assert(search.structuredContent.items.length >= 2);
  const issue = await client.readResource({
    uri: search.structuredContent.items[0].resourceUri,
  });
  assert(issue.contents[0].text.includes("yu/Arco"));
  const linearSearch = await client.callTool({
    name: "search_mentions",
    arguments: { query: "source:linear team:YU workflow" },
  });
  assert(!linearSearch.isError);
  assert.equal(linearSearch.structuredContent.items.length, 1);
  const linearIssue = await client.readResource({
    uri: linearSearch.structuredContent.items[0].resourceUri,
  });
  assert(linearIssue.contents[0].text.includes("YU-42"));
  assert(linearIssue.contents[0].text.includes("Workflow state: In Progress"));
  const list = await client.callTool({
    name: "arco_list_issues",
    arguments: { repo: "yu/Arco" },
  });
  assert(list.structuredContent.issues.length >= 2);
  const accountIssues = await client.callTool({
    name: "arco_account_issues",
    arguments: {},
  });
  assert(!accountIssues.isError);
  assert.equal(accountIssues.structuredContent.scope, "account");
  assert.equal(accountIssues.structuredContent.filter, "assigned");
  assert(accountIssues.structuredContent.issues.length >= 1);
  const repositories = await client.callTool({
    name: "arco_repositories",
    arguments: {},
  });
  assert(!repositories.isError);
  assert.equal(repositories.structuredContent.repositories[0].repo, "yu/Arco");
  for (const name of ["arco_account_issues", "arco_repositories"])
    assert.equal(
      tools.tools.find((tool) => tool.name === name).annotations.readOnlyHint,
      true,
    );
  const params = {
    repo: "yu/Arco",
    number: 42,
    body: "stdio round trip",
    requestId: "smoke-comment-1",
  };
  const comment = await client.callTool({
    name: "arco_comment",
    arguments: params,
  });
  assert(!comment.isError);
  const duplicate = await client.callTool({
    name: "arco_comment",
    arguments: params,
  });
  assert.equal(
    duplicate.structuredContent.comments.length,
    comment.structuredContent.comments.length,
  );
  assert.equal(stderr, "");
  console.log(
    `PASS initialize, ${tools.tools.length} tools, resources/read, mention selection resource, fixture write/dedup; clean stderr/stdout framing`,
  );
} finally {
  await client.close();
}
