import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowRotateCw,
  ChevronRight,
  Grid,
  Plus,
  SettingsCog,
  TableCellsFilled,
  X,
} from "@openai/apps-sdk-ui/components/Icon";
import type { ArcoHost } from "../shared/contracts";
import type { SettingsRecord } from "../shared/state";
import {
  symphonyRuntimeContext,
  type SymphonyConnection,
  type SymphonySelection,
} from "../shared/symphony";
import {
  resolveSymphonySelection,
  symphonyNativeSelection,
  symphonySelectionKey,
} from "./symphony-navigation";
import { AsyncState } from "./AsyncState";
import { SingleSelect } from "./SingleSelect";
import { IssueStateVisual } from "./IssuePropertyVisual";
import { IssueMarkdown } from "./MarkdownContent";
import { SymphonyConnectionEditor } from "./SymphonyConnectionEditor";
import { useSettings } from "./useSettings";
import { useDetailReadingPosition } from "./useListInteraction";
import { selectPresentedIssue, useSessionState } from "./session-state";
import {
  relativeSymphonyTime,
  symphonyGroups,
  symphonyWorkItems,
  useSymphonyIssueContext,
  useSymphonyNativeIssues,
  useSymphonyState,
  useSymphonyVisible,
  type SymphonyGroup,
  type SymphonyWorkItem,
} from "./symphony-queries";
import "./symphony.css";

const runtimeLabels = {
  running: "Running",
  retrying: "Retrying",
  blocked: "Blocked",
};

export function SymphonyRuntimeStatus({
  item,
}: {
  item: Pick<SymphonyWorkItem, "runtime">;
}) {
  return (
    <span
      className={`symphony-runtime-status ${item.runtime?.runtimeStatus ?? "inactive"}`}
    >
      <span className="symphony-status-dot" aria-hidden="true" />
      {item.runtime
        ? runtimeLabels[item.runtime.runtimeStatus]
        : "No active run"}
    </span>
  );
}

function NativeState({ item }: { item: SymphonyWorkItem }) {
  if (!item.issue) return <span className="muted">Not linked</span>;
  return (
    <span className="symphony-native-state">
      <IssueStateVisual
        source={item.issue.source}
        state={
          item.issue.source === "github"
            ? item.issue.state
            : item.issue.state.type
        }
        color={
          item.issue.source === "linear" ? item.issue.state.color : undefined
        }
      />
      {item.issue.source === "github"
        ? item.issue.state === "open"
          ? "Open"
          : "Closed"
        : item.issue.state.name}
    </span>
  );
}

function WorkCard({
  item,
  selected,
  onSelect,
}: {
  item: SymphonyWorkItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`symphony-work-card${selected ? " selected" : ""}`}
      data-symphony-work-key={item.key}
      aria-label={`${item.identifier}: ${item.title}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="symphony-card-kicker">
        <span>{item.identifier}</span>
        <NativeState item={item} />
      </span>
      <strong>{item.title}</strong>
      {!item.issue && (
        <span className="symphony-card-note">
          Runtime only · issue context not linked
        </span>
      )}
      <span className="symphony-card-runtime">
        <SymphonyRuntimeStatus item={item} />
        {item.runtime && (
          <span className="symphony-card-reason">
            {item.runtime.error ??
              item.runtime.lastMessage ??
              (item.runtime.retryAttempt !== null
                ? `Attempt ${item.runtime.retryAttempt}`
                : "")}
          </span>
        )}
      </span>
      {item.issue?.source === "github" && item.issue.labels.length > 0 && (
        <span className="row-labels">
          {item.issue.labels.slice(0, 3).map((label) => (
            <span key={label.id}>{label.name}</span>
          ))}
        </span>
      )}
    </button>
  );
}

function WorkDetails({
  host,
  connection,
  item,
  generation,
  observedAt,
  visible,
  disappeared,
  selectionKey,
  onClose,
}: {
  host: ArcoHost;
  connection: SymphonyConnection;
  item: SymphonyWorkItem;
  generation: string | null;
  observedAt: string;
  visible: boolean;
  disappeared: boolean;
  selectionKey: string;
  onClose: () => void;
}) {
  const context = useSymphonyIssueContext(
    host,
    item.issue,
    connection,
    generation,
    visible,
    item.runtime,
  );
  const nativeIssue = context.data ?? item.issue;
  const readingPosition = useDetailReadingPosition<HTMLElement>(
    host,
    JSON.stringify([selectionKey, generation]),
    Boolean(context.data) || !context.isFetching,
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), []);
  const closeDetails = () => {
    onClose();
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          `button[data-symphony-work-key="${CSS.escape(item.key)}"]`,
        )
        ?.focus(),
    );
  };
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const runtime = disappeared ? null : item.runtime;
  const openIssue = async () => {
    if (!context.data) return;
    try {
      const issue = context.data;
      const auth =
        issue.source === "github"
          ? await host.call<{ authGeneration: string }>("arco_connection", {})
          : undefined;
      selectPresentedIssue(
        host,
        issue.source === "github"
          ? { source: "github", repo: issue.repo, number: issue.number }
          : {
              source: "linear",
              connectionId: issue.connectionId,
              workspaceId: issue.workspaceId,
              teamId: issue.teamId,
              issueId: issue.issueId,
            },
        auth?.authGeneration,
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not open the issue.",
      );
    }
  };
  const shareRuntime = async () => {
    if (!runtime) return;
    setSharing(true);
    setError(null);
    try {
      if (!host.shareRuntime)
        throw new Error(
          "This Codex host cannot share runtime context. Update Codex and try again.",
        );
      await host.shareRuntime(
        symphonyRuntimeContext(
          connection,
          runtime,
          observedAt,
          nativeIssue
            ? {
                source: nativeIssue.source,
                url: nativeIssue.url,
                title: nativeIssue.title,
                identifier: item.identifier,
              }
            : undefined,
        ),
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not attach runtime context.",
      );
    } finally {
      setSharing(false);
    }
  };
  return (
    <aside
      className="symphony-work-details"
      aria-label="Symphony work details"
      {...readingPosition}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          closeDetails();
        }
      }}
    >
      <div className="symphony-detail-heading">
        <div>
          <span className="muted">{item.identifier}</span>
          <h1>{nativeIssue?.title ?? item.title}</h1>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close work details"
          ref={closeRef}
          onClick={closeDetails}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      {disappeared && (
        <p className="symphony-inline-notice" role="status">
          This work is no longer in the current snapshot.
        </p>
      )}
      <section className="symphony-runtime-detail">
        <h2>Runtime</h2>
        <SymphonyRuntimeStatus item={{ runtime }} />
        {runtime ? (
          <>
            {(runtime.error || runtime.lastMessage) && (
              <p className="symphony-runtime-reason">
                {runtime.error ?? runtime.lastMessage}
              </p>
            )}
            <dl className="symphony-runtime-facts">
              <div>
                <dt>Last activity</dt>
                <dd>
                  {relativeSymphonyTime(
                    runtime.lastEventAt ?? runtime.startedAt,
                  )}
                </dd>
              </div>
              {runtime.tokens && (
                <div>
                  <dt>Total tokens</dt>
                  <dd>{runtime.tokens.totalTokens.toLocaleString("en-US")}</dd>
                </div>
              )}
              {runtime.retryAttempt !== null && (
                <div>
                  <dt>Attempt</dt>
                  <dd>{runtime.retryAttempt}</dd>
                </div>
              )}
              {runtime.turnCount !== null && (
                <div>
                  <dt>Turns</dt>
                  <dd>{runtime.turnCount}</dd>
                </div>
              )}
              {runtime.retryDueAt && (
                <div>
                  <dt>Retry due</dt>
                  <dd>
                    {new Date(runtime.retryDueAt).toLocaleTimeString("en-US")}
                  </dd>
                </div>
              )}
            </dl>
            {runtime.lastEvent && (
              <div className="symphony-last-event">
                <span className="muted">Latest event</span>
                <p>{runtime.lastEvent}</p>
              </div>
            )}
            <Button
              color="primary"
              size="sm"
              disabled={sharing}
              onClick={() => void shareRuntime()}
            >
              Add run context to chat
            </Button>
          </>
        ) : (
          <p className="muted">
            No current execution is reported. This does not indicate that the
            issue is complete.
          </p>
        )}
      </section>
      <section className="symphony-issue-context">
        <h2>Issue context</h2>
        {!nativeIssue && !context.isFetching && !context.isError && (
          <p className="muted">
            No matching issue is available in this connection's scope. Every
            runtime remains visible here.
          </p>
        )}
        {context.isFetching && !context.data && (
          <AsyncState kind="loading">Loading issue context…</AsyncState>
        )}
        {context.isError && (
          <p className="inline-error" role="alert">
            {context.error.message}
          </p>
        )}
        {nativeIssue && (
          <>
            <div className="symphony-context-identity">
              <span>
                {nativeIssue.source === "github" ? nativeIssue.repo : "Linear"}
              </span>
              <NativeState item={{ ...item, issue: nativeIssue }} />
            </div>
            {context.data && (
              <>
                <IssueMarkdown
                  body={context.data.body}
                  onOpen={(url) => {
                    void host
                      .openLink(url)
                      .catch(() => setError("Could not open this link."));
                  }}
                />
                <button
                  type="button"
                  className="symphony-text-link"
                  onClick={() => void openIssue()}
                >
                  Open issue <ChevronRight aria-hidden="true" />
                </button>
              </>
            )}
          </>
        )}
      </section>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}

export function SymphonyWorkspace({
  host,
  onSourceChange,
}: {
  host: ArcoHost;
  onSourceChange: (source: "github" | "linear" | "symphony") => void;
}) {
  const settings = useSettings(host);
  const client = useQueryClient();
  const visible = useSymphonyVisible();
  const [connectionOverride, setConnectionOverride] = useSessionState<
    string | null
  >(host, "symphony:connectionId", null);
  const [intent, setIntent] = useSessionState<SymphonySelection | null>(
    host,
    "symphony:selected",
    null,
  );

  const [layoutOverride, setLayoutOverride] = useSessionState<
    "board" | "table" | null
  >(host, "symphony:layout", null);
  const [editor, setEditor] = useState<SymphonyConnection | "new" | null>(null);
  const connections = settings.query.data?.settings.symphonyConnections ?? [];
  const connection =
    connections.find(
      (candidate) =>
        candidate.id ===
        (connectionOverride ??
          settings.query.data?.settings.activeSymphonyConnectionId),
    ) ?? connections[0];
  const scopeKey = JSON.stringify([
    connection?.id ?? null,
    connection?.baseUrl ?? null,
    connection?.binding ?? null,
  ]);
  const [selected, setSelected] = useSessionState<SymphonySelection | null>(
    host,
    `symphony:selection:${scopeKey}`,
    null,
  );
  const [search, setSearch] = useSessionState(
    host,
    `symphony:search:${scopeKey}`,
    "",
  );
  const [filter, setFilter] = useSessionState<SymphonyGroup | "all">(
    host,
    `symphony:filter:${scopeKey}`,
    "all",
  );
  const [scroll, setScroll] = useSessionState<Record<string, number>>(
    host,
    `symphony:scroll:${scopeKey}`,
    {},
  );
  const overviewRef = useRef<HTMLDivElement>(null);
  const layout =
    layoutOverride ?? settings.query.data?.settings.symphonyLayout ?? "board";
  const snapshot = useSymphonyState(host, connection, visible);
  const native = useSymphonyNativeIssues(host, connection, visible);
  const items = useMemo(
    () =>
      connection && snapshot.data
        ? symphonyWorkItems(
            connection,
            snapshot.data?.rows ?? [],
            native.nativeIssues,
          )
        : [],
    [connection, snapshot.data, native.nativeIssues],
  );
  const activeIntent = intent?.connectionId === connection?.id ? intent : null;
  const selection = activeIntent ?? selected;
  const selectedItem =
    selection && connection
      ? resolveSymphonySelection(connection, items, selection)
      : undefined;
  useEffect(() => {
    if (!selection || !selectedItem) return;
    // Adopt native identity when a later issue page links a runtime-only choice.
    if (activeIntent || (!selection.nativeIssue && selectedItem.issue)) {
      setSelected(
        selectedItem.issue
          ? symphonyNativeSelection(
              selection.connectionId,
              selectedItem.identifier,
              selectedItem.issue,
            )
          : selection,
      );
      if (activeIntent) setIntent(null);
    }
  }, [activeIntent, selection, selectedItem, setSelected, setIntent]);
  useLayoutEffect(() => {
    if (overviewRef.current)
      overviewRef.current.scrollTop = scroll[layout] ?? 0;
  }, [scopeKey, layout, scroll]);
  const selectionKey = selection
    ? JSON.stringify([scopeKey, symphonySelectionKey(selection)])
    : null;
  const selectedKey = selectedItem?.key;
  const retained = useRef<{
    generation: string | null;
    selectionKey: string | null;
    item: SymphonyWorkItem;
  } | null>(null);
  if (selectedItem)
    retained.current = {
      generation: native.generation,
      selectionKey,
      item: selectedItem,
    };
  const remembered =
    retained.current?.selectionKey === selectionKey ? retained.current : null;
  const detail =
    selectedItem ??
    (remembered?.generation === native.generation
      ? remembered?.item
      : remembered?.item.runtime
        ? {
            ...remembered.item,
            issue: null,
            title: remembered.item.runtime.issueIdentifier,
          }
        : null);
  const filtered = items.filter(
    (item) =>
      (filter === "all" || item.group === filter) &&
      `${item.identifier} ${item.title} ${item.runtime?.error ?? ""}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  const saveConnection = async (value: SymphonyConnection) => {
    const current = await host.call<SettingsRecord>("arco_get_settings", {});
    const saved = await host.call<SettingsRecord>("arco_update_settings", {
      expectedRevision: current.revision,
      patch: {
        symphonyConnections: [
          ...current.settings.symphonyConnections.filter(
            (entry) => entry.id !== value.id,
          ),
          value,
        ],
        activeSymphonyConnectionId: value.id,
      },
    });
    client.setQueryData(["settings"], saved);
    setConnectionOverride(value.id);
    setEditor(null);
  };
  const removeConnection = async () => {
    if (!editor || editor === "new") return;
    const current = await host.call<SettingsRecord>("arco_get_settings", {});
    const next = current.settings.symphonyConnections.filter(
      (entry) => entry.id !== editor.id,
    );
    const saved = await host.call<SettingsRecord>("arco_update_settings", {
      expectedRevision: current.revision,
      patch: {
        symphonyConnections: next,
        activeSymphonyConnectionId: next[0]?.id ?? null,
      },
    });
    client.setQueryData(["settings"], saved);
    setConnectionOverride(next[0]?.id ?? null);
    setSelected(null);
    setEditor(null);
  };
  const refresh = () => {
    void snapshot.refetch();
    if (connection?.binding) {
      void native.provider.refetch();
      void native.issues.refetch();
    }
  };
  const selectConnection = (id: string) => {
    setIntent(null);
    setConnectionOverride(id);
    settings.update("symphony:connection", () => ({
      activeSymphonyConnectionId: id,
    }));
  };
  const showLayout = (value: "board" | "table") => {
    setLayoutOverride(value);
    settings.update("symphony:layout", () => ({ symphonyLayout: value }));
  };
  const selectWork = (item: SymphonyWorkItem | null) => {
    setIntent(null);
    setSelected(
      item && connection
        ? item.issue
          ? symphonyNativeSelection(connection.id, item.identifier, item.issue)
          : {
              connectionId: connection.id,
              issueIdentifier: item.identifier,
              runtimeKey: item.runtime?.key,
            }
        : null,
    );
  };
  return (
    <main className="arco symphony-workspace" aria-label="Symphony workspace">
      <header className="symphony-header">
        <div className="symphony-header-identity">
          <strong className="wordmark">Arco</strong>
          <SingleSelect
            label="Issue source"
            value="symphony"
            options={[
              { value: "github", label: "GitHub" },
              { value: "linear", label: "Linear" },
              { value: "symphony", label: "Symphony" },
            ]}
            onChange={(value) => {
              if (
                value === "github" ||
                value === "linear" ||
                value === "symphony"
              )
                onSourceChange(value);
            }}
          />
          {connections.length > 0 && (
            <>
              <span className="symphony-header-divider" />
              <SingleSelect
                label="Symphony connection"
                value={connection?.id ?? ""}
                options={connections.map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                }))}
                onChange={selectConnection}
              />
            </>
          )}
        </div>
        <div className="symphony-header-actions">
          {connection && (
            <>
              <span
                className={`symphony-connection-status${snapshot.isError ? " unavailable" : ""}`}
              >
                {snapshot.isError
                  ? "Unavailable"
                  : snapshot.data
                    ? "Connected"
                    : "Connecting"}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Refresh Symphony"
                disabled={snapshot.isFetching}
                onClick={refresh}
              >
                <ArrowRotateCw aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Edit Symphony connection"
                onClick={() => setEditor(connection)}
              >
                <SettingsCog aria-hidden="true" />
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Add Symphony connection"
            onClick={() => setEditor("new")}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </header>
      {settings.error && (
        <p className="symphony-inline-notice" role="alert">
          {settings.error}
          <button type="button" onClick={settings.retry}>
            Retry saving settings
          </button>
        </p>
      )}
      {connection && snapshot.isError && (
        <p className="symphony-inline-notice" role="alert">
          {snapshot.error.message}
          {snapshot.data ? " Last observed work is retained." : ""}
        </p>
      )}
      {settings.query.isError ? (
        <AsyncState kind="error" className="symphony-empty">
          <h1>Could not load local settings</h1>
          <p>{settings.query.error.message}</p>
        </AsyncState>
      ) : settings.query.isPending ? (
        <AsyncState kind="loading" className="symphony-empty">
          Loading Symphony connections…
        </AsyncState>
      ) : !connection ? (
        <AsyncState kind="empty" className="symphony-empty">
          <h1>Connect Symphony</h1>
          <p>See current work alongside the issues you discuss in Codex.</p>
          <p className="muted">
            Connect an existing local or remote Symphony instance. Issue
            connections are optional.
          </p>
          <Button color="primary" size="sm" onClick={() => setEditor("new")}>
            Add connection
          </Button>
        </AsyncState>
      ) : (
        <div className={`symphony-work-area${detail ? " has-detail" : ""}`}>
          <div
            className="symphony-overview"
            ref={overviewRef}
            onScroll={(event) => {
              const top = event.currentTarget.scrollTop;
              setScroll((value) =>
                value[layout] === top ? value : { ...value, [layout]: top },
              );
            }}
          >
            <div className="symphony-overview-heading">
              <div>
                <h1>Work overview</h1>
                <p className="muted">
                  {items.length} loaded
                  {snapshot.data
                    ? ` · Updated ${relativeSymphonyTime(snapshot.data.fetchedAt)}`
                    : ""}
                </p>
              </div>
              <div className="symphony-view-toggle" aria-label="Work layout">
                <button
                  type="button"
                  aria-label="Board view"
                  aria-pressed={layout === "board"}
                  onClick={() => showLayout("board")}
                >
                  <Grid aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Table view"
                  aria-pressed={layout === "table"}
                  onClick={() => showLayout("table")}
                >
                  <TableCellsFilled aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="symphony-filters">
              <input
                type="search"
                aria-label="Search Symphony work"
                placeholder="Search issues…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <SingleSelect
                label="Work group"
                value={filter}
                options={[
                  { value: "all", label: "All work" },
                  ...symphonyGroups.map((group) => ({
                    value: group.value,
                    label: group.label,
                  })),
                ]}
                onChange={(value) => setFilter(value as SymphonyGroup | "all")}
              />
            </div>
            {activeIntent && snapshot.data && !selectedItem && (
              <p className="symphony-inline-notice" role="status">
                The selected issue is not in the loaded work. It may have no
                active run, be closed, or be on another issue page.
              </p>
            )}
            {connection.binding &&
              (native.provider.isError ||
                native.issues.isError ||
                !native.scopeMatches ||
                native.provider.data?.connected === false) && (
                <p className="symphony-inline-notice" role="alert">
                  {native.provider.error?.message ??
                    native.issues.error?.message ??
                    (!native.scopeMatches
                      ? "The connected issue workspace does not match this binding."
                      : "Connect the bound issue account to load issue context.")}{" "}
                  Runtime work remains available.
                </p>
              )}
            {!connection.binding && (
              <p className="symphony-binding-hint">
                Showing runtime work.{" "}
                <button
                  type="button"
                  className="symphony-text-link"
                  onClick={() => setEditor(connection)}
                >
                  Link issue scope
                </button>
              </p>
            )}
            {snapshot.isPending ? (
              <AsyncState kind="loading" className="symphony-empty">
                Loading current work…
              </AsyncState>
            ) : snapshot.isError && !snapshot.data ? (
              <AsyncState kind="error" className="symphony-empty">
                <h2>Could not load current work</h2>
                <p>Check the connection route and refresh to try again.</p>
              </AsyncState>
            ) : !filtered.length ? (
              <AsyncState kind="empty" className="symphony-empty">
                <h2>
                  {search || filter !== "all"
                    ? "No work matches these filters"
                    : "No current work"}
                </h2>
                <p className="muted">
                  {snapshot.isError
                    ? "Refresh the connection to load its current work."
                    : "Newly observed work appears here automatically."}
                </p>
              </AsyncState>
            ) : layout === "board" ? (
              <div className="symphony-board">
                {symphonyGroups
                  .filter(
                    (group) =>
                      group.value !== "other" ||
                      filtered.some((item) => item.group === "other"),
                  )
                  .map((group) => (
                    <section
                      className="symphony-board-column"
                      key={group.value}
                      aria-label={group.label}
                    >
                      <div className="symphony-column-heading">
                        <h2>
                          {group.label}{" "}
                          <span>
                            {
                              filtered.filter(
                                (item) => item.group === group.value,
                              ).length
                            }
                          </span>
                        </h2>
                        <p>{group.hint}</p>
                      </div>
                      {filtered
                        .filter((item) => item.group === group.value)
                        .map((item) => (
                          <WorkCard
                            key={item.key}
                            item={item}
                            selected={selectedKey === item.key}
                            onSelect={() => selectWork(item)}
                          />
                        ))}
                    </section>
                  ))}
              </div>
            ) : (
              <div className="symphony-table-scroll">
                <table className="symphony-table">
                  <thead>
                    <tr>
                      <th>Issue</th>
                      <th>Runtime</th>
                      <th>Issue state</th>
                      <th>Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr
                        key={item.key}
                        className={
                          selectedKey === item.key ? "selected" : undefined
                        }
                      >
                        <td>
                          <button
                            type="button"
                            aria-label={`${item.identifier}: ${item.title}`}
                            aria-pressed={selectedKey === item.key}
                            data-symphony-work-key={item.key}
                            onClick={() => selectWork(item)}
                          >
                            <span>{item.identifier}</span>
                            <strong>{item.title}</strong>
                          </button>
                        </td>
                        <td>
                          <SymphonyRuntimeStatus item={item} />
                          {item.runtime?.error && (
                            <span className="symphony-table-reason">
                              {item.runtime.error}
                            </span>
                          )}
                        </td>
                        <td>
                          <NativeState item={item} />
                        </td>
                        <td>
                          {relativeSymphonyTime(
                            item.runtime?.lastEventAt ??
                              item.runtime?.startedAt ??
                              null,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {native.issues.hasNextPage && (
              <button
                type="button"
                className="load-more"
                disabled={native.issues.isFetchingNextPage}
                onClick={() => void native.issues.fetchNextPage()}
              >
                {native.issues.isFetchingNextPage
                  ? "Loading issues…"
                  : "Load more issues"}
              </button>
            )}
          </div>
          {detail && (
            <WorkDetails
              key={selectionKey}
              selectionKey={selectionKey!}
              host={host}
              connection={connection}
              item={detail}
              generation={native.generation}
              observedAt={snapshot.data?.fetchedAt ?? new Date().toISOString()}
              visible={visible}
              disappeared={!selectedItem}
              onClose={() => selectWork(null)}
            />
          )}
        </div>
      )}
      {editor && (
        <SymphonyConnectionEditor
          key={editor === "new" ? "new" : editor.id}
          host={host}
          connection={editor === "new" ? undefined : editor}
          onSave={saveConnection}
          onRemove={editor === "new" ? undefined : removeConnection}
          onClose={() => setEditor(null)}
        />
      )}
    </main>
  );
}
