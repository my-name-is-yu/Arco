import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [workspaceId, teamId, existingParentId, resumeChildId] =
  process.argv.slice(2);
if (!workspaceId || !teamId)
  throw new Error(
    "Usage: node scripts/validate-linear-live.mjs WORKSPACE_ID TEAM_ID [DEDICATED_ARCO_DUMMY_ID] [DEDICATED_ARCO_CHILD_ID_TO_RESUME_UPLOAD]",
  );
const scope = { connectionId: "default", workspaceId, teamId };
const client = new Client({
  name: "arco-dedicated-linear-validation",
  version: "1.0.0",
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["dist/plugin/server.mjs"],
});
const steps = [];
const issues = [];
const labels = [];
const nonce = randomUUID().slice(0, 8);
await client.connect(transport);
async function call(name, args = {}) {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError)
    throw new Error(
      response.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    );
  if (name === "linear_read_image") return response._meta.image;
  return (
    response.structuredContent ??
    JSON.parse(response.content.find((part) => part.type === "text").text)
  );
}
async function write(name, args) {
  return call(name, { ...scope, requestId: randomUUID(), ...args });
}
const ref = (issueId) => ({ ...scope, issueId });
async function patch(issueId, patch) {
  const latest = await call("linear_get_issue", ref(issueId));
  return write("linear_update_issue", {
    issueId,
    expectedUpdatedAt: latest.updatedAt,
    patch,
  });
}
async function step(name, action) {
  await action();
  steps.push(name);
  console.log(JSON.stringify({ passed: name }));
}
let meta;
let failed;
try {
  const connection = await call("linear_connection", {
    connectionId: "default",
  });
  assert.equal(connection.mode, "linear");
  assert.equal(connection.workspace.id, workspaceId);
  meta = await call("linear_metadata", scope);
  let parent;
  if (existingParentId) {
    parent = await call("linear_get_issue", ref(existingParentId));
    assert.ok(
      parent.title.startsWith("Arco validation dummy "),
      "Existing issue must be the dedicated Arco validation dummy",
    );
    assert.equal(parent.teamId, teamId);
  } else
    parent = await write("linear_create_issue", {
      title: `Arco validation dummy ${nonce}`,
      body: "Dedicated temporary Arco validation issue. No automation opt-in labels.",
    });
  issues.push(parent.issueId);
  console.log(
    JSON.stringify({
      dedicatedIssue: {
        issueId: parent.issueId,
        identifier: parent.identifier,
        url: parent.url,
      },
    }),
  );
  if (!resumeChildId) {
    await step(
      "native issue content, properties, and stale draft detection",
      async () => {
        const old = parent;
        parent = await patch(parent.issueId, {
          title: `Arco validation dummy ${nonce} verified`,
          body: "## Arco validation\n\n- [x] Source persistence verified\n\nTemporary dedicated test issue.",
          priority: 3,
          dueDate: "2026-10-24",
          assigneeId: connection.userId,
        });
        assert.equal(parent.priority, 3);
        assert.equal(parent.assignee.id, connection.userId);
        assert.equal(parent.dueDate, "2026-10-24");
        await assert.rejects(
          () =>
            write("linear_update_issue", {
              issueId: parent.issueId,
              expectedUpdatedAt: old.updatedAt,
              patch: { body: "Do not overwrite" },
            }),
          /changed elsewhere/,
        );
      },
    );
    await step(
      "scoped label definitions and incremental label preservation",
      async () => {
        for (const suffix of ["A", "B"]) {
          const name = `Arco validation ${nonce} ${suffix}`;
          const result = await write("linear_label_definition", {
            action: "create",
            scope: "team",
            name,
            color: "#5e6ad2",
            description: "Temporary Arco validation label",
          });
          const label = result.labels.find(
            (value) => value.name === name && value.teamId === teamId,
          );
          assert.ok(label);
          labels.push(label.id);
        }
        await write("linear_label_definition", {
          action: "update",
          scope: "team",
          labelId: labels[0],
          color: "#4ea7fc",
          description: "Updated temporary validation label",
        });
        await write("linear_change_labels", {
          issueId: parent.issueId,
          add: [labels[0]],
        });
        parent = await write("linear_change_labels", {
          issueId: parent.issueId,
          add: [labels[1]],
        });
        assert.deepEqual(
          parent.labels.map((value) => value.id).sort(),
          [...labels].sort(),
        );
        parent = await write("linear_change_labels", {
          issueId: parent.issueId,
          remove: [labels[1]],
        });
        assert.deepEqual(
          parent.labels.map((value) => value.id),
          [labels[0]],
        );
      },
    );
    await step(
      "threaded comments, comment edits, reactions, and deletion",
      async () => {
        parent = await write("linear_comment", {
          issueId: parent.issueId,
          action: "create",
          body: `Arco validation comment ${nonce}`,
        });
        let comment = parent.comments.find(
          (value) => value.body === `Arco validation comment ${nonce}`,
        );
        assert.ok(comment);
        parent = await write("linear_comment", {
          issueId: parent.issueId,
          action: "create",
          parentId: comment.id,
          body: "Validation thread reply",
        });
        const reply = parent.comments.find(
          (value) => value.body === "Validation thread reply",
        );
        assert.equal(reply.parentId, comment.id);
        parent = await write("linear_comment", {
          issueId: parent.issueId,
          action: "update",
          commentId: comment.id,
          expectedUpdatedAt: comment.updatedAt,
          body: "Arco validation edited comment",
        });
        comment = parent.comments.find((value) => value.id === comment.id);
        parent = await write("linear_reaction", {
          issueId: parent.issueId,
          commentId: comment.id,
          action: "add",
          emoji: "👍",
        });
        const reaction = parent.comments
          .find((value) => value.id === comment.id)
          .reactions.find((value) => value.userId === connection.userId);
        assert.ok(reaction);
        parent = await write("linear_reaction", {
          issueId: parent.issueId,
          commentId: comment.id,
          action: "remove",
          emoji: reaction.emoji,
          reactionId: reaction.id,
        });
        const currentReply = parent.comments.find(
          (value) => value.id === reply.id,
        );
        parent = await write("linear_comment", {
          issueId: parent.issueId,
          action: "delete",
          commentId: reply.id,
          expectedUpdatedAt: currentReply.updatedAt,
        });
        await write("linear_comment", {
          issueId: parent.issueId,
          action: "delete",
          commentId: comment.id,
          expectedUpdatedAt: parent.comments.find(
            (value) => value.id === comment.id,
          ).updatedAt,
        });
        parent = await write("linear_reaction", {
          issueId: parent.issueId,
          action: "add",
          emoji: "👍",
        });
        const issueReaction = parent.reactions.find(
          (value) => value.userId === connection.userId,
        );
        assert.ok(issueReaction);
        await write("linear_reaction", {
          issueId: parent.issueId,
          action: "remove",
          emoji: issueReaction.emoji,
          reactionId: issueReaction.id,
        });
      },
    );
    await step(
      "parent and dependency direction with source identifiers",
      async () => {
        let child = await write("linear_create_issue", {
          title: `Arco validation dummy ${nonce} child`,
          body: "Dedicated child and relation test issue.",
          parentId: parent.issueId,
        });
        issues.push(child.issueId);
        assert.equal(child.parent.id, parent.issueId);
        child = await patch(child.issueId, { parentId: null });
        assert.equal(child.parent, null);
        parent = await write("linear_relation", {
          issueId: parent.issueId,
          action: "add",
          relatedIssueId: child.issueId,
          kind: "blocks",
        });
        const relation = parent.relations.find(
          (value) => value.relatedIssueId === child.issueId,
        );
        assert.equal(relation.type, "blocks");
        child = await call("linear_get_issue", ref(child.issueId));
        assert.equal(
          child.relations.find((value) => value.id === relation.id).type,
          "blocked-by",
        );
        await write("linear_relation", {
          issueId: parent.issueId,
          action: "remove",
          relationId: relation.id,
          kind: "blocks",
        });
        parent = await write("linear_relation", {
          issueId: parent.issueId,
          action: "add",
          relatedIssueId: child.issueId,
          kind: "related",
        });
        const related = parent.relations.find(
          (value) =>
            value.type === "related" &&
            [value.issueId, value.relatedIssueId].includes(child.issueId),
        );
        assert.ok(related);
        await write("linear_relation", {
          issueId: parent.issueId,
          action: "remove",
          relationId: related.id,
          kind: "related",
        });
        await patch(child.issueId, { parentId: parent.issueId });
      },
    );
  } else {
    const child = await call("linear_get_issue", ref(resumeChildId));
    assert.ok(child.title.startsWith("Arco validation dummy "));
    assert.equal(child.parent?.id, parent.issueId);
    issues.push(child.issueId);
  }
  await step("source upload and authenticated inline image read", async () => {
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5F9mQAAAAASUVORK5CYII=";
    if (!resumeChildId)
      parent = await write("linear_upload", {
        issueId: parent.issueId,
        filename: `arco-validation-${nonce}.png`,
        contentType: "image/png",
        base64,
      });
    const url = /\]\(<?(https:\/\/uploads\.linear\.app\/[^)>]+)>?\)/.exec(
      parent.body,
    )?.[1];
    assert.ok(url, "Uploaded source URL must persist in description");
    if (!/!\[Arco validation image\]/.test(parent.body))
      parent = await patch(parent.issueId, {
        body: `${parent.body}\n\n![Arco validation image](${url})`,
      });
    const image = await call("linear_read_image", {
      ...ref(parent.issueId),
      url,
    });
    assert.equal(image.mimeType, "image/png");
    assert.ok(image.data.length > 0);
  });
  await step(
    "source search, bulk per-issue partial results, and template availability",
    async () => {
      const listing = await call("linear_list_issues", { ...scope, query: "" });
      assert.ok(Array.isArray(listing.issues));
      const page = await call("linear_list_issues", {
        ...scope,
        query: parent.identifier,
      });
      assert.ok(page.issues.some((value) => value.issueId === parent.issueId));
      const result = await write("linear_bulk", {
        issueIds: [...issues, randomUUID()],
        patch: { priority: 4 },
      });
      assert.deepEqual(
        result.results.map((value) => value.success),
        [true, true, false],
      );
      const templates = await call("linear_templates", scope);
      assert.ok(Array.isArray(templates.templates));
      console.log(
        JSON.stringify({
          availableSourceValues: {
            cycles: meta.cycles.length,
            milestones: meta.milestones.length,
            estimates: meta.estimateValues.length,
            templates: templates.templates.length,
          },
        }),
      );
    },
  );
} catch (error) {
  failed = error;
} finally {
  const cleanupErrors = [];
  for (const issueId of issues) {
    try {
      const current = await call("linear_get_issue", ref(issueId));
      const applied = current.labels
        .filter((label) => labels.includes(label.id))
        .map((label) => label.id);
      if (applied.length)
        await write("linear_change_labels", { issueId, remove: applied });
    } catch (error) {
      cleanupErrors.push(error.message);
    }
    try {
      const done = meta?.states.find((state) => state.type === "completed");
      if (done)
        await patch(issueId, {
          stateId: done.id,
          assigneeId: null,
          dueDate: null,
        });
    } catch (error) {
      cleanupErrors.push(error.message);
    }
  }
  for (const labelId of labels) {
    try {
      await write("linear_label_definition", {
        action: "delete",
        scope: "team",
        labelId,
      });
    } catch (error) {
      cleanupErrors.push(error.message);
    }
  }
  console.log(
    JSON.stringify({
      validation: {
        passed: steps,
        dummyIssueIds: issues,
        cleanupErrors,
        failure: failed?.message ?? null,
      },
    }),
  );
  await client.close();
  if (cleanupErrors.length && !failed)
    failed = new Error("Dummy cleanup was incomplete");
}
if (failed) throw failed;
