import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

// Run only after the authorized native UI check is complete, using its saved setup receipt.
const { values } = parseArgs({
  options: {
    receipt: { type: "string" },
    server: { type: "string", default: "dist/plugin/server.mjs" },
  },
});
assert(
  values.receipt,
  "Pass the reviewed --receipt for this validation Project.",
);
const receiptPath = resolve(values.receipt);
const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
assert(
  receipt.project?.id &&
    receipt.project.title === "Arco validation" &&
    receipt.plan.owner === "my-name-is-yu",
);
assert(receipt.validationReceipt);
const validation = JSON.parse(
  await readFile(receipt.validationReceipt, "utf8"),
);
assert.equal(validation.projectId, receipt.project.id);
assert.equal(validation.issue.repo, "my-name-is-yu/Arco");
assert([1, 2].includes(validation.issue.number));
assert(validation.itemId && validation.itemKeptForUi);
function graphql(query, variables) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "gh",
      ["api", "graphql", "--input", "-"],
      { encoding: "utf8", shell: false, timeout: 30_000, maxBuffer: 1_000_000 },
      (error, stdout) => {
        if (error)
          return reject(
            new Error(
              "GitHub did not confirm cleanup. Check the receipt before retrying.",
            ),
          );
        try {
          const result = JSON.parse(stdout);
          assert(!result.errors && result.data);
          resolve(result.data);
        } catch (error) {
          reject(error);
        }
      },
    );
    child.stdin.end(JSON.stringify({ query, variables }));
  });
}
const projectQuery =
  "query ArcoCleanupProject($id:ID!){node(id:$id){...on ProjectV2{id title public closed owner{...on User{login}} items(first:100){totalCount nodes{id} pageInfo{hasNextPage}}}}}";
const initial = await graphql(projectQuery, { id: receipt.project.id });
assert(
  initial.node?.id === receipt.project.id &&
    initial.node.title === "Arco validation" &&
    initial.node.owner.login === "my-name-is-yu" &&
    initial.node.public === false,
);
assert.equal(initial.node.items.pageInfo.hasNextPage, false);
assert(
  initial.node.items.totalCount <= 1 &&
    initial.node.items.nodes.every((item) => item.id === validation.itemId),
  "Unknown Project items exist. Stop before removing or closing anything.",
);
const client = new Client({
  name: "Arco explicit Projects cleanup",
  version: "1",
});
client.setNotificationHandler(
  ResourceUpdatedNotificationSchema,
  () => undefined,
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(values.server)],
  stderr: "pipe",
});
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert(
    !result.isError && result.structuredContent,
    `${name} failed; check the source state before retrying.`,
  );
  return result.structuredContent;
}
try {
  await client.connect(transport);
  const before = await call("arco_issue_projects", validation.issue);
  assert.deepEqual(before.errors, []);
  const membership = before.memberships.find(
    (item) => item.projectId === receipt.project.id,
  );
  if (membership) {
    assert.equal(
      membership.itemId,
      validation.itemId,
      "This item was replaced after validation. Do not remove a newly created item automatically.",
    );
    if (receipt.statusBaseline) {
      const baseline = receipt.statusBaseline;
      assert(
        typeof baseline.fieldId === "string" &&
          typeof baseline.optionId === "string",
      );
      const input = {
        ...validation.issue,
        projectId: receipt.project.id,
        itemId: validation.itemId,
      };
      const fields = await call("arco_project_fields", input);
      assert.equal(fields.hasMore, false);
      const field = fields.fields.find(
        (value) => value.id === baseline.fieldId,
      );
      assert(
        field?.name === "Status" &&
          field.type === "single_select" &&
          field.options.some((option) => option.id === baseline.optionId),
        "The original Status field and option must still belong to this exact Project.",
      );
      if (field.value !== baseline.optionId) {
        await call("arco_project_status", {
          ...input,
          fieldId: baseline.fieldId,
          optionId: baseline.optionId,
          requestId: randomUUID(),
        });
        const restored = await call("arco_project_fields", input);
        assert.equal(
          restored.fields.find((value) => value.id === baseline.fieldId)?.value,
          baseline.optionId,
        );
      }
      receipt.statusRestoredBeforeItemRemoval = true;
    }
    await call("arco_project_membership", {
      ...validation.issue,
      projectId: receipt.project.id,
      itemId: validation.itemId,
      action: "remove",
      requestId: randomUUID(),
    });
  }
  const after = await call("arco_issue_projects", validation.issue);
  assert.deepEqual(after.errors, []);
  assert(
    !after.memberships.some((item) => item.projectId === receipt.project.id),
  );
  const issue = await call("arco_get_issue", validation.issue);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(
          ["title", "body", "state", "stateReason", "assignees", "labels"].map(
            (key) => [key, issue[key]],
          ),
        ),
      ),
    )
    .digest("hex");
  receipt.issueContentUnchangedAfterUi =
    fingerprint === validation.originalIssueFingerprint;
  const empty = await graphql(projectQuery, { id: receipt.project.id });
  assert.equal(
    empty.node.items.totalCount,
    0,
    "Other Project items remain. Review them before closing this Project.",
  );
  assert.equal(empty.node.items.pageInfo.hasNextPage, false);
  assert.deepEqual(
    empty.node.items.nodes,
    [],
    "Unknown Project items remain. Stop before closing the Project.",
  );
  await graphql(
    "mutation ArcoCleanupClose($input:UpdateProjectV2Input!){updateProjectV2(input:$input){projectV2{id closed public}}}",
    { input: { projectId: receipt.project.id, closed: true, public: false } },
  );
  const closed = await graphql(projectQuery, { id: receipt.project.id });
  assert.equal(closed.node.closed, true);
  assert.equal(closed.node.public, false);
  assert.equal(closed.node.items.totalCount, 0);
  receipt.cleanup.push({
    name: "native UI complete; owned item removed and private Project closed",
    ok: true,
  });
  receipt.cleanupPendingUi = false;
  receipt.readyForUi = false;
  receipt.finalProject = closed.node;
  receipt.complete = true;
  receipt.cleanupFinishedAt = new Date().toISOString();
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    `CLEAN ${closed.node.id}; private, closed, no items. Issue content unchanged: ${receipt.issueContentUnchangedAfterUi}`,
  );
} finally {
  await client.close();
}
