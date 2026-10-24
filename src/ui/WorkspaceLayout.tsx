import type { ReactNode } from "react";
import { Plus } from "@openai/apps-sdk-ui/components/Icon";
import { SingleSelect } from "./SingleSelect";
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
  return (
    <main
      className={`arco workspace${source === "linear" ? " linear-workspace" : ""}${detailOpen ? " show-detail" : ""}`}
      data-viewer={viewer}
    >
      {children}
    </main>
  );
}
export function WorkspaceHeader({
  source,
  onSourceChange,
  onCreate,
  createDisabled,
  createLabel,
  createTitle,
}: {
  source: "github" | "linear";
  onSourceChange: (source: "github" | "linear") => void;
  onCreate: () => void;
  createDisabled: boolean;
  createLabel: string;
  createTitle?: string;
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
    </div>
  );
}
