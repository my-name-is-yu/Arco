import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

// This opt-in script writes only to the dedicated validation Issue and artifacts
// it creates. It is excluded from the plugin and never runs during normal CI.
const { values } = parseArgs({
  options: {
    repo: { type: "string", default: "my-name-is-yu/Arco" },
    issue: { type: "string", default: "1" },
    server: { type: "string", default: "dist/plugin/server.mjs" },
  },
});
assert(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values.repo) &&
    values.repo.split("/").every((part) => part !== "." && part !== ".."),
);
const ref = { repo: values.repo, number: Number(values.issue) };
assert(Number.isSafeInteger(ref.number) && ref.number > 0);
const runId = randomUUID();
const prefix = `arco-live-${runId.slice(0, 8)}`;
const reportPath = resolve(`dist/dev/github-live-validation-${runId}.json`);
const report = {
  runId,
  repo: ref.repo,
  baseIssue: ref.number,
  startedAt: new Date().toISOString(),
  checks: [],
  cleanup: [],
  artifacts: {
    originalLabel: prefix,
    renamedLabel: `${prefix}-renamed`,
    child: null,
    commentId: null,
    issueReaction: null,
    commentReaction: null,
  },
  complete: false,
};
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(values.server)],
  env: { ...process.env },
  stderr: "pipe",
});
let stderrBytes = 0;
transport.stderr?.on("data", (chunk) => {
  stderrBytes += chunk.length;
});
const client = new Client({
  name: "Arco explicit live validation",
  version: "1",
});
client.setNotificationHandler(
  ResourceUpdatedNotificationSchema,
  () => undefined,
);
const requestIds = new Map();
let originalIssue;
let operationError;

async function persist() {
  await mkdir(resolve("dist/dev"), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}
function id(label) {
  let value = requestIds.get(label);
  if (!value) {
    value = `${runId}-${label}`.slice(0, 100);
    requestIds.set(label, value);
  }
  return value;
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
  } catch (error) {
    report.cleanup.push({ name, ok: false, error: error.message });
  } finally {
    await persist();
  }
}

try {
  await client.connect(transport);
  const connection = await call("arco_connection", {});
  assert.equal(connection.mode, "github");
  assert.equal(connection.connected, true);
  const tools = await client.listTools();
  [
    "arco_create_label",
    "arco_edit_comment",
    "arco_reactions",
    "arco_create_sub_issue",
    "arco_bulk_update",
  ].forEach((name) =>
    assert(
      tools.tools.some((tool) => tool.name === name),
      `Build missing ${name}`,
    ),
  );
  originalIssue = await call("arco_get_issue", ref);
  assert(
    originalIssue.title.startsWith("[Arco validation]"),
    "Only the dedicated validation Issue may be used",
  );
  assert.equal(
    originalIssue.state,
    "closed",
    "Expected dedicated Issue to remain closed",
  );
  report.originalState = {
    state: originalIssue.state,
    labels: originalIssue.labels.map((label) => label.name),
  };
  await persist();

  await check(
    "label definition create / rename / apply preserves unrelated labels",
    async () => {
      await call("arco_create_label", {
        repo: ref.repo,
        requestId: id("label-create"),
        name: prefix,
        color: "aabbcc",
        description: "Temporary Arco integration validation",
      });
      await call("arco_update_label", {
        repo: ref.repo,
        requestId: id("label-rename"),
        name: prefix,
        patch: { name: `${prefix}-renamed`, color: "112233" },
      });
      await call("arco_change_labels", {
        ...ref,
        requestId: id("label-apply"),
        add: [`${prefix}-renamed`],
        remove: [],
      });
      const issue = await call("arco_get_issue", ref);
      assert(issue.labels.some((label) => label.name === `${prefix}-renamed`));
      originalIssue.labels.forEach((label) =>
        assert(issue.labels.some((candidate) => candidate.id === label.id)),
      );
    },
  );

  await check("own comment create / edit / reaction / delete", async () => {
    const body = `Arco advanced validation ${runId}`;
    const input = { ...ref, requestId: id("comment-create"), body };
    await call("arco_comment", input);
    await call("arco_comment", input);
    const issue = await call("arco_get_issue", ref);
    const comments = issue.comments.filter((comment) => comment.body === body);
    assert.equal(comments.length, 1, "Concurrent/duplicate comment guard");
    assert(Number.isSafeInteger(comments[0].databaseId));
    report.artifacts.commentId = comments[0].databaseId;
    await persist();
    await call("arco_edit_comment", {
      ...ref,
      requestId: id("comment-edit"),
      commentId: report.artifacts.commentId,
      expectedUpdatedAt: comments[0].updatedAt,
      body: `${body}\n\nEdited through the packaged MCP tool.`,
    });
    const updated = await call("arco_get_issue", ref);
    assert(
      updated.comments
        .find((comment) => comment.databaseId === report.artifacts.commentId)
        ?.body.includes("Edited through the packaged MCP tool."),
    );
    await call("arco_add_reaction", {
      ...ref,
      requestId: id("comment-reaction-add"),
      commentId: report.artifacts.commentId,
      content: "eyes",
    });
    const reactions = await call("arco_reactions", {
      ...ref,
      commentId: report.artifacts.commentId,
    });
    const reaction = reactions.reactions.find(
      (item) => item.author === connection.account && item.content === "eyes",
    );
    assert(reaction);
    report.artifacts.commentReaction = reaction.id;
    await persist();
    await call("arco_remove_reaction", {
      ...ref,
      requestId: id("comment-reaction-remove"),
      commentId: report.artifacts.commentId,
      reactionId: reaction.id,
    });
    await call("arco_delete_comment", {
      ...ref,
      requestId: id("comment-delete"),
      commentId: report.artifacts.commentId,
    });
    assert(
      !(await call("arco_get_issue", ref)).comments.some(
        (comment) => comment.databaseId === report.artifacts.commentId,
      ),
    );
  });

  await check(
    "Issue reaction add / remove without changing existing reactions",
    async () => {
      const before = await call("arco_reactions", ref);
      const content = [
        "rocket",
        "eyes",
        "hooray",
        "heart",
        "+1",
        "-1",
        "laugh",
        "confused",
      ].find(
        (candidate) =>
          !before.reactions.some(
            (reaction) =>
              reaction.author === connection.account &&
              reaction.content === candidate,
          ),
      );
      assert(
        content,
        "No unused reaction type; do not alter an existing reaction",
      );
      await call("arco_add_reaction", {
        ...ref,
        requestId: id("issue-reaction-add"),
        content,
      });
      const after = await call("arco_reactions", ref);
      const reaction = after.reactions.find(
        (item) =>
          item.author === connection.account && item.content === content,
      );
      assert(reaction);
      report.artifacts.issueReaction = reaction.id;
      await persist();
      await call("arco_remove_reaction", {
        ...ref,
        requestId: id("issue-reaction-remove"),
        reactionId: reaction.id,
      });
      const final = await call("arco_reactions", ref);
      assert.deepEqual(
        final.reactions.map((item) => item.id).sort(),
        before.reactions.map((item) => item.id).sort(),
      );
    },
  );

  await check("sub-Issue create / parent remove / parent set", async () => {
    const created = await call("arco_create_sub_issue", {
      ...ref,
      requestId: id("child-create"),
      childRepo: ref.repo,
      title: `[Arco validation] Advanced operations ${prefix}`,
      body: `Dedicated disposable Issue for Arco integration validation. Run ${runId}.`,
    });
    assert(created.createdIssue && created.createdIssue.repo === ref.repo);
    report.artifacts.child = {
      repo: created.createdIssue.repo,
      number: created.createdIssue.number,
    };
    await persist();
    const child = report.artifacts.child;
    assert.equal(
      (await call("arco_issue_relations", child)).parent?.number,
      ref.number,
    );
    await call("arco_remove_parent", {
      ...child,
      requestId: id("parent-remove-1"),
      parent: ref,
    });
    assert.equal((await call("arco_issue_relations", child)).parent, null);
    await call("arco_set_parent", {
      ...child,
      requestId: id("parent-set"),
      parent: ref,
      replace: false,
    });
    assert.equal(
      (await call("arco_issue_relations", child)).parent?.number,
      ref.number,
    );
    await call("arco_remove_parent", {
      ...child,
      requestId: id("parent-remove-2"),
      parent: ref,
    });
  });

  await check("dependency add / remove in both directions", async () => {
    const child = report.artifacts.child;
    assert(child);
    for (const [index, blocked, blocker] of [
      [0, child, ref],
      [1, ref, child],
    ]) {
      await call("arco_add_dependency", {
        ...blocked,
        requestId: id(`dependency-add-${index}`),
        blockedBy: blocker,
      });
      const blockedView = await call("arco_issue_relations", blocked);
      const blockerView = await call("arco_issue_relations", blocker);
      assert(
        blockedView.blockedBy.some(
          (item) =>
            item.repo === blocker.repo && item.number === blocker.number,
        ),
      );
      assert(
        blockerView.blocking.some(
          (item) =>
            item.repo === blocked.repo && item.number === blocked.number,
        ),
      );
      await call("arco_remove_dependency", {
        ...blocked,
        requestId: id(`dependency-remove-${index}`),
        blockedBy: blocker,
      });
      assert(
        !(await call("arco_issue_relations", blocked)).blockedBy.some(
          (item) =>
            item.repo === blocker.repo && item.number === blocker.number,
        ),
      );
    }
  });

  await check(
    "bulk keeps successful close and nonexistent-Issue failure separate",
    async () => {
      const child = report.artifacts.child;
      assert(child);
      const missing = { repo: ref.repo, number: 2147483647 };
      const bulk = await call("arco_bulk_update", {
        issues: [child, missing],
        requestId: id("bulk-close"),
        patch: { state: "closed", stateReason: "completed" },
      });
      assert.equal(bulk.results.length, 2);
      assert.equal(bulk.results[0].number, child.number);
      assert.equal(bulk.results[0].ok, true);
      assert.equal(bulk.results[1].number, missing.number);
      assert.equal(bulk.results[1].ok, false);
      assert.equal((await call("arco_get_issue", child)).state, "closed");
    },
  );
} catch (error) {
  operationError = error;
  report.error = error.message;
  console.error(`FAIL ${error.message}`);
} finally {
  if (originalIssue) {
    if (report.artifacts.commentId)
      await cleanup("remove own temporary comment if present", async () => {
        const current = await call("arco_get_issue", ref);
        if (
          current.comments.some(
            (comment) => comment.databaseId === report.artifacts.commentId,
          )
        )
          await call("arco_delete_comment", {
            ...ref,
            requestId: id("cleanup-comment"),
            commentId: report.artifacts.commentId,
          });
      });
    if (report.artifacts.issueReaction)
      await cleanup(
        "remove own temporary Issue reaction if present",
        async () => {
          const current = await call("arco_reactions", ref);
          if (
            current.reactions.some(
              (reaction) => reaction.id === report.artifacts.issueReaction,
            )
          )
            await call("arco_remove_reaction", {
              ...ref,
              requestId: id("cleanup-reaction"),
              reactionId: report.artifacts.issueReaction,
            });
        },
      );
    if (report.artifacts.child)
      await cleanup(
        "remove temporary relationships and close created child",
        async () => {
          const child = report.artifacts.child;
          for (const [index, target, other] of [
            [0, child, ref],
            [1, ref, child],
          ]) {
            const relations = await call("arco_issue_relations", target);
            if (
              relations.parent?.repo === other.repo &&
              relations.parent.number === other.number
            )
              await call("arco_remove_parent", {
                ...target,
                requestId: id(`cleanup-parent-${index}`),
                parent: other,
              });
            if (
              relations.blockedBy.some(
                (item) =>
                  item.repo === other.repo && item.number === other.number,
              )
            )
              await call("arco_remove_dependency", {
                ...target,
                requestId: id(`cleanup-dependency-${index}`),
                blockedBy: other,
              });
          }
          const current = await call("arco_get_issue", child);
          if (current.state !== "closed")
            await call("arco_update_issue", {
              ...child,
              requestId: id("cleanup-child-close"),
              expectedUpdatedAt: current.updatedAt,
              patch: { state: "closed", stateReason: "completed" },
            });
          assert.equal((await call("arco_get_issue", child)).state, "closed");
        },
      );
    await cleanup(
      "delete only unique validation labels and preserve original Issue state/labels",
      async () => {
        const current = await call("arco_get_issue", ref);
        const names = [prefix, `${prefix}-renamed`];
        const assigned = current.labels
          .filter((label) => names.includes(label.name))
          .map((label) => label.name);
        if (assigned.length)
          await call("arco_change_labels", {
            ...ref,
            requestId: id("cleanup-label-unassign"),
            add: [],
            remove: assigned,
          });
        const definitions = await call("arco_label_definitions", {
          repo: ref.repo,
        });
        for (const [index, name] of names.entries())
          if (definitions.labels.some((label) => label.name === name))
            await call("arco_delete_label", {
              repo: ref.repo,
              requestId: id(`cleanup-label-delete-${index}`),
              name,
            });
        const final = await call("arco_get_issue", ref);
        assert.equal(final.state, originalIssue.state);
        assert.deepEqual(
          final.labels.map((label) => label.id).sort(),
          originalIssue.labels.map((label) => label.id).sort(),
        );
      },
    );
  }
  report.stderrBytes = stderrBytes;
  report.finishedAt = new Date().toISOString();
  report.complete =
    !operationError &&
    report.cleanup.every((item) => item.ok) &&
    stderrBytes === 0;
  await persist();
  await client.close();
  console.log(`Evidence: ${reportPath}`);
  console.log(
    `Checks ${report.checks.filter((check) => check.ok).length}/${report.checks.length}; cleanup ${report.cleanup.filter((item) => item.ok).length}/${report.cleanup.length}; clean server stderr ${stderrBytes === 0}`,
  );
  if (!report.complete) process.exitCode = 1;
}
