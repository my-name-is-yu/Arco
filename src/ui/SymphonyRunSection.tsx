import type { ArcoHost, ConversationIssue } from "../shared/contracts";
import { ChevronRight } from "@openai/apps-sdk-ui/components/Icon";
import { symphonyIssueMatches } from "../shared/symphony";
import {
  symphonyBindingContainsIssue,
  symphonyNativeSelection,
} from "./symphony-navigation";
import { useSettings } from "./useSettings";
import {
  openSymphonyRun,
  relativeSymphonyTime,
  useSymphonyState,
  useSymphonyVisible,
} from "./symphony-queries";
import "./symphony.css";

export function SymphonyRunSection({
  host,
  issue,
}: {
  host: ArcoHost;
  issue: ConversationIssue;
}) {
  const settings = useSettings(host);
  const visible = useSymphonyVisible();
  const matches =
    settings.query.data?.settings.symphonyConnections.filter((connection) =>
      symphonyBindingContainsIssue(connection.binding, issue),
    ) ?? [];
  const connection =
    matches.find(
      (candidate) =>
        candidate.id ===
        settings.query.data?.settings.activeSymphonyConnectionId,
    ) ?? matches[0];
  const state = useSymphonyState(host, connection, visible);
  if (!connection) return null;
  const runtime = state.data?.rows.find((row) =>
    symphonyIssueMatches(connection.binding, row, issue),
  );
  const identifier =
    runtime?.issueIdentifier ??
    (issue.source === "github" ? `GH-${issue.number}` : issue.identifier);
  const status =
    runtime?.runtimeStatus ??
    (state.isPending
      ? "loading"
      : state.isError && !state.data
        ? "unavailable"
        : "inactive");
  const label = {
    running: "Running",
    retrying: "Retrying",
    blocked: "Blocked",
    loading: "Loading…",
    unavailable: "Unavailable",
    inactive: "No active run",
  }[status];
  return (
    <section className="symphony-run-section" aria-label="Symphony run">
      <h2>Symphony run</h2>
      <span className={`symphony-runtime-status ${status}`}>
        <span className="symphony-status-dot" aria-hidden="true" />
        {label}
      </span>
      {runtime?.error && <p>{runtime.error}</p>}
      {runtime && (
        <p>
          Last activity{" "}
          {relativeSymphonyTime(
            runtime.lastEventAt ?? runtime.startedAt ?? runtime.blockedAt,
          )}
        </p>
      )}
      {state.isError && (
        <p role="status">
          {state.data
            ? `Last observed ${relativeSymphonyTime(state.data.fetchedAt)}. `
            : ""}
          Connection unavailable.
        </p>
      )}
      <button
        type="button"
        className="symphony-text-link"
        onClick={() =>
          openSymphonyRun(
            host,
            symphonyNativeSelection(connection.id, identifier, issue),
          )
        }
      >
        View run <ChevronRight aria-hidden="true" />
      </button>
      {matches.length > 1 && <p>{connection.name}</p>}
    </section>
  );
}
