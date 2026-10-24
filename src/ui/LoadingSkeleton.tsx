import { AsyncState } from "./AsyncState";
import type { DisplayMode } from "../shared/contracts";

function Line({
  width = "100%",
  tall = false,
}: {
  width?: string;
  tall?: boolean;
}) {
  return (
    <span
      className={`skeleton-block${tall ? " skeleton-title" : ""}`}
      style={{ width }}
    />
  );
}

function ListShape() {
  return (
    <div className="skeleton-list-shape">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="skeleton-row" key={index}>
          <span className="skeleton-block skeleton-dot" />
          <div>
            <Line width={index % 2 ? "76%" : "92%"} />
            <Line width="58%" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DetailShape() {
  return (
    <div className="skeleton-detail-shape">
      <div className="skeleton-heading">
        <Line width="130px" />
        <Line width="80%" tall />
        <Line width="190px" />
      </div>
      <div className="skeleton-detail-grid">
        <div className="skeleton-body">
          <Line width="38%" />
          <Line />
          <Line width="92%" />
          <Line width="68%" />
          <div className="skeleton-paragraph">
            <Line width="45%" />
            <Line />
            <Line width="85%" />
          </div>
          <div className="skeleton-paragraph skeleton-comment">
            <Line width="28%" />
            <Line width="88%" />
            <Line width="72%" />
          </div>
        </div>
        <div className="skeleton-properties">
          {[0, 1, 2, 3].map((index) => (
            <div key={index}>
              <Line width="55%" />
              <span className="skeleton-block skeleton-pill" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function IssueListSkeleton() {
  return (
    <AsyncState
      as="div"
      kind="loading"
      className="loading-skeleton"
      data-loading-skeleton="list"
      label="Loading issues"
    >
      <span className="skeleton-label">Loading issues…</span>
      <div aria-hidden="true">
        <ListShape />
      </div>
    </AsyncState>
  );
}

export function IssueDetailSkeleton() {
  return (
    <AsyncState
      as="div"
      kind="loading"
      className="loading-skeleton skeleton-detail"
      data-loading-skeleton="detail"
      label="Loading issue"
    >
      <span className="skeleton-label">Loading issue…</span>
      <div aria-hidden="true">
        <DetailShape />
      </div>
    </AsyncState>
  );
}

export function InlineSkeleton({
  label = "Loading issue…",
}: {
  label?: string;
}) {
  return (
    <AsyncState
      as="div"
      kind="loading"
      className="arco compact-mode loading-skeleton inline-skeleton"
      data-loading-skeleton="inline"
      label={label}
    >
      <span className="skeleton-label">{label}</span>
      <div aria-hidden="true">
        <div className="skeleton-inline-top">
          <Line width="65px" />
          <Line width="75px" />
        </div>
        <Line width="110px" />
        <Line width="90%" tall />
        <Line />
        <Line width="70%" />
        <span className="skeleton-block skeleton-pill" />
      </div>
    </AsyncState>
  );
}

export function WorkspaceSkeleton({
  mode,
  label = "Loading Arco",
}: {
  mode?: DisplayMode;
  label?: string;
}) {
  if (mode === "inline") return <InlineSkeleton label={label} />;
  return (
    <AsyncState
      as="main"
      kind="loading"
      className={`arco workspace loading-skeleton workspace-skeleton${mode ? "" : " bootstrap-skeleton"}`}
      data-loading-skeleton="workspace"
      label={label}
    >
      <span className="skeleton-label">{label}</span>
      <aside className="issue-sidebar" aria-hidden="true">
        <div className="skeleton-sidebar-top">
          <div className="skeleton-inline-top">
            <Line width="40px" />
            <Line width="80px" />
          </div>
          <Line width="38%" />
          <span className="skeleton-block skeleton-pill" />
          <span className="skeleton-block skeleton-search" />
          <Line width="70%" />
        </div>
        <ListShape />
      </aside>
      <section className="detail-pane" aria-hidden="true">
        <div className="detail-toolbar">
          <Line width="60px" />
          <span className="skeleton-block skeleton-pill" />
        </div>
        <DetailShape />
      </section>
    </AsyncState>
  );
}
