import { execFile, type ExecFileException } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

// The real validation scripts use the real MCP client against this local child.
// The fixture only owns fictional records in its temporary working directory.
const fixture = `
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
const scenario = process.env.ARCO_VALIDATION_SCENARIO;
const advanced = scenario.startsWith('advanced');
const calls = [];
const comments = advanced ? Array.from({ length: 30 }, (_, index) => ({
  id: 'old-' + index, databaseId: index + 1, body: 'Existing comment ' + index,
  updatedAt: '2026-10-01T00:00:00Z', author: 'fixture',
})) : [];
const definitions = [{ id: 'existing-label', name: 'existing' }];
let labels = advanced ? [...definitions] : [];
let reactions = [];
const posted = new Map();
const issue = {
  repo: 'fixture/repo', number: 1, url: 'https://github.com/fixture/repo/issues/1',
  title: '[Arco validation] Fictional issue', body: 'Fictional body',
  updatedAt: '2026-10-01T00:00:00Z', state: 'closed', assignees: [],
};
const detail = () => ({ ...issue, labels, comments: comments.slice(0, 30),
  commentsHasMore: comments.length >= 30,
  ...(comments.length >= 30 ? { commentsNextPage: 2 } : {}),
});
const persist = () => writeFileSync('fixture-state.json', JSON.stringify({ comments, calls }));
function tool(name, args) {
  if (name === 'arco_connection') return { mode: 'github', connected: true, account: 'fixture' };
  if (name === 'arco_get_issue') return detail();
  if (name === 'arco_comments') {
    const start = (args.page - 1) * 30;
    const page = comments.slice(start, start + 30);
    return { comments: page, hasMore: page.length === 30,
      ...(page.length === 30 ? { nextPage: args.page + 1 } : {}),
    };
  }
  if (name === 'arco_create_label') definitions.push({ id: args.name, name: args.name });
  else if (name === 'arco_update_label') Object.assign(definitions.find(value => value.name === args.name), args.patch);
  else if (name === 'arco_label_definitions') return { labels: definitions };
  else if (name === 'arco_delete_label') definitions.splice(definitions.findIndex(value => value.name === args.name), 1);
  else if (name === 'arco_change_labels') {
    labels = labels.filter(value => !(args.remove ?? []).includes(value.name));
    for (const name of args.add ?? []) labels.push(definitions.find(value => value.name === name) ?? { id: name, name });
  } else if (name === 'arco_comment') {
    if (posted.has(args.requestId) && scenario === 'advanced-duplicate-failure')
      throw new Error('fixture duplicate verification failed');
    if (!posted.has(args.requestId)) {
      const comment = { id: 'new-comment', databaseId: 31, body: args.body,
        updatedAt: '2026-10-25T00:00:00Z', author: 'fixture' };
      comments.push(comment);
      posted.set(args.requestId, comment);
    }
    return { ...detail(), postedComment: posted.get(args.requestId) };
  } else if (name === 'arco_edit_comment') {
    const comment = comments.find(value => value.databaseId === args.commentId);
    Object.assign(comment, { body: args.body, updatedAt: '2026-10-25T00:00:01Z' });
    return { ...detail(), changedComment: comment };
  } else if (name === 'arco_delete_comment') {
    comments.splice(comments.findIndex(value => value.databaseId === args.commentId), 1);
  } else if (name === 'arco_add_reaction') reactions.push({ id: 900, author: 'fixture', content: args.content });
  else if (name === 'arco_remove_reaction') reactions = reactions.filter(value => value.id !== args.reactionId);
  else if (name === 'arco_reactions') {
    if (!args.commentId) throw new Error('fixture stops after comment checks');
    return { reactions };
  } else if (name === 'arco_create_issue') Object.assign(issue, args, { state: 'open' });
  else if (name === 'arco_update_issue') {
    if (args.patch.stateReason === 'not_planned' && scenario.includes('cleanup-failure'))
      throw new Error('fixture cleanup failed');
    if (args.patch.body && scenario.includes('primary'))
      throw new Error('fixture primary operation failed');
    Object.assign(issue, args.patch);
  } else if (name === 'arco_repo_metadata') return {
    labels: [{ name: 'bug' }, { name: 'documentation' }], assignees: [],
  };
  else if (name === 'search_mentions') return { items: [{ resourceUri: 'issue://github/fixture/repo/1' }] };
  else throw new Error('Unexpected fixture tool: ' + name);
  return detail();
}
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
}
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') return reply(message.id, {
    protocolVersion: message.params.protocolVersion, capabilities: { tools: {}, resources: {} },
    serverInfo: { name: 'local-validation-fixture', version: '1' },
  });
  if (message.method === 'tools/list') return reply(message.id, {
    tools: ['arco_create_label', 'arco_edit_comment', 'arco_reactions', 'arco_create_sub_issue', 'arco_bulk_update']
      .map(name => ({ name, inputSchema: { type: 'object' } })),
  });
  if (message.method === 'resources/read') return reply(message.id, {
    contents: [{ uri: message.params.uri, text: issue.body }],
  });
  const { name, arguments: args } = message.params;
  calls.push({ name, args });
  let result;
  try {
    const value = tool(name, args);
    result = { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
  } catch (error) {
    result = { isError: true, content: [{ type: 'text', text: error.message }] };
  }
  persist();
  reply(message.id, result);
});
`;

async function run(script: string, scenario: string) {
  const directory = await mkdtemp(join(tmpdir(), "arco-validation-script-"));
  directories.push(directory);
  await mkdir(join(directory, "dist/plugin"), { recursive: true });
  const server = join(directory, "dist/plugin/server.mjs");
  await writeFile(server, fixture);
  // Record the real close call, then delegate to the SDK's actual implementation.
  const runner = join(directory, "runner.mjs");
  const clientModule = new URL(
    "../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js",
    import.meta.url,
  ).href;
  const target = new URL(`../scripts/${script}`, import.meta.url).href;
  await writeFile(
    runner,
    `
    import { Client } from ${JSON.stringify(clientModule)};
    import { appendFileSync } from 'node:fs';
    const close = Client.prototype.close;
    Client.prototype.close = async function () {
      appendFileSync('client-events', 'close\\n');
      await close.call(this);
      if (process.env.ARCO_VALIDATION_SCENARIO.includes('close-failure'))
        throw new Error('fixture close failed');
    };
    try { await import(${JSON.stringify(target)}); }
    catch (error) { console.error(error); process.exitCode = 1; }
    process.exit(process.exitCode ?? 0);
  `,
  );
  const args =
    script === "validate-live.mjs"
      ? ["--repo", "fixture/repo", "--write"]
      : ["--repo", "fixture/repo", "--issue", "1", "--server", server];
  const result = await new Promise<{
    error: ExecFileException | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    execFile(
      process.execPath,
      [runner, ...args],
      {
        cwd: directory,
        timeout: 5000,
        env: { ...process.env, ARCO_VALIDATION_SCENARIO: scenario },
      },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }),
    );
  });
  const state = JSON.parse(
    await readFile(join(directory, "fixture-state.json"), "utf8"),
  ) as {
    comments: { databaseId: number; body: string }[];
    calls: { name: string; args: { page?: number; commentId?: number } }[];
  };
  const closed = await readFile(join(directory, "client-events"), "utf8").catch(
    () => "",
  );
  return { ...result, directory, state, closed };
}

async function report(directory: string) {
  const root = join(directory, "dist/dev");
  const [file] = await readdir(root);
  return JSON.parse(await readFile(join(root, file), "utf8")) as {
    error: string;
    artifacts: { commentId: number | null };
    checks: { name: string; ok: boolean }[];
    cleanup: { name: string; ok: boolean }[];
  };
}

describe("live validation scripts against local MCP fixtures", () => {
  it("checks creation, edits, and deletion beyond the first 30 comments", async () => {
    const result = await run(
      "validate-github-operations.mjs",
      "advanced-comments",
    );
    const evidence = await report(result.directory);
    expect(
      evidence.checks.find((value) => value.name.startsWith("own comment"))?.ok,
    ).toBe(true);
    expect(evidence.artifacts.commentId).toBe(31);
    expect(evidence.error).toContain("fixture stops after comment checks");
    expect(result.state.comments).toHaveLength(30);
    expect(
      result.state.calls.filter(
        (value) => value.name === "arco_comments" && value.args.page === 2,
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      result.state.calls
        .filter((value) => value.name === "arco_delete_comment")
        .map((value) => value.args.commentId),
    ).toEqual([31]);
    expect(result.closed).toBe("close\n");
  });

  it("records the posted comment before a failed duplicate check and pages during cleanup", async () => {
    const result = await run(
      "validate-github-operations.mjs",
      "advanced-duplicate-failure",
    );
    const evidence = await report(result.directory);
    expect(evidence.error).toContain("fixture duplicate verification failed");
    expect(evidence.artifacts.commentId).toBe(31);
    expect(
      evidence.cleanup.find((value) =>
        value.name.startsWith("remove own temporary comment"),
      )?.ok,
    ).toBe(true);
    expect(result.state.comments).toHaveLength(30);
    expect(
      result.state.calls
        .filter((value) => value.name === "arco_delete_comment")
        .map((value) => value.args.commentId),
    ).toEqual([31]);
    expect(
      result.state.calls.some(
        (value) => value.name === "arco_comments" && value.args.page === 2,
      ),
    ).toBe(true);
  });

  it("retains the primary failure and cleanup failure while closing the real client", async () => {
    const result = await run(
      "validate-live.mjs",
      "live-primary-and-cleanup-failure",
    );
    expect(result.error?.code).toBe(1);
    expect(result.stderr).toContain("fixture primary operation failed");
    expect(result.stderr).toContain("fixture cleanup failed");
    expect(result.closed).toBe("close\n");
  });

  it("reports cleanup failure after successful validation and still closes the client", async () => {
    const result = await run("validate-live.mjs", "live-cleanup-failure");
    expect(result.stdout).toContain('"checks"');
    expect(result.error?.code).toBe(1);
    expect(result.stderr).toContain("fixture cleanup failed");
    expect(result.closed).toBe("close\n");
  });

  it("retains the primary failure when closing the client also rejects", async () => {
    const result = await run(
      "validate-live.mjs",
      "live-primary-and-close-failure",
    );
    expect(result.error?.code).toBe(1);
    expect(result.stderr).toContain("fixture primary operation failed");
    expect(result.stderr).toContain("fixture close failed");
    expect(result.closed).toBe("close\n");
  });

  it("preserves successful validation and cleanup", async () => {
    const result = await run("validate-live.mjs", "live-success");
    expect(result.error).toBeNull();
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Validation Issue left closed:");
    expect(result.closed).toBe("close\n");
  });
});
