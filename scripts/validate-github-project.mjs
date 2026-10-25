import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

// Opt-in, authorized live validation. This never creates Projects or field definitions.
const { values } = parseArgs({
  options: {
    repo: { type: "string", default: "my-name-is-yu/Arco" },
    issue: { type: "string", default: "2" },
    "project-id": { type: "string" },
    owner: { type: "string", default: "my-name-is-yu" },
    "owner-type": { type: "string", default: "user" },
    server: { type: "string", default: "dist/plugin/server.mjs" },
    "field-prefix": { type: "string" },
    "require-all-types": { type: "boolean", default: false },
    "keep-item-for-ui": { type: "boolean", default: false },
    "report-path": { type: "string" },
  },
});
assert(
  values["project-id"],
  "Pass the explicitly selected existing --project-id.",
);
assert(["user", "organization"].includes(values["owner-type"]));
assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values.repo));
assert(/^[A-Za-z0-9-]+$/.test(values.owner));
const ref = { repo: values.repo, number: Number(values.issue) };
assert(Number.isSafeInteger(ref.number) && ref.number > 0);
const projectId = values["project-id"];
const runId = randomUUID();
const reportPath = resolve(
  values["report-path"] ?? `dist/dev/github-project-validation-${runId}.json`,
);
const report = {
  runId,
  issue: ref,
  projectId,
  startedAt: new Date().toISOString(),
  checks: [],
  unavailableTypes: [],
  cleanup: [],
  complete: false,
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(values.server)],
  stderr: "pipe",
});
let stderrBytes = 0;
transport.stderr?.on("data", (chunk) => {
  stderrBytes += chunk.length;
});
const client = new Client({
  name: "Arco explicit Projects validation",
  version: "1",
});
client.setNotificationHandler(
  ResourceUpdatedNotificationSchema,
  () => undefined,
);
const requests = new Map();
let original;
let existingMembership;
let itemId;
let baselineFields = [];
let attemptedAdd = false;
let failure;
const modified = new Set();

async function persist() {
  await mkdir(resolve("dist/dev"), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
function requestId(key) {
  if (!requests.has(key)) requests.set(key, randomUUID());
  return requests.get(key);
}
async function call(name, args) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError)
    throw new Error(
      `${name}: ${response.content?.find((item) => item.type === "text")?.text ?? "Tool failed"}`,
    );
  assert(
    response.structuredContent &&
      typeof response.structuredContent === "object",
    `${name} returned no data`,
  );
  return response.structuredContent;
}
async function check(name, action) {
  try {
    await action();
    report.checks.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.checks.push({ name, ok: false, error: error.message });
    throw error;
  } finally {
    await persist();
  }
}
async function cleanup(name, action) {
  try {
    await action();
    report.cleanup.push({ name, ok: true });
    console.log(`CLEAN ${name}`);
  } catch (error) {
    report.cleanup.push({ name, ok: false, error: error.message });
    console.log(`CLEANUP FAILED ${name}`);
  }
  await persist();
}
const fieldInput = () => ({ ...ref, projectId, itemId });
async function readFields() {
  const result = await call("arco_project_fields", fieldInput());
  assert.equal(
    result.hasMore,
    false,
    "The selected Project fields were not loaded completely",
  );
  return result.fields;
}
async function setField(field, value, key) {
  await call("arco_set_project_field", {
    ...fieldInput(),
    fieldId: field.id,
    value,
    requestId: requestId(key),
  });
  const saved = (await readFields()).find((value) => value.id === field.id);
  assert(saved, "The source field disappeared");
  assert.deepEqual(saved.value, value);
}

try {
  await client.connect(transport);
  await check(
    "existing Project and dedicated validation issue preflight",
    async () => {
      const connection = await call("arco_connection", {});
      assert.equal(connection.mode, "github");
      assert.equal(connection.connected, true);
      original = await call("arco_get_issue", ref);
      report.originalIssueFingerprint = createHash("sha256")
        .update(
          JSON.stringify(
            Object.fromEntries(
              [
                "title",
                "body",
                "state",
                "stateReason",
                "assignees",
                "labels",
              ].map((key) => [key, original[key]]),
            ),
          ),
        )
        .digest("hex");
      assert.match(original.title, /^\[Arco validation\]/);
      assert.equal(original.state, "closed");
      let cursor;
      let project;
      do {
        const page = await call("arco_projects", {
          repo: ref.repo,
          owner: values.owner,
          ownerType: values["owner-type"],
          ...(cursor ? { cursor } : {}),
        });
        project = page.projects.find((value) => value.id === projectId);
        const next = page.hasMore ? page.cursor : null;
        assert(!next || next !== cursor, "Project pagination did not advance");
        cursor = next;
      } while (!project && cursor);
      assert(
        project && !project.closed,
        "Select an existing open Project in the stated owner scope",
      );
      report.projectUrl = project.url;
      const memberships = await call("arco_issue_projects", ref);
      assert.deepEqual(memberships.errors, []);
      existingMembership = memberships.memberships.find(
        (item) => item.projectId === projectId,
      );
      itemId = existingMembership?.itemId;
    },
  );
  await check(
    "add dedicated issue to the existing Project and read exact item identity",
    async () => {
      if (!existingMembership) {
        attemptedAdd = true;
        await call("arco_project_membership", {
          ...ref,
          projectId,
          action: "add",
          requestId: requestId("add-item"),
        });
      }
      const memberships = await call("arco_issue_projects", ref);
      assert.deepEqual(memberships.errors, []);
      itemId = memberships.memberships.find(
        (item) => item.projectId === projectId,
      )?.itemId;
      assert(itemId, "The dedicated issue's new Project item was not found");
      report.itemId = itemId;
      baselineFields = await readFields();
    },
  );
  for (const type of ["text", "number", "date", "single_select", "iteration"]) {
    const field = baselineFields.find(
      (field) =>
        field.supported &&
        (!values["field-prefix"] ||
          field.name.startsWith(values["field-prefix"])) &&
        field.type === type &&
        (type !== "single_select" || field.options.length) &&
        (type !== "iteration" || field.iterations.length),
    );
    if (!field) {
      report.unavailableTypes.push(type);
      await persist();
      assert.equal(
        values["require-all-types"],
        false,
        `The selected Project lacks the approved ${type} field.`,
      );
      continue;
    }
    const value =
      type === "text"
        ? `Arco validation ${runId.slice(0, 8)}`
        : type === "number"
          ? 123.5
          : type === "date"
            ? new Date().toISOString().slice(0, 10)
            : type === "single_select"
              ? field.options[0].id
              : field.iterations[0].id;
    modified.add(field.id);
    await check(
      `existing ${type} field set, read, clear, and restore`,
      async () => {
        await setField(field, value, `set-${field.id}`);
        await setField(field, null, `clear-${field.id}`);
        await setField(field, field.value, `restore-${field.id}`);
        assert.equal(
          (await call("arco_get_issue", ref)).state,
          original.state,
          "Project field changes must not synthesize Issue state changes",
        );
      },
    );
  }
} catch (error) {
  failure = error;
  report.error = error.message;
} finally {
  if (itemId && baselineFields.length)
    for (const field of baselineFields.filter((field) =>
      modified.has(field.id),
    ))
      await cleanup(`restore original field ${field.id}`, () =>
        readFields().then((fields) => {
          const current = fields.find((value) => value.id === field.id);
          assert(current, "The source field disappeared during cleanup");
          return JSON.stringify(current.value) === JSON.stringify(field.value)
            ? undefined
            : setField(field, field.value, `cleanup-${field.id}`);
        }),
      );
  if (original)
    await cleanup(
      "retain the dedicated source issue content, state, assignees, and labels",
      async () => {
        const after = await call("arco_get_issue", ref);
        [
          "title",
          "body",
          "state",
          "stateReason",
          "assignees",
          "labels",
        ].forEach((key) => assert.deepEqual(after[key], original[key]));
      },
    );
  const keepItemForUi =
    values["keep-item-for-ui"] &&
    !failure &&
    report.cleanup.every((value) => value.ok);
  if (attemptedAdd && !existingMembership && !keepItemForUi)
    await cleanup(
      "remove only the dedicated validation Project item",
      async () => {
        const current = await call("arco_issue_projects", ref);
        assert.deepEqual(current.errors, []);
        const member = current.memberships.find(
          (item) => item.projectId === projectId,
        );
        if (member) {
          assert(
            itemId && member.itemId === itemId,
            "The validation item's identity was not confirmed or has changed. Do not remove it automatically.",
          );
          await call("arco_project_membership", {
            ...ref,
            projectId,
            itemId,
            action: "remove",
            requestId: requestId("remove-item"),
          });
        }
        const after = await call("arco_issue_projects", ref);
        assert.deepEqual(after.errors, []);
        assert(!after.memberships.some((item) => item.projectId === projectId));
      },
    );
  report.serverStderrBytes = stderrBytes;
  report.itemKeptForUi = keepItemForUi && attemptedAdd && !existingMembership;
  report.finishedAt = new Date().toISOString();
  report.complete = !failure && report.cleanup.every((value) => value.ok);
  await persist();
  await client.close().catch(() => undefined);
  if (failure || !report.complete) process.exitCode = 1;
  console.log(`Evidence: ${reportPath}`);
  if (failure) console.log(`FAILED ${failure.message}`);
}
