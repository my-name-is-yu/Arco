import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

// This opt-in test setup is excluded from the product. Default execution is read-only.
const { values } = parseArgs({
  options: {
    execute: { type: "boolean", default: false },
    "keep-open-for-ui": { type: "boolean", default: false },
    owner: { type: "string", default: "my-name-is-yu" },
    repo: { type: "string", default: "my-name-is-yu/Arco" },
    issue: { type: "string", default: "1" },
    server: { type: "string", default: "dist/plugin/server.mjs" },
  },
});
assert.equal(
  values.owner,
  "my-name-is-yu",
  "This setup is scoped to the approved personal owner.",
);
assert.equal(values.repo, "my-name-is-yu/Arco");
assert(
  ["1", "2"].includes(values.issue),
  "Use only a dedicated validation Issue.",
);
const runId = randomUUID();
const title = "Arco validation";
const prefix = "Arco validation";
const startDate = new Date().toISOString().slice(0, 10);
const fieldDefinitions = [
  { name: `${prefix} text`, dataType: "TEXT" },
  { name: `${prefix} number`, dataType: "NUMBER" },
  { name: `${prefix} date`, dataType: "DATE" },
  {
    name: `${prefix} select`,
    dataType: "SINGLE_SELECT",
    singleSelectOptions: [
      {
        name: "Validation ready",
        color: "BLUE",
        description: "Test-only existing selection",
      },
      {
        name: "Validation done",
        color: "GREEN",
        description: "Test-only existing selection",
      },
    ],
  },
  {
    name: `${prefix} iteration`,
    dataType: "ITERATION",
    iterationConfiguration: {
      startDate,
      duration: 7,
      iterations: [{ title: "Validation iteration", startDate, duration: 7 }],
    },
  },
];
function graphql(query, variables = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "gh",
      ["api", "graphql", "--input", "-"],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 2_000_000, shell: false },
      (error, stdout) => {
        if (error)
          return reject(
            new Error(
              "GitHub did not confirm this GraphQL operation. No automatic retry was attempted.",
            ),
          );
        try {
          const response = JSON.parse(stdout);
          if (response.errors || !response.data)
            throw new Error(
              "GitHub returned GraphQL errors. Check the saved setup receipt before repeating a mutation.",
            );
          resolve(response.data);
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
    child.stdin.end(JSON.stringify({ query, variables }));
  });
}
const viewerData = await graphql(
  'query ArcoSetupViewer { viewer { id login projectsV2(first:100) { nodes { id title url public closed } pageInfo { hasNextPage endCursor } } } types:__type(name:"ProjectV2CustomFieldType") { enumValues { name } } iteration:__type(name:"ProjectV2IterationFieldConfigurationInput") { inputFields { name } } }',
);
assert.equal(viewerData.viewer.login, values.owner);
assert.equal(
  viewerData.viewer.projectsV2.pageInfo.hasNextPage,
  false,
  "Inspect all existing personal Projects before creating a validation Project.",
);
for (const type of fieldDefinitions.map((field) => field.dataType))
  assert(
    viewerData.types.enumValues.some((value) => value.name === type),
    `The current API does not support ${type}.`,
  );
for (const field of ["startDate", "duration", "iterations"])
  assert(
    viewerData.iteration.inputFields.some((value) => value.name === field),
  );
const existing = viewerData.viewer.projectsV2.nodes.filter(
  (project) => project.title === title,
);
const plan = {
  mode: values.execute ? "execute-authorized-test-setup" : "read-only-dry-run",
  owner: values.owner,
  project: {
    title,
    privacy:
      "Verify create response, explicitly set public:false, then re-read before adding any Issue or field.",
  },
  issue: `${values.repo}#${values.issue}`,
  fieldDefinitions,
  operations: [
    "createProjectV2 (empty personal Project)",
    "updateProjectV2 public:false and verify",
    "createProjectV2Field for the five test-only definitions",
    "run product MCP membership and typed set/read/clear/restore validation",
    values["keep-open-for-ui"]
      ? "keep only the dedicated Issue item temporarily for native UI validation; restore tested values first"
      : "remove only the created dedicated Issue item",
    values["keep-open-for-ui"]
      ? "after native UI confirmation run cleanup-github-project-validation.mjs --receipt <setup receipt>; remove owned item and close private Project"
      : "updateProjectV2 closed:true; preserve private test Project for inspection",
  ],
  unrelatedOrganizationWrites: false,
  retries:
    "No mutation is automatically retried. A saved Project receipt is retained after failures.",
  existingSameNameProjects: existing,
  sources: [
    "https://docs.github.com/en/graphql/reference/projects",
    "https://docs.github.com/en/issues/planning-and-tracking-with-projects/managing-your-project/managing-visibility-of-your-projects",
  ],
};
console.log(JSON.stringify(plan, null, 2));
if (!values.execute) process.exit(0);
assert.equal(
  existing.length,
  0,
  "A validation Project already exists. Reuse its source ID after reviewing the saved receipt; do not create a duplicate.",
);

const reportPath = resolve(`dist/dev/github-project-setup-${runId}.json`);
const report = {
  runId,
  startedAt: new Date().toISOString(),
  plan,
  fields: [],
  cleanup: [],
  complete: false,
};
let project;
let failure;
async function persist() {
  await mkdir(resolve("dist/dev"), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
async function projectState() {
  const data = await graphql(
    "query ArcoSetupProject($id:ID!){node(id:$id){...on ProjectV2{id title number url public closed owner{...on User{login}} items(first:100){totalCount nodes{id} pageInfo{hasNextPage}}}}}",
    { id: project.id },
  );
  assert(
    data.node &&
      data.node.id === project.id &&
      data.node.owner.login === values.owner,
  );
  assert.equal(data.node.items.pageInfo.hasNextPage, false);
  return data.node;
}
async function issueMemberships() {
  const [owner, name] = values.repo.split("/");
  const data = await graphql(
    "query ArcoSetupMembership($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){projectItems(first:100){nodes{id project{id}} pageInfo{hasNextPage}}}}}",
    { owner, name, number: Number(values.issue) },
  );
  const items = data.repository?.issue?.projectItems;
  assert(items, "The dedicated Issue membership could not be read.");
  assert.equal(items.pageInfo.hasNextPage, false);
  return items.nodes.filter((item) => item.project.id === project.id);
}
try {
  await persist();
  const created = await graphql(
    "mutation ArcoTestSetupCreate($input:CreateProjectV2Input!){createProjectV2(input:$input){projectV2{id number title url public closed owner{...on User{login}}}}}",
    {
      input: { ownerId: viewerData.viewer.id, title, clientMutationId: runId },
    },
  );
  project = created.createProjectV2.projectV2;
  assert(project?.id && project.owner.login === values.owner);
  report.project = project;
  await persist();
  // Never assume privacy from the absent create input. No source content is added before this check.
  await graphql(
    "mutation ArcoTestSetupPrivate($input:UpdateProjectV2Input!){updateProjectV2(input:$input){projectV2{id public}}}",
    { input: { projectId: project.id, public: false } },
  );
  const privateProject = await projectState();
  assert.equal(privateProject.public, false);
  assert.equal(privateProject.items.totalCount, 0);
  assert.deepEqual(privateProject.items.nodes, []);
  report.privateVerifiedBeforeContent = true;
  await persist();
  for (const definition of fieldDefinitions) {
    const created = await graphql(
      "mutation ArcoTestSetupField($input:CreateProjectV2FieldInput!){createProjectV2Field(input:$input){projectV2Field{...on ProjectV2FieldCommon{id name dataType} ...on ProjectV2SingleSelectField{options{id name}} ...on ProjectV2IterationField{configuration{iterations{id title startDate duration}}}}}}",
      { input: { projectId: project.id, ...definition } },
    );
    const field = created.createProjectV2Field.projectV2Field;
    assert(
      field?.id &&
        field.name === definition.name &&
        field.dataType === definition.dataType,
    );
    if (definition.dataType === "ITERATION")
      assert(field.configuration.iterations.length > 0);
    report.fields.push(field);
    await persist();
  }
  assert.equal((await projectState()).public, false);
  report.validationReceipt = resolve(
    `dist/dev/github-project-validation-${runId}.json`,
  );
  await persist();
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolvePath("scripts/validate-github-project.mjs"),
        "--repo",
        values.repo,
        "--issue",
        values.issue,
        "--owner",
        values.owner,
        "--project-id",
        project.id,
        "--field-prefix",
        prefix,
        "--require-all-types",
        "--report-path",
        report.validationReceipt,
        ...(values["keep-open-for-ui"] ? ["--keep-item-for-ui"] : []),
        "--server",
        values.server,
      ],
      { stdio: "inherit", shell: false },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  assert.equal(
    code,
    0,
    "The product Project validation failed. Review its evidence before retrying any change.",
  );
  const validation = JSON.parse(
    await readFile(report.validationReceipt, "utf8"),
  );
  assert.equal(validation.projectId, project.id);
  assert.deepEqual(validation.issue, {
    repo: values.repo,
    number: Number(values.issue),
  });
  assert.equal(validation.complete, true);
  report.createdItemId = validation.itemId;
  report.productValidationPassed = true;
} catch (error) {
  failure = error;
  report.error = error.message;
} finally {
  if (
    project &&
    values["keep-open-for-ui"] &&
    !failure &&
    report.productValidationPassed
  ) {
    try {
      const after = await projectState();
      assert.equal(after.closed, false);
      assert.equal(after.public, false);
      const memberships = await issueMemberships();
      assert.deepEqual(
        memberships.map((item) => item.id),
        [report.createdItemId],
        "The exact owned validation item must exist before UI handoff.",
      );
      assert(
        after.items.totalCount <= 1 &&
          after.items.nodes.every((item) => item.id === report.createdItemId),
        "Unexpected Project items exist. Stop before changing Project state.",
      );
      report.projectItemReadback = {
        ownedItemId: report.createdItemId,
        aggregateCount: after.items.totalCount,
        aggregateItemIds: after.items.nodes.map((item) => item.id),
        aggregateCountMatchesMembership: after.items.totalCount === 1,
      };
      report.readyForUi = true;
      report.cleanupPendingUi = true;
    } catch (error) {
      failure = error;
      report.error = error.message;
    }
  }
  if (project && !report.readyForUi) {
    try {
      const before = await projectState();
      report.remainingItems = before.items.totalCount;
      assert.equal(before.public, false);
      assert.deepEqual(
        await issueMemberships(),
        [],
        "The dedicated validation item remains. Leave the private Project open for explicit recovery.",
      );
      assert.equal(before.items.totalCount, 0);
      assert.deepEqual(
        before.items.nodes,
        [],
        "Unknown Project items remain. Stop before closing the Project.",
      );
      await graphql(
        "mutation ArcoTestSetupClose($input:UpdateProjectV2Input!){updateProjectV2(input:$input){projectV2{id closed public}}}",
        { input: { projectId: project.id, closed: true, public: false } },
      );
      const after = await projectState();
      assert.equal(after.closed, true);
      assert.equal(after.public, false);
      assert.equal(
        after.items.totalCount,
        0,
        "Dedicated validation item cleanup did not complete.",
      );
      report.cleanup.push({
        name: "private validation Project closed with no remaining items",
        ok: true,
      });
    } catch (error) {
      report.cleanup.push({
        name: "close private validation Project",
        ok: false,
        error: error.message,
      });
    }
  }
  report.finishedAt = new Date().toISOString();
  report.complete =
    !failure &&
    !report.cleanupPendingUi &&
    report.productValidationPassed === true &&
    report.cleanup.every((item) => item.ok);
  await persist();
  console.log(`Setup evidence: ${reportPath}`);
  if (!report.complete && !report.readyForUi) process.exitCode = 1;
}
function resolvePath(path) {
  return resolve(path);
}
