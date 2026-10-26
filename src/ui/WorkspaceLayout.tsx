import {
  useContext,
  type ReactNode,
  type Ref,
  type UIEventHandler,
} from "react";
import { Plus } from "@openai/apps-sdk-ui/components/Icon";
import { SingleSelect } from "./SingleSelect";
import { GitHubAuthScopeContext } from "./github-auth";
export function WorkspaceLayout({
  source,
  detailOpen,
  viewer,
  children,
}: {
  source: "github" | "linear";
  detailOpen: boolean;
  viewer?: "project" | "personal";
  children: ReactNode;
}) {
  const githubAuthScope = useContext(GitHubAuthScopeContext);
  return (
    <main
      className={`arco workspace${source === "linear" ? " linear-workspace" : ""}${detailOpen ? " show-detail" : ""}`}
      data-viewer={viewer}
      data-arco-github-auth-generation={
        source === "github" ? (githubAuthScope ?? undefined) : undefined
      }
    >
      {children}
    </main>
  );
}
export function WorkspaceIssueList({
  children,
  bulkActions,
  busy,
  refreshing = false,
  onScroll,
  ref,
}: {
  children: ReactNode;
  bulkActions?: ReactNode;
  busy: boolean;
  refreshing?: boolean;
  onScroll: UIEventHandler<HTMLDivElement>;
  ref: Ref<HTMLDivElement>;
}) {
  return (
    <>
      <div
        className={`issue-list${refreshing ? " refreshing" : ""}`}
        ref={ref}
        aria-busy={busy}
        onScroll={onScroll}
      >
        {children}
      </div>
      {bulkActions}
    </>
  );
}

export function WorkspaceHeader({
  source,
  onSourceChange,
  onCreate,
  createDisabled,
  createLabel,
  createTitle,
  actions,
}: {
  source: "github" | "linear";
  onSourceChange: (source: "github" | "linear") => void;
  onCreate: () => void;
  createDisabled: boolean;
  createLabel: string;
  createTitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="sidebar-heading">
      <div className="sidebar-identity">
        <strong className="wordmark">Arco</strong>
        <SingleSelect
          className="source-select"
          label="Issue source"
          value={source}
          options={[
            { value: "github", label: "GitHub" },
            { value: "linear", label: "Linear" },
          ]}
          onChange={(value) => {
            if (value === "github" || value === "linear") onSourceChange(value);
          }}
        />
      </div>
      <div>
        <button
          type="button"
          className="icon-button"
          aria-label={createLabel}
          title={createTitle ?? createLabel}
          disabled={createDisabled}
          onClick={onCreate}
        >
          <Plus aria-hidden="true" />
        </button>
        {actions}
      </div>
    </div>
  );
}
