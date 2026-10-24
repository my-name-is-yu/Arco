import { describe, expect, it, vi } from "vitest";
import { draftController } from "../src/ui/useDraftPersistence";
import type { ArcoHost } from "../src/shared/contracts";
import type { Draft, DraftKey } from "../src/shared/state";

const github: DraftKey = { source: "github", repo: "yu/Arco", issue: "42" };
const linear: DraftKey = {
  source: "linear",
  workspaceId: "workspace",
  teamId: "team",
  issue: "issue-42",
};
const draft = (comment: string): Draft => ({
  title: "Title",
  body: "Body",
  comment,
});
function fixture() {
  const saved = new Map<string, Draft>();
  const call = vi.fn(async (name: string, args: Record<string, unknown>) => {
    const id = JSON.stringify(args.key);
    if (name === "arco_write_draft") saved.set(id, args.draft as Draft);
    return {
      revision: name === "arco_write_draft" ? 1 : 0,
      draft: saved.get(id) ?? null,
    };
  });
  return { host: { call } as unknown as ArcoHost, call };
}
describe("host-lifetime draft controller", () => {
  it("keeps one live value and write queue across provider view subscriptions", async () => {
    const { host, call } = fixture();
    const first = draftController(host);
    first.schedule(github, draft("Unsent GitHub comment"));
    const nextView = draftController(host);
    expect(nextView).toBe(first);
    expect(await nextView.load(github)).toEqual(draft("Unsent GitHub comment"));
    nextView.schedule(linear, draft("Separate Linear comment"));
    first.schedule(github, draft(""));
    expect(nextView.value(linear)?.comment).toBe("Separate Linear comment");
    expect(nextView.value(github)?.comment).toBe("");
    nextView.flush();
    await vi.waitFor(() =>
      expect(nextView.get()[JSON.stringify(github)]?.state).toBe("saved"),
    );
    expect(
      call.mock.calls.filter(([name]) => name === "arco_write_draft"),
    ).toHaveLength(2);
  });
  it("does not overwrite input with a delayed initial disk read", async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const host = { call: vi.fn(() => pending) } as unknown as ArcoHost;
    const controller = draftController(host);
    const reading = controller.load(github);
    controller.schedule(github, draft("New input"));
    release({ revision: 0, draft: draft("Old disk input") });
    await expect(reading).resolves.toEqual(draft("New input"));
    expect(controller.value(github)).toEqual(draft("New input"));
    controller.flush();
  });
});
