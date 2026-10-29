import { describe, expect, it } from "vitest";
import { createLocalDrafts, LocalDraftConflict } from "../src/ui/local-drafts";
import type { ArcoHost } from "../src/shared/contracts";
import type { Draft, DraftRecord } from "../src/shared/state";

const key = {
  source: "github" as const,
  repo: "yu/Arco",
  issue: "42",
  ownerId: "owner-a",
};
const draft = (body: string): Draft => ({ title: "Title", body, comment: "" });
function endpoint() {
  let record: DraftRecord = { revision: 0, draft: null };
  let writes = 0;
  let reads = 0;
  let loseResponse = false;
  const host: Pick<ArcoHost, "call"> = {
    async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
      if (name === "arco_read_draft") {
        reads++;
        return structuredClone(record) as T;
      }
      if (args.expectedRevision !== record.revision)
        throw new Error("revision conflict");
      writes++;
      record = {
        revision: record.revision + 1,
        draft: name === "arco_delete_draft" ? null : (args.draft as Draft),
      };
      if (loseResponse) {
        loseResponse = false;
        throw new Error("response lost after commit");
      }
      return structuredClone(record) as T;
    },
  };
  return {
    host,
    record: () => record,
    writes: () => writes,
    reads: () => reads,
    loseNextResponse() {
      loseResponse = true;
    },
  };
}
describe("UI draft revisions across independent views", () => {
  it("rejects malformed draft reads without exposing schema details or writing", async () => {
    const calls: string[] = [];
    const host: Pick<ArcoHost, "call"> = {
      async call<T>(name: string): Promise<T> {
        calls.push(name);
        return { revision: "private-schema-value", draft: {} } as T;
      },
    };
    const local = createLocalDrafts(host);
    await expect(local.save(key, draft("Unsent input"))).rejects.toMatchObject({
      kind: "invalid-response",
      message:
        "Could not read the saved draft. Keep this view open and try again.",
    });
    expect(calls).toEqual(["arco_read_draft"]);
  });

  it("verifies a malformed save response by reading without repeating the write", async () => {
    const server = endpoint();
    const call = server.host.call;
    const calls: string[] = [];
    server.host.call = async <T>(
      name: string,
      args: Record<string, unknown>,
    ): Promise<T> => {
      calls.push(name);
      const result = await call<T>(name, args);
      return name === "arco_write_draft"
        ? ({ revision: "private-schema-value", draft: {} } as T)
        : result;
    };
    const local = createLocalDrafts(server.host);
    await expect(local.save(key, draft("Saved once"))).resolves.toMatchObject({
      revision: 1,
      draft: draft("Saved once"),
    });
    expect(calls).toEqual([
      "arco_read_draft",
      "arco_write_draft",
      "arco_read_draft",
    ]);
    expect(server.writes()).toBe(1);
  });

  it("retains a conflicting view until an explicit comparison choice", async () => {
    const server = endpoint();
    const first = createLocalDrafts(server.host);
    const second = createLocalDrafts(server.host);
    const firstDraft = {
      ...draft("Shared text"),
      githubLabels: ["first", "second"],
    };
    const secondDraft = { ...firstDraft, githubLabels: ["second", "first"] };
    await Promise.all([first.load(key), second.load(key)]);
    await first.save(key, firstDraft);
    await expect(second.save(key, secondDraft)).rejects.toBeInstanceOf(
      LocalDraftConflict,
    );
    await expect(second.save(key, draft("more typing"))).rejects.toBeInstanceOf(
      LocalDraftConflict,
    );
    expect(server.record().draft).toEqual(firstDraft);
    await second.resolve(key, "keep-local", draft("second explicit choice"));
    expect(server.record().draft?.body).toBe("second explicit choice");
  });
  it("confirms a lost response by reading and never repeats the write", async () => {
    const server = endpoint();
    server.loseNextResponse();
    const local = createLocalDrafts(server.host);
    const input: Draft = {
      ...draft("saved once"),
      baseUpdatedAt: "2026-10-28T00:00:00Z",
      baseTitle: "Original title",
      baseBody: "Original body",
      githubLabels: [],
      githubAssignees: ["first", "second"],
      githubChildRepo: "",
      githubIssueTypeName: "Bug",
      linearTemplateId: "template",
      linearDescriptionTouched: false,
      linearReplyTo: undefined,
    };
    const result = await local.save(key, input);
    expect(result.revision).toBe(1);
    expect(result.draft).toEqual(input);
    expect(server.writes()).toBe(1);
    expect(server.reads()).toBe(2);
  });
  it("serializes rapid input snapshots and saves the newest text", async () => {
    const server = endpoint();
    const local = createLocalDrafts(server.host);
    await Promise.all([
      local.save(key, draft("a")),
      local.save(key, draft("ab")),
      local.save(key, draft("abc")),
    ]);
    expect(server.record()).toEqual({ revision: 3, draft: draft("abc") });
  });
  it("uses the saved draft only after the user chooses it", async () => {
    const server = endpoint();
    const first = createLocalDrafts(server.host);
    const second = createLocalDrafts(server.host);
    await second.load(key);
    await first.save(key, draft("saved in first"));
    await expect(
      second.save(key, draft("local in second")),
    ).rejects.toBeInstanceOf(LocalDraftConflict);
    expect((await second.resolve(key, "use-saved")).draft?.body).toBe(
      "saved in first",
    );
    expect(server.writes()).toBe(1);
  });
});
