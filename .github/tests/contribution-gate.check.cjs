const { test } = require("node:test");
const assert = require("node:assert/strict");
const { approve, gate, command, parseState } = require("../scripts/contribution-gate.cjs");

const repo = { owner: "owner", repo: "project" };
function fixture({ eventName = "issues", login = "new-user", type = "User", role = "none", users = {}, body = "", commenterRole = role } = {}) {
  const calls = [];
  let state = { version: 1, users };
  const item = { number: 42, user: { login, type } };
  const context = { repo, eventName, payload: { issue: item, pull_request: item, comment: { user: { login: "maintainer", type: "User" }, body }, repository: { default_branch: "main" } } };
  const github = { rest: {
    repos: {
      getCollaboratorPermissionLevel: async ({ username }) => ({ data: { permission: username === "maintainer" ? commenterRole : role } }),
      getContent: async (params) => { calls.push(["read", params]); return { data: { type: "file", sha: "abc", content: Buffer.from(JSON.stringify(state)).toString("base64") } }; },
      createOrUpdateFileContents: async (params) => { calls.push(["write", params]); state = JSON.parse(Buffer.from(params.content, "base64")); },
    },
    issues: {
      get: async () => ({ data: { state: "open" } }),
      createComment: async (params) => calls.push(["comment", params]),
      update: async (params) => calls.push(["issue-close", params]),
    },
    pulls: { update: async (params) => calls.push(["pr-close", params]) },
  } };
  return { github, context, calls, getState: () => state };
}

test("unapproved issues and PRs are closed, while approved capabilities are scoped", async () => {
  for (const [eventName, users, close] of [["issues", {}, "issue-close"], ["pull_request_target", {}, "pr-close"], ["pull_request_target", { "new-user": "issue" }, "pr-close"], ["issues", { "new-user": "issue" }, null], ["pull_request_target", { "new-user": "pr" }, null]]) {
    const f = fixture({ eventName, users });
    await gate(f.github, f.context);
    assert.equal(f.calls.some(([name]) => name === (close || "issue-close") || (!close && name === "pr-close")), Boolean(close));
    if (close) assert.equal(f.calls.find(([name]) => name === close)[1].state, "closed");
  }
});

test("Dependabot and repository writers bypass the gate", async () => {
  for (const options of [{ eventName: "pull_request_target", login: "dependabot[bot]", type: "Bot" }, { role: "admin" }]) {
    const f = fixture(options);
    await gate(f.github, f.context);
    assert.deepEqual(f.calls, []);
  }
});

test("only authorized human issue comments can grant capability without touching main", async () => {
  const f = fixture({ body: "@New-User lgtm", commenterRole: "admin" });
  await approve(f.github, f.context);
  assert.equal(f.getState().users["new-user"], "pr");
  assert.equal(f.calls.find(([name]) => name === "write")[1].branch, "arco-contributor-approvals");
  const denied = fixture({ body: "lgtm", commenterRole: "read" });
  await approve(denied.github, denied.context);
  assert.deepEqual(denied.calls, []);
  const onPr = fixture({ body: "lgtm", commenterRole: "admin" });
  onPr.context.payload.issue.pull_request = {};
  await approve(onPr.github, onPr.context);
  assert.deepEqual(onPr.calls, []);
});

test("approval commands are bounded and issue approval cannot downgrade PR approval", async () => {
  assert.equal(command("I disagree with lgtm in the middle here", "a"), null);
  assert.deepEqual(command("lgtmi", "Alice"), { capability: "issue", targets: ["alice"] });
  const f = fixture({ body: "lgtmi", commenterRole: "admin", users: { "new-user": "pr" } });
  await approve(f.github, f.context);
  assert.equal(f.calls.some(([name]) => name === "write"), false);
  assert.throws(() => parseState('{"version":1,"users":{"evil":"admin"}}'));
});

test("permission lookup errors do not close issues", async () => {
  const f = fixture();
  f.github.rest.repos.getCollaboratorPermissionLevel = async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); };
  await assert.rejects(gate(f.github, f.context));
  assert.deepEqual(f.calls, []);
});

test("approval write retries a conflict against the latest state", async () => {
  const f = fixture({ body: "lgtm", commenterRole: "admin" });
  const original = f.github.rest.repos.createOrUpdateFileContents;
  let attempts = 0;
  f.github.rest.repos.createOrUpdateFileContents = async (params) => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error("conflict"), { status: 409 });
    return original(params);
  };
  await approve(f.github, f.context);
  assert.equal(attempts, 2);
  assert.equal(f.getState().users["new-user"], "pr");
  assert.equal(f.calls.filter(([name]) => name === "comment").length, 1);
});

test("missing or malformed approval state fails without closing a contribution", async () => {
  const f = fixture();
  f.github.rest.repos.getContent = async () => { throw Object.assign(new Error("missing"), { status: 404 }); };
  await assert.rejects(gate(f.github, f.context));
  assert.deepEqual(f.calls, []);
});
