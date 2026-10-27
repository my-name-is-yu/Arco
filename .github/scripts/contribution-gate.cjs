const STATE_BRANCH = "arco-contributor-approvals";
const STATE_FILE = "contributor-approvals.json";
const TRUSTED_BOTS = new Set(["dependabot[bot]"]);
const WRITERS = new Set(["admin", "maintain", "write"]);
const USERNAME = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const START_COMMAND = /^[\s.]*(?:@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\s*,\s*|[.:]\s*|\s+))*(lgtmi|lgtm)(?=$|\s|[^\p{L}\p{N}_\s])/iu;
const END_COMMAND = /(?:^|[\s.])(lgtmi|lgtm)\s*(?:[^\p{L}\p{N}_\s])?\s*$/iu;
const MENTIONS = /(^|[^A-Za-z0-9_])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)(?![A-Za-z0-9-]|\/)/g;

function command(body, issueAuthor) {
  const text = (body || "").trim();
  const match = text.match(START_COMMAND) ?? text.match(END_COMMAND);
  if (!match) return null;
  const targets = [...text.matchAll(MENTIONS)].map((item) => item[2].toLowerCase());
  if (targets.length === 0) targets.push(issueAuthor.toLowerCase());
  if (targets.some((target) => !USERNAME.test(target))) return null;
  return { capability: match[1].toLowerCase() === "lgtmi" ? "issue" : "pr", targets: [...new Set(targets)] };
}

function parseState(content) {
  const data = JSON.parse(content);
  if (!data || Array.isArray(data) || typeof data !== "object" || data.version !== 1 || !data.users || Array.isArray(data.users) || typeof data.users !== "object") {
    throw new Error("Invalid contributor approval state");
  }
  const users = Object.create(null);
  for (const [login, capability] of Object.entries(data.users)) {
    if (!USERNAME.test(login) || (capability !== "issue" && capability !== "pr")) throw new Error("Invalid contributor approval entry");
    users[login.toLowerCase()] = capability;
  }
  return users;
}

async function permission(github, repo, login) {
  try {
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({ ...repo, username: login });
    return data.permission;
  } catch (error) {
    if (error.status === 404) return "none";
    throw error;
  }
}

async function readState(github, repo) {
  const { data } = await github.rest.repos.getContent({ ...repo, path: STATE_FILE, ref: STATE_BRANCH });
  if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string" || !data.sha) {
    throw new Error("Cannot read contributor approval state");
  }
  return { sha: data.sha, users: parseState(Buffer.from(data.content, "base64").toString("utf8")) };
}

async function approve(github, context) {
  const issue = context.payload.issue;
  const comment = context.payload.comment;
  if (issue.pull_request || comment.user.type !== "User") return;
  const request = command(comment.body, issue.user.login);
  if (!request || !WRITERS.has(await permission(github, context.repo, comment.user.login))) return;
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await readState(github, context.repo);
    const changed = request.targets.filter((target) => state.users[target] !== "pr" && state.users[target] !== request.capability);
    if (changed.length === 0) return;
    for (const target of changed) state.users[target] = request.capability;
    const content = `${JSON.stringify({ version: 1, users: state.users }, null, 2)}\n`;
    try {
      await github.rest.repos.createOrUpdateFileContents({
        ...context.repo, path: STATE_FILE, branch: STATE_BRANCH, sha: state.sha,
        message: `Approve contributors from issue #${issue.number}`,
        content: Buffer.from(content).toString("base64"),
      });
    } catch (error) {
      if ((error.status === 409 || error.status === 422) && attempt < 3) continue;
      throw error;
    }
    await github.rest.issues.createComment({
      ...context.repo, issue_number: issue.number,
      body: `${changed.map((login) => `@${login}`).join(", ")} approved for ${request.capability === "pr" ? "future issues and PRs" : "future issues"}. See [CONTRIBUTING.md](https://github.com/${context.repo.owner}/${context.repo.repo}/blob/${context.payload.repository.default_branch}/CONTRIBUTING.md).`,
    });
    return;
  }
}

async function gate(github, context) {
  const isPr = context.eventName === "pull_request_target";
  const item = isPr ? context.payload.pull_request : context.payload.issue;
  const author = item.user;
  if (author.type === "Bot" && TRUSTED_BOTS.has(author.login)) return;
  if (author.type === "User" && WRITERS.has(await permission(github, context.repo, author.login))) return;
  const { users } = await readState(github, context.repo);
  const capability = author.type === "User" ? users[author.login.toLowerCase()] : undefined;
  if (capability === "pr" || (!isPr && capability === "issue")) return;
  const latest = await github.rest.issues.get({ ...context.repo, issue_number: item.number });
  if (latest.data.state !== "open") return;
  const guide = `https://github.com/${context.repo.owner}/${context.repo.repo}/blob/${context.payload.repository.default_branch}/CONTRIBUTING.md`;
  const body = isPr
    ? `This PR was automatically closed because the author is not approved for PRs. Open an issue first; a maintainer can approve future PRs with \`lgtm\`. See [CONTRIBUTING.md](${guide}).`
    : `This issue was automatically closed because the author is not yet approved. A maintainer may review and reopen it. A maintainer can use \`lgtmi\` to approve future issues or \`lgtm\` to approve future issues and PRs. See [CONTRIBUTING.md](${guide}).`;
  await github.rest.issues.createComment({ ...context.repo, issue_number: item.number, body });
  if (isPr) {
    await github.rest.pulls.update({ ...context.repo, pull_number: item.number, state: "closed" });
  } else {
    await github.rest.issues.update({ ...context.repo, issue_number: item.number, state: "closed", state_reason: "not_planned" });
  }
}

module.exports = { approve, gate, command, parseState, readState };
