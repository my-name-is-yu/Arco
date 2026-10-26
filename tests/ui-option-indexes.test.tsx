import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ArcoHost, Connection } from "../src/shared/contracts";
import type {
  LinearComment,
  LinearIssue,
  LinearMetadata,
} from "../src/shared/linear";
import { LinearDetail } from "../src/ui/LinearDetail";
import { LinearInlineProperties } from "../src/ui/InlineIssueProperties";
import { MultiSelect } from "../src/ui/MultiSelect";
import { GitHubAuthScopeContext } from "../src/ui/github-auth";

type Option = {
  value: string;
  nativeValue?: string;
  label: string;
  color?: string;
  disabled?: boolean;
};
const state = vi.hoisted(() => ({
  comments: [] as LinearComment[],
  controls: [] as { options: Option[]; multiple?: boolean }[],
}));
vi.mock("@openai/apps-sdk-ui/components/Select", () => ({
  Select: (props: { options: Option[]; multiple?: boolean }) => {
    state.controls.push(props);
    return null;
  },
}));
vi.mock("../src/ui/linear-comments", () => ({
  useLinearComments: () => ({
    comments: state.comments,
    hasNextPage: false,
    isError: false,
  }),
}));
vi.mock("../src/ui/useDraftPersistence", () => ({
  useDraftPersistence: () => ({
    load: async () => undefined,
    value: () => undefined,
    statuses: {},
  }),
  DraftStatus: () => null,
  draftStorageId: (key: unknown) => JSON.stringify(key),
}));
vi.mock("../src/ui/LinearRelations", () => ({ LinearRelations: () => null }));
vi.mock("../src/ui/LinearLabelManager", () => ({
  LinearLabelManager: () => null,
}));

const issue: LinearIssue = {
  source: "linear",
  connectionId: "default",
  workspaceId: "workspace",
  teamId: "team",
  issueId: "issue",
  identifier: "TEAM-42",
  title: "Issue",
  body: "Body",
  author: "Author",
  url: "https://linear.app/fixture/issue/TEAM-42",
  updatedAt: "2026-10-26T00:00:00Z",
  state: {
    id: "current-state",
    name: "Current state",
    type: "started",
    color: "#888888",
  },
  assignee: { id: "current-member", name: "Current member" },
  labels: [
    {
      id: "current-label",
      name: "Current label",
      color: "#888888",
      description: null,
      teamId: "team",
      parentId: null,
      isGroup: false,
    },
  ],
  priority: 0,
  estimate: null,
  dueDate: null,
  project: null,
  projectMilestone: null,
  cycle: null,
  parent: null,
  children: [],
  comments: [],
  commentsHasMore: false,
  attachments: [],
  relations: [],
  reactions: [],
};
const metadata: LinearMetadata = {
  states: [
    {
      id: "available-state",
      name: "Available state",
      type: "started",
      color: "#000000",
    },
  ],
  members: [{ id: "available-member", name: "Available member" }],
  labels: [
    { ...issue.labels[0], id: "available-label", name: "Available label" },
  ],
  projects: [],
  cycles: [],
  milestones: [],
  estimateValues: [],
};
const host = { call: vi.fn() } as unknown as ArcoHost;
function renderDetail(catalog?: LinearMetadata) {
  const client = new QueryClient();
  const authScope = "fixture-github-session";
  client.setQueryData(["connection"], {
    mode: "fixture",
    connected: true,
    account: "fixture-user",
    authGeneration: authScope,
    message: "Fixture only",
  } satisfies Connection);
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <GitHubAuthScopeContext.Provider value={authScope}>
        <LinearDetail
          feedback={null}
          shared={null}
          onBack={() => {}}
          onFullscreen={() => {}}
          host={host}
          issue={issue}
          metadata={catalog}
          metadataError={null}
          busy={false}
          run={async () => undefined}
          onNotice={() => {}}
        />
      </GitHubAuthScopeContext.Provider>
    </QueryClientProvider>,
  );
  client.clear();
  return html;
}
function optionsFor(value: string) {
  return state.controls
    .flatMap((control) => control.options)
    .filter((option) => (option.nativeValue ?? option.value) === value);
}
beforeEach(() => {
  state.controls = [];
  state.comments = [];
});

describe("UI catalog indexes", () => {
  it.each([undefined, metadata])(
    "keeps unavailable current values disabled with catalog %s",
    (catalog) => {
      renderDetail(catalog);
      for (const value of ["current-state", "current-member", "current-label"])
        expect(optionsFor(value)).toEqual([
          expect.objectContaining({ disabled: true }),
        ]);
      if (catalog)
        for (const value of [
          "available-state",
          "available-member",
          "available-label",
        ])
          expect(optionsFor(value)).toEqual([
            expect.objectContaining({ disabled: false }),
          ]);
    },
  );

  it("keeps inline labels available by ID while retaining missing and overwritten catalog values", () => {
    renderToStaticMarkup(
      <LinearInlineProperties
        issue={issue}
        metadata={{
          ...metadata,
          labels: [
            ...metadata.labels,
            {
              ...issue.labels[0],
              name: "Current catalog name",
              color: "#123456",
            },
          ],
        }}
        onRetry={() => {}}
        onSave={() => {}}
      />,
    );
    expect(optionsFor("current-label")).toEqual([
      expect.objectContaining({
        label: "Current catalog name",
        color: "#123456",
        disabled: false,
      }),
    ]);
    state.controls = [];
    renderToStaticMarkup(
      <LinearInlineProperties
        issue={issue}
        onRetry={() => {}}
        onSave={() => {}}
      />,
    );
    expect(optionsFor("current-label")).toEqual([
      expect.objectContaining({ label: "Current label", disabled: true }),
    ]);
  });

  it.each(["detail", "inline"])(
    "%s builds a large metadata catalog with linearly many ID reads",
    (view) => {
      let reads = 0;
      const size = 128;
      const catalog: LinearMetadata = {
        ...metadata,
        states: Array.from({ length: size }, (_, index) => ({
          ...metadata.states[0],
          get id() {
            reads += 1;
            return `state-${index}`;
          },
        })),
        members: Array.from({ length: size }, (_, index) => ({
          name: `Member ${index}`,
          get id() {
            reads += 1;
            return `member-${index}`;
          },
        })),
        labels: Array.from({ length: size }, (_, index) => ({
          ...metadata.labels[0],
          get id() {
            reads += 1;
            return `label-${index}`;
          },
        })),
      };
      if (view === "detail") renderDetail(catalog);
      else
        renderToStaticMarkup(
          <LinearInlineProperties
            issue={issue}
            metadata={catalog}
            onRetry={() => {}}
            onSave={() => {}}
          />,
        );
      expect(reads).toBeLessThanOrEqual(size * 16);
    },
  );

  it("resolves reply authors to the first matching ID without sorting replies or inventing unloaded parents", () => {
    const comment = (
      id: string,
      author: string,
      parentId: string | null,
      body: string,
    ): LinearComment => ({
      id,
      author,
      parentId,
      body,
      authorId: author,
      updatedAt: issue.updatedAt,
      url: `${issue.url}#${id}`,
      reactions: [],
    });
    state.comments = [
      comment("parent", "First author", null, "First parent"),
      comment("parent", "Later author", null, "Later parent"),
      comment(
        "reply-2",
        "Reply author",
        "parent",
        "Reply rendered before the other reply",
      ),
      comment(
        "reply-1",
        "Reply author",
        "unloaded",
        "Reply rendered after the other reply",
      ),
    ];
    const html = renderDetail();
    expect(html).toContain("<small>Reply to First author</small>");
    expect(html).not.toContain("<small>Reply to Later author</small>");
    expect(html).toContain("<small>Reply</small>");
    expect(html.indexOf("Reply rendered before")).toBeLessThan(
      html.indexOf("Reply rendered after"),
    );
  });

  it("reads a large selected catalog linearly and preserves native option order and unresolved values", () => {
    let reads = 0;
    const options = Array.from({ length: 256 }, (_, index) => ({
      get value() {
        reads += 1;
        return String(index);
      },
      label: `Option ${index}`,
    }));
    renderToStaticMarkup(
      <MultiSelect
        label="Catalog"
        value={options.map((_, index) => String(index))}
        options={options}
        onChange={() => {}}
      />,
    );
    expect(reads).toBeLessThanOrEqual(options.length * 4);
    state.controls = [];
    const duplicates = [
      { value: "same", label: "First option" },
      { value: "same", label: "Second option" },
    ];
    renderToStaticMarkup(
      <MultiSelect
        label="Catalog"
        value={["same", "missing"]}
        options={duplicates}
        onChange={() => {}}
      />,
    );
    expect(state.controls[0].options).toEqual([
      ...duplicates,
      { value: "missing", label: "Unavailable selection", disabled: true },
    ]);
  });
});
