import { AsyncState } from "./AsyncState";
import { WorkspaceLayout, WorkspaceHeader } from "./WorkspaceLayout";
import { RefreshFailure } from "./RefreshFailure";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowRotateCw,
  DotsHorizontalMoreMenu,
  Filter,
  MagnifyingGlassSearch,
} from "@openai/apps-sdk-ui/components/Icon";
import type { ArcoHost } from "../shared/contracts";
import type {
  LinearConnection,
  LinearIssue,
  LinearMetadata,
  LinearPage,
  LinearRef,
  LinearSavedReceipt,
  LinearScope,
  LinearScopes,
} from "../shared/linear";
import {
  useLinearSettings,
  linearScopeKey,
  defaultLinearFilter,
  type LinearFilter,
} from "./useLinearSettings";
import { LinearBulkActions } from "./LinearBulkActions";
import { LinearDetail } from "./LinearDetail";
import { SingleSelect } from "./SingleSelect";
import {
  InlineSkeleton,
  IssueDetailSkeleton,
  IssueListSkeleton,
  WorkspaceSkeleton,
} from "./LoadingSkeleton";
import { selectionIssueData, isTextSelectionClick } from "./SelectionShare";
import { isSavedReceipt } from "./linear-run";
import "./linear.css";
import {
  useCommandSession,
  useSessionRef,
  useSessionState,
} from "./session-state";
import { useHostView } from "./HostProvider";
import { Notice, type NoticeValue } from "./Notice";
import { LinearCreateIssue } from "./LinearCreateIssue";
import { InlineSummaryCard } from "./InlineSummaryCard";
import { isIssueUrlInput, linearIssueUrl } from "../shared/issue-url";
import { DisclosureSummary } from "./DisclosureSummary";
import { useIssueListContinuation } from "./useIssueListContinuation";
import {
  linearCommentChangesKey,
  type LinearCommentChanges,
} from "./linear-comments";

export const linearRef = (issue: LinearRef): LinearRef => ({
  connectionId: issue.connectionId,
  workspaceId: issue.workspaceId,
  teamId: issue.teamId,
  issueId: issue.issueId,
});
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const linearDataKeys = new Set([
  "linear-scopes",
  "linear-metadata",
  "linear-templates",
  "linear-issues",
  "linear-issue",
  "linear-comments",
  "linear-comment-changes",
]);

export function LinearWorkspace({
  host,
  onSourceChange,
}: {
  host: ArcoHost;
  onSourceChange: (source: "github" | "linear") => void;
}) {
  const cache = useQueryClient();
  const settings = useLinearSettings(host);
  const [teamOverride, setTeamOverride] = useSessionState(
    host,
    "linear:teamOverride",
    () => {
      const shared = host.sharedIssue?.();
      return shared?.source === "linear" ? shared.teamId : "";
    },
  );
  const [selected, setSelected] = useSessionState<LinearRef | null>(
    host,
    "linear:selected",
    () => {
      const shared = host.sharedIssue?.();
      return shared?.source === "linear" ? linearRef(shared) : null;
    },
  );
  const { mode, sharedIssue: sharedContext } = useHostView();
  const shared =
    sharedContext?.source === "linear" ? linearRef(sharedContext) : null;
  const [localFilters, setLocalFilters] = useSessionState<
    Record<string, LinearFilter>
  >(host, "linear:localFilters", {});
  const filtersRef = useSessionRef<Record<string, LinearFilter>>(
    host,
    "linear:filtersRef",
    {},
  );
  const selectionByScope = useSessionRef(
    host,
    "linear:selectionByScope",
    new Map<string, LinearRef>(),
  );
  const [showDetail, setShowDetail] = useSessionState(
    host,
    "linear:showDetail",
    false,
  );
  const [notice, setNoticeValue] = useSessionState<NoticeValue | null>(
    host,
    "linear:notice",
    null,
  );
  const setNotice = (text: string, kind: NoticeValue["kind"] = "success") =>
    setNoticeValue(text ? { text, kind } : null);
  const [receipt, setReceipt] = useSessionState<
    (LinearSavedReceipt & { requestId: string }) | null
  >(host, "linear:receipt", null);
  const { busy, setBusy, lock, requests } = useCommandSession(host, "linear");
  const [disconnecting, setDisconnecting] = useSessionState(
    host,
    "linear:disconnecting",
    false,
  );
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [searchEntry, setSearchEntry] = useSessionState<string | null>(
    host,
    "linear:searchEntry",
    null,
  );
  const [searchError, setSearchError] = useSessionState(
    host,
    "linear:searchError",
    "",
  );
  const [urlBusy, setUrlBusy] = useSessionState(host, "linear:urlBusy", false);
  const urlRequest = useRef(0);
  useEffect(
    () => () => {
      urlRequest.current += 1;
      setUrlBusy(false);
    },
    [setUrlBusy],
  );
  const list = useRef<HTMLDivElement>(null);
  const positions = useSessionRef(
    host,
    "linear:positions",
    new Map<string, number>(),
  );
  const restoredScope = useRef<string | null>(null);
  const [bulk, setBulk] = useSessionState<string[]>(host, "linear:bulk", []);
  const selectedStateTypes = useSessionRef(
    host,
    "linear:selectedStateTypes",
    new Map<string, string>(),
  );
  const [createOpen, setCreateOpen] = useSessionState(
    host,
    "linear:createOpen",
    false,
  );
  const [clientId, setClientId] = useSessionState(
    host,
    "linear:clientId",
    "210cd7ed4e0167355328ba0bb627b38c",
  );
  const [authPending, setAuthPending] = useSessionState(
    host,
    "linear:authPending",
    false,
  );
  const connection = useQuery({
    queryKey: ["linear-connection"],
    queryFn: () => host.call<LinearConnection>("linear_connection", {}),
    enabled: !disconnecting,
  });
  const connected = connection.data?.connected === true;
  const canRead = connected && !disconnecting;
  const auth = useQuery({
    queryKey: ["linear-auth"],
    queryFn: () =>
      host.call<{ state: string; message: string }>("linear_auth_status", {}),
    enabled: !disconnecting,
    refetchInterval: authPending && !disconnecting ? 2000 : false,
  });
  useEffect(() => {
    if (!disconnecting && auth.data?.state === "connected") {
      setAuthPending(false);
      void cache.invalidateQueries({ queryKey: ["linear-connection"] });
    }
  }, [auth.data?.state, cache, disconnecting, setAuthPending]);
  const scopes = useQuery({
    queryKey: [
      "linear-scopes",
      connection.data?.connectionId,
      connection.data?.workspace?.id,
      connection.data?.userId,
    ],
    queryFn: () =>
      host.call<LinearScopes>("linear_scopes", {
        connectionId: connection.data!.connectionId,
      }),
    enabled: canRead,
  });
  const savedTeam = settings.query.data?.settings.activeLinearTeam;
  const teamId =
    (scopes.data?.teams.some((team) => team.id === teamOverride)
      ? teamOverride
      : undefined) ||
    (scopes.data?.teams.some((team) => team.id === savedTeam)
      ? savedTeam
      : undefined) ||
    scopes.data?.teams[0]?.id ||
    "";
  const scope: LinearScope | null = useMemo(
    () =>
      connected &&
      scopes.data &&
      scopes.data.workspace.id === connection.data?.workspace?.id &&
      teamId
        ? {
            connectionId: connection.data?.connectionId ?? "default",
            workspaceId: scopes.data.workspace.id,
            teamId,
          }
        : null,
    [
      connected,
      scopes.data,
      teamId,
      connection.data?.connectionId,
      connection.data?.workspace?.id,
    ],
  );
  const scopeId = scope ? linearScopeKey(scope) : "";
  const currentFilter =
    localFilters[scopeId] ??
    settings.query.data?.settings.linearFilters[scopeId] ??
    defaultLinearFilter;
  const { query, ...filters } = currentFilter;
  const updateFilter = (patch: Partial<LinearFilter>) => {
    const next = {
      ...(filtersRef.current[scopeId] ?? currentFilter),
      ...patch,
    };
    filtersRef.current = { ...filtersRef.current, [scopeId]: next };
    setLocalFilters(filtersRef.current);
    if (scope) settings.saveFilter(scope, next);
  };
  const setQuery = (query: string) => updateFilter({ query });
  const setFilters = (
    update: (
      current: Omit<LinearFilter, "query">,
    ) => Omit<LinearFilter, "query">,
  ) => {
    const current = filtersRef.current[scopeId] ?? currentFilter;
    updateFilter(
      update({
        stateId: current.stateId,
        assigneeId: current.assigneeId,
        labelId: current.labelId,
        projectId: current.projectId,
        order: current.order,
      }),
    );
  };
  const metadata = useQuery({
    queryKey: ["linear-metadata", scope],
    queryFn: () => host.call<LinearMetadata>("linear_metadata", { ...scope }),
    enabled: canRead && Boolean(scope),
  });
  const pageScope = JSON.stringify([scope, query, filters]);
  const issues = useInfiniteQuery<
    LinearPage,
    Error,
    InfiniteData<LinearPage>,
    readonly unknown[],
    string | undefined
  >({
    queryKey: ["linear-issues", pageScope],
    // Replaying a scrolled list grows with every loaded page. Refresh still
    // updates the complete list when more than one page has been opened.
    refetchInterval: (query) =>
      canRead &&
      mode === "fullscreen" &&
      query.state.data?.pages.length === 1 &&
      query.state.status !== "error"
        ? 30_000
        : false,
    refetchOnWindowFocus: (query) =>
      canRead &&
      mode === "fullscreen" &&
      query.state.data?.pages.length === 1 &&
      query.state.status !== "error",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      host.call<LinearPage>(
        "linear_list_issues",
        {
          ...scope,
          query,
          ...Object.fromEntries(
            Object.entries(filters).filter(([, value]) => value),
          ),
          ...(pageParam ? { cursor: pageParam } : {}),
        },
        { signal },
      ),
    getNextPageParam: (last) =>
      last.hasMore ? (last.cursor ?? undefined) : undefined,
    enabled: canRead && Boolean(scope) && !settings.query.isPending,
  });
  const rows = useMemo(
    () => issues.data?.pages.flatMap((page) => page.issues) ?? [],
    [issues.data],
  );
  const loadMoreIssues = useIssueListContinuation({
    listRef: list,
    scope: pageScope,
    enabled: canRead && mode === "fullscreen",
    hasNextPage: issues.hasNextPage,
    isFetching: issues.isFetching,
    isError: issues.isError,
    pageCount: issues.data?.pages.length ?? 0,
    loadNext: () => issues.fetchNextPage({ cancelRefetch: false }),
  });
  const matchesConnection = (ref: LinearRef | null) =>
    ref?.connectionId === connection.data?.connectionId &&
    ref?.workspaceId === connection.data?.workspace?.id;
  const active = connected
    ? matchesConnection(selected)
      ? selected
      : rows[0]
        ? linearRef(rows[0])
        : null
    : null;
  const detail = useQuery({
    queryKey: ["linear-issue", active],
    refetchInterval:
      canRead && (mode === "fullscreen" || !shared) ? 30_000 : false,
    queryFn: ({ signal }) =>
      host.call<LinearIssue>(
        "linear_get_issue",
        { ...active },
        { signal, priority: "background" },
      ),
    enabled: canRead && Boolean(active),
  });
  const sharedIssue = useQuery({
    queryKey: ["linear-issue", shared],
    refetchInterval:
      canRead && matchesConnection(shared) && mode !== "fullscreen" && shared
        ? 30_000
        : false,
    queryFn: ({ signal }) =>
      host.call<LinearIssue>(
        "linear_get_issue",
        { ...shared },
        { signal, priority: "background" },
      ),
    enabled: canRead && Boolean(shared) && matchesConnection(shared),
  });
  const detailScope = useMemo(
    () =>
      active
        ? {
            connectionId: active.connectionId,
            workspaceId: active.workspaceId,
            teamId: active.teamId,
          }
        : null,
    [active],
  );
  const detailMetadata = useQuery({
    queryKey: ["linear-metadata", detailScope],
    queryFn: () =>
      host.call<LinearMetadata>("linear_metadata", { ...detailScope }),
    enabled: canRead && Boolean(detailScope),
  });
  const retained = shared
    ? matchesConnection(shared)
      ? sharedIssue.data
      : undefined
    : detail.data;
  useEffect(() => {
    if (canRead && !selected && rows[0]) setSelected(linearRef(rows[0]));
  }, [canRead, selected, rows, setSelected]);
  useLayoutEffect(() => {
    if (!issues.isSuccess || !list.current) {
      restoredScope.current = null;
      return;
    }
    const scopeKey = `${mode}:${pageScope}`;
    if (restoredScope.current !== scopeKey) {
      list.current.scrollTop = positions.current.get(pageScope) ?? 0;
      restoredScope.current = scopeKey;
    }
  }, [pageScope, issues.isSuccess, mode, positions]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            "input,textarea,select,[contenteditable=true],[role=dialog],[role=button]",
          )) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.key === "Escape") setShowDetail(false);
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const index = rows.findIndex(
          (issue) => issue.issueId === active?.issueId,
        );
        const next =
          rows[
            Math.max(
              0,
              Math.min(rows.length - 1, index + (event.key === "j" ? 1 : -1)),
            )
          ];
        if (next) {
          setSelected(linearRef(next));
          setShowDetail(true);
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [rows, active, setSelected, setShowDetail]);
  async function run<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T | LinearSavedReceipt | undefined> {
    if (lock.current || !connected) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    const key = JSON.stringify([name, args]);
    const requestId = requests.get(key) ?? crypto.randomUUID();
    requests.set(key, requestId);
    try {
      const result = await host.call<T | LinearSavedReceipt>(name, {
        ...args,
        requestId,
      });
      requests.delete(key);
      if (isSavedReceipt(result)) {
        const saved = { ...result, requestId };
        setReceipt(saved);
        setSelected(linearRef(result));
        setShowDetail(true);
        void cache.invalidateQueries({ queryKey: ["linear-issue"] });
        void cache.invalidateQueries({ queryKey: ["linear-issues"] });
        return result;
      }
      if (
        result &&
        typeof result === "object" &&
        "source" in result &&
        result.source === "linear" &&
        "issueId" in result
      ) {
        const issue = result as unknown as LinearIssue;
        cache.setQueryData(["linear-issue", linearRef(issue)], issue);
        if (issue.changedComment || issue.deletedCommentId)
          cache.setQueryData<LinearCommentChanges>(
            linearCommentChangesKey(issue),
            (current = {}) => ({
              ...current,
              ...(issue.changedComment
                ? { [issue.changedComment.id]: issue.changedComment }
                : {}),
              ...(issue.deletedCommentId
                ? { [issue.deletedCommentId]: null }
                : {}),
            }),
          );
      }
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["linear-issue"] }),
        cache.invalidateQueries({ queryKey: ["linear-comments"] }),
        cache.invalidateQueries({ queryKey: ["linear-issues"] }),
        cache.invalidateQueries({ queryKey: ["linear-metadata"] }),
      ]);
      setNotice(
        connection.data?.mode === "fixture"
          ? "Updated and refetched Linear fixture."
          : "Saved to Linear and refetched.",
      );
      return result;
    } catch (error) {
      setNotice(message(error), "error");
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["linear-issue"] }),
        cache.invalidateQueries({ queryKey: ["linear-issues"] }),
        cache.invalidateQueries({ queryKey: ["linear-metadata"] }),
      ]);
      return undefined;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function hostAction(action: () => Promise<void>, success: string) {
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setNotice(message(error), "error");
    }
  }
  function disconnected(connectionId: string) {
    cache.setQueryData<LinearConnection>(["linear-connection"], {
      connectionId,
      connected: false,
      mode: "linear",
      account: null,
      userId: null,
      workspace: null,
      message: "Authorize Arco with Linear to connect.",
    });
    cache.setQueryData(["linear-auth"], {
      state: "idle",
      connected: false,
      message: "",
    });
    cache.removeQueries({
      predicate: (entry) => linearDataKeys.has(String(entry.queryKey[0])),
    });
    setAuthPending(false);
    setTeamOverride("");
    setSelected(null);
    setShowDetail(false);
    setCreateOpen(false);
    setBulk([]);
    setReceipt(null);
    selectionByScope.current.clear();
    selectedStateTypes.current.clear();
    setNotice(
      "Disconnected Linear on this device. Your drafts and chat context are preserved.",
    );
  }
  async function disconnect() {
    if (lock.current || connection.data?.mode === "fixture") return;
    lock.current = true;
    setBusy(true);
    setDisconnecting(true);
    setNotice("");
    urlRequest.current += 1;
    setUrlBusy(false);
    setSearchEntry(null);
    setSearchError("");
    const connectionId = connection.data?.connectionId ?? "default";
    try {
      await cache.cancelQueries({
        predicate: (entry) => String(entry.queryKey[0]).startsWith("linear-"),
      });
      const result = await host.call<{ disconnected: boolean }>(
        "linear_auth_disconnect",
        { connectionId, revoke: false },
      );
      if (!result.disconnected)
        throw new Error("Linear disconnection was not confirmed.");
      disconnected(connectionId);
    } catch (error) {
      // The local credential may already be gone if the acknowledgement was lost.
      const status = await host
        .call<{ connected: boolean }>("linear_auth_status", { connectionId })
        .catch(() => null);
      if (status?.connected === false) disconnected(connectionId);
      else setNotice(message(error), "error");
    } finally {
      lock.current = false;
      setDisconnecting(false);
      setBusy(false);
      accountMenu.current?.querySelector("summary")?.focus();
    }
  }
  const changeMode = (value: "inline" | "fullscreen") => {
    capturePosition();
    return hostAction(async () => {
      await host.display(value);
    }, "Display mode updated.");
  };
  const openRetainedDetails = () => {
    if (retained) {
      setSelected(linearRef(retained));
      setShowDetail(true);
    }
    void changeMode("fullscreen");
  };
  const capturePosition = () => {
    if (
      list.current &&
      issues.isSuccess &&
      restoredScope.current === `${mode}:${pageScope}`
    )
      positions.current.set(pageScope, list.current.scrollTop);
  };
  const openIssueUrl = async (value: string) => {
    const request = ++urlRequest.current;
    setUrlBusy(true);
    setSearchError("");
    try {
      linearIssueUrl(value);
      if (lock.current)
        throw new Error(
          "Wait for the current change before opening another issue.",
        );
      const resolved = await host.call<LinearRef>("linear_resolve_issue", {
        connectionId: connection.data?.connectionId ?? "default",
        url: value,
      });
      if (request !== urlRequest.current) return;
      const issue = await host.call<LinearIssue>("linear_get_issue", {
        ...resolved,
      });
      if (request !== urlRequest.current) return;
      if (
        issue.issueId !== resolved.issueId ||
        issue.teamId !== resolved.teamId ||
        issue.workspaceId !== resolved.workspaceId ||
        issue.connectionId !== resolved.connectionId
      )
        throw new Error(
          "Linear returned a different issue than the resolved URL.",
        );
      capturePosition();
      if (selected && scope) selectionByScope.current.set(scopeId, selected);
      cache.setQueryData(["linear-issue", resolved], issue);
      setTeamOverride(resolved.teamId);
      setSelected(resolved);
      settings.selectTeam(
        resolved,
        scopes.data?.teams.find((team) => team.id === resolved.teamId)?.name ??
          resolved.teamId,
      );
      setShowDetail(true);
      setSearchEntry(null);
    } catch (error) {
      if (request === urlRequest.current) setSearchError(message(error));
    } finally {
      if (request === urlRequest.current) setUrlBusy(false);
    }
  };

  const detailFeedback = (
    <>
      {connection.data?.mode === "fixture" && (
        <div className="fixture-banner">
          LOCAL LINEAR FIXTURE · No writes to Linear
        </div>
      )}
      {connected && (
        <Notice
          notice={notice}
          onDismiss={() => setNoticeValue(null)}
          dismissLabel="Dismiss Linear notice"
        />
      )}
      {receipt && (
        <section
          className="notice linear-saved-receipt"
          aria-label="Saved Linear receipt"
          role="status"
        >
          <div>
            <strong>Saved in Linear</strong>
            <p>{receipt.message}</p>
            <p>
              Issue ID: {receipt.issueId}
              {receipt.commentId ? ` · Comment ID: ${receipt.commentId}` : ""}
            </p>
            <details>
              <DisclosureSummary>Request receipt</DisclosureSummary>
              <code>{receipt.requestId}</code>
            </details>
            <button
              className="text-button"
              onClick={() => {
                setSelected(linearRef(receipt));
                setShowDetail(true);
                void cache.invalidateQueries({ queryKey: ["linear-issue"] });
                void cache.invalidateQueries({ queryKey: ["linear-issues"] });
              }}
            >
              Check saved issue
            </button>
          </div>
          <button
            className="icon-button"
            aria-label="Dismiss saved Linear receipt"
            onClick={() => {
              setReceipt(null);
            }}
          >
            ×
          </button>
        </section>
      )}
      {detail.data && (
        <RefreshFailure
          error={detail.error}
          pending={detail.isFetching}
          onRetry={() => void detail.refetch()}
        />
      )}
    </>
  );

  const checkingConnection = connection.isPending && !connection.data;
  const detailLoading =
    !detail.data &&
    canRead &&
    ((Boolean(active) && detail.isPending) ||
      (!active && Boolean(scope) && issues.isPending));
  const resolvingWorkspace =
    canRead && ((scopes.isPending && !scopes.data) || settings.query.isPending);
  if (checkingConnection || resolvingWorkspace)
    return (
      <WorkspaceSkeleton
        mode={mode}
        label={
          checkingConnection
            ? "Checking Linear connection"
            : "Loading Linear workspace"
        }
      />
    );

  if (
    mode !== "fullscreen" &&
    connected &&
    !retained &&
    ((shared && matchesConnection(shared) && sharedIssue.isPending) ||
      (!shared && active && detail.isPending) ||
      (!active && scope && issues.isPending))
  )
    return <InlineSkeleton />;

  if (mode !== "fullscreen" && connection.data?.connected && retained)
    return (
      <InlineSummaryCard
        issue={retained}
        shared={Boolean(shared)}
        busy={shared ? sharedIssue.isFetching : detail.isFetching}
        onOpen={openRetainedDetails}
        expandLabel="Expand Linear view"
        notice={notice}
      />
    );
  if (mode !== "fullscreen") {
    const failure =
      connection.error ||
      scopes.error ||
      sharedIssue.error ||
      detail.error ||
      issues.error;
    return (
      <main className="arco compact-mode inline-mode">
        <div className="compact-top">
          <strong>Arco · Linear</strong>
        </div>
        <h1>
          {failure
            ? "Could not load Linear"
            : !connected
              ? "Connect Linear"
              : !scope
                ? "No Linear teams available"
                : "Select a Linear Issue"}
        </h1>
        <p className="muted" role={failure ? "alert" : undefined}>
          {failure
            ? message(failure)
            : "Open the workspace to connect Linear or browse your issues."}
        </p>
        <Button
          color="secondary"
          variant="outline"
          size="sm"
          onClick={openRetainedDetails}
        >
          Open details
        </Button>
        <Notice
          notice={notice}
          onDismiss={() => setNoticeValue(null)}
          dismissLabel="Dismiss Linear notice"
        />
      </main>
    );
  }
  return (
    <WorkspaceLayout source="linear" detailOpen={showDetail}>
      <aside className="issue-sidebar" aria-label="Linear Issue list">
        <WorkspaceHeader
          source="linear"
          onSourceChange={(next) => {
            capturePosition();
            onSourceChange(next);
          }}
          onCreate={() => setCreateOpen(true)}
          createDisabled={!scope || busy}
          createLabel="Create Linear Issue"
        />
        {!connection.data?.connected ? (
          <div className="list-message">
            <strong>Connect Linear</strong>
            <p>
              {connection.error
                ? message(connection.error)
                : connection.data?.message || "Checking Linear authorization."}
            </p>
            <p>
              Enter the Arco OAuth client ID. Credentials are stored in your OS
              credential store.
            </p>
            <label>
              OAuth client ID
              <input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              />
            </label>
            <Button
              color="primary"
              disabled={!clientId || busy}
              onClick={() =>
                void hostAction(async () => {
                  const result = await host.call<{ authorizationUrl: string }>(
                    "linear_auth_begin",
                    { connectionId: "default", clientId },
                  );
                  await host.openLink(result.authorizationUrl);
                  setAuthPending(true);
                }, "Opened Linear authorization. Review the workspace and permissions.")
              }
            >
              Authorize in Linear
            </Button>
            <p>{auth.data?.message}</p>
            <Notice
              notice={notice}
              onDismiss={() => setNoticeValue(null)}
              dismissLabel="Dismiss Linear notice"
            />
            <button
              className="text-button"
              onClick={() => {
                void connection.refetch();
                void auth.refetch();
              }}
            >
              Check connection
            </button>
          </div>
        ) : !scopes.data && scopes.isError ? (
          <div className="list-message" role="alert">
            <strong>Could not load Linear teams</strong>
            <p>{message(scopes.error)}</p>
            <Button
              color="secondary"
              variant="outline"
              disabled={scopes.isFetching}
              onClick={() => void scopes.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : !scope ? (
          <div className="list-message">
            <strong>No Linear teams available</strong>
            <p>Arco could not find an accessible team in this workspace.</p>
            <Button
              color="secondary"
              variant="outline"
              disabled={scopes.isFetching}
              onClick={() => void scopes.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            {scopes.isError && (
              <div className="list-message" role="alert">
                <p>Could not refresh Linear teams. {message(scopes.error)}</p>
                <button
                  className="text-button"
                  disabled={scopes.isFetching}
                  onClick={() => void scopes.refetch()}
                >
                  Retry refresh
                </button>
              </div>
            )}
            <label className="linear-team scope-picker">
              <span className="scope-label">
                {scopes.data?.workspace.name || "Workspace"}
              </span>
              <SingleSelect
                className="scope-select"
                label="Linear Team"
                value={teamId}
                disabled={busy}
                options={(scopes.data?.teams ?? []).map((team) => ({
                  value: team.id,
                  label: `${team.name} · ${team.key}`,
                }))}
                onChange={(value) => {
                  urlRequest.current += 1;
                  setUrlBusy(false);
                  setSearchEntry(null);
                  setSearchError("");
                  capturePosition();
                  if (selected && scope)
                    selectionByScope.current.set(scopeId, selected);
                  const nextScope = scope ? { ...scope, teamId: value } : null;
                  setTeamOverride(value);
                  setSelected(
                    nextScope
                      ? (selectionByScope.current.get(
                          linearScopeKey(nextScope),
                        ) ?? null)
                      : null,
                  );
                  if (nextScope)
                    settings.selectTeam(
                      nextScope,
                      scopes.data?.teams.find(
                        (team) => team.id === nextScope.teamId,
                      )?.name ?? nextScope.teamId,
                    );
                  setBulk([]);
                  setShowDetail(false);
                }}
              />
            </label>
            <div className="search-control" aria-busy={urlBusy}>
              <MagnifyingGlassSearch aria-hidden="true" />
              <input
                ref={search}
                aria-label="Search Linear Issues"
                value={searchEntry ?? query}
                aria-describedby={
                  searchError ? "linear-search-error" : undefined
                }
                onChange={(event) => {
                  urlRequest.current += 1;
                  setUrlBusy(false);
                  setSearchError("");
                  capturePosition();
                  const value = event.target.value;
                  if (isIssueUrlInput(value)) setSearchEntry(value);
                  else {
                    setSearchEntry(null);
                    setQuery(value);
                  }
                }}
                onPaste={(event) => {
                  const value = event.clipboardData.getData("text").trim();
                  if (isIssueUrlInput(value)) {
                    event.preventDefault();
                    setSearchEntry(value);
                    void openIssueUrl(value);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    isIssueUrlInput(event.currentTarget.value)
                  ) {
                    event.preventDefault();
                    void openIssueUrl(event.currentTarget.value.trim());
                  }
                }}
                placeholder="Search or paste issue URL…"
              />
              <kbd>/</kbd>
            </div>
            {searchError && (
              <p id="linear-search-error" className="inline-error" role="alert">
                {searchError}
              </p>
            )}
            <div className="list-filter">
              <label className="state-select">
                <span className="sr-only">Workflow state</span>
                <SingleSelect
                  label="Linear workflow state"
                  value={filters.stateId}
                  options={[
                    { value: "", label: "All workflow states" },
                    ...(metadata.data?.states ?? []).map((state) => ({
                      value: state.id,
                      label: state.name,
                    })),
                  ]}
                  onChange={(value) => {
                    capturePosition();
                    setFilters((previous) => ({
                      ...previous,
                      stateId: value,
                    }));
                  }}
                />
              </label>
              <button
                className="icon-button"
                aria-label="Refresh Linear"
                title="Refresh issues"
                disabled={issues.isFetching}
                onClick={() =>
                  void cache.invalidateQueries({
                    predicate: (entry) =>
                      String(entry.queryKey[0]).startsWith("linear-"),
                  })
                }
              >
                <ArrowRotateCw aria-hidden="true" />
              </button>
            </div>
            <details className="linear-filters sidebar-filters">
              <DisclosureSummary>
                <Filter aria-hidden="true" />
                Filters
              </DisclosureSummary>
              {(["assigneeId", "labelId", "projectId"] as const).map((key) => (
                <label key={key}>
                  {
                    {
                      assigneeId: "Assignee",
                      labelId: "Labels",
                      projectId: "Project",
                    }[key]
                  }
                  <SingleSelect
                    label={
                      {
                        assigneeId: "Assignee",
                        labelId: "Labels",
                        projectId: "Project",
                      }[key]
                    }
                    value={filters[key]}
                    options={[
                      { value: "", label: "All" },
                      ...(
                        (key === "assigneeId"
                          ? metadata.data?.members
                          : key === "labelId"
                            ? metadata.data?.labels.filter(
                                (label) => !label.isGroup,
                              )
                            : metadata.data?.projects) ?? []
                      ).map((item) => ({ value: item.id, label: item.name })),
                    ]}
                    onChange={(value) => {
                      capturePosition();
                      setFilters((previous) => ({
                        ...previous,
                        [key]: value,
                      }));
                    }}
                  />
                </label>
              ))}
              <label>
                Sort
                <SingleSelect
                  label="Sort"
                  value={filters.order}
                  options={[
                    { value: "updatedAt", label: "Recently updated" },
                    { value: "createdAt", label: "Recently created" },
                  ]}
                  onChange={(value) => {
                    capturePosition();
                    setFilters((previous) => ({
                      ...previous,
                      order: value === "createdAt" ? "createdAt" : "updatedAt",
                    }));
                  }}
                />
              </label>
              <p>
                Search within the selected team. Workflow states and properties
                come from Linear.
              </p>
            </details>
            <div className="list-caption">
              <span>
                {issues.isFetching
                  ? "Loading…"
                  : `${rows.length}${issues.hasNextPage ? "+" : ""} Issues`}
              </span>
            </div>
            {bulk.length > 0 && scope && (
              <LinearBulkActions
                host={host}
                key={JSON.stringify(scope)}
                scope={scope}
                ids={bulk}
                metadata={metadata.data}
                hasDuplicate={bulk.some(
                  (id) =>
                    (rows.find((issue) => issue.issueId === id)?.state.type ??
                      selectedStateTypes.current.get(id)) === "duplicate",
                )}
                busy={busy}
                run={run}
                onClear={() => setBulk([])}
              />
            )}
            <div
              className="issue-list"
              ref={list}
              aria-busy={issues.isFetching}
              onScroll={() => {
                if (issues.isSuccess) capturePosition();
              }}
            >
              {issues.isPending && <IssueListSkeleton />}
              {rows.map((issue) => (
                <div className="linear-list-row" key={issue.issueId}>
                  <input
                    type="checkbox"
                    aria-label={`${issue.identifier} — select for bulk actions`}
                    checked={bulk.includes(issue.issueId)}
                    disabled={busy}
                    onChange={(event) => {
                      selectedStateTypes.current.set(
                        issue.issueId,
                        issue.state.type,
                      );
                      setBulk((previous) =>
                        event.target.checked
                          ? [...previous, issue.issueId]
                          : previous.filter((id) => id !== issue.issueId),
                      );
                    }}
                  />
                  <button
                    className={`issue-row ${active?.issueId === issue.issueId ? "selected" : ""}`}
                    data-arco-issue={selectionIssueData(issue)}
                    onClick={(event) => {
                      if (
                        event.detail > 0 &&
                        isTextSelectionClick(event.currentTarget)
                      )
                        return;
                      setSelected(linearRef(issue));
                      setShowDetail(true);
                    }}
                  >
                    <span style={{ color: issue.state.color }}>◉</span>
                    <span className="row-content">
                      <span className="row-title">{issue.title}</span>
                      <span className="row-meta">
                        {issue.identifier} · {issue.state.name}
                      </span>
                    </span>
                  </button>
                </div>
              ))}
              {issues.isError && !issues.isFetchNextPageError && (
                <AsyncState kind="error" className="list-message">
                  <p className="inline-error">{message(issues.error)}</p>
                  <button
                    className="text-button"
                    disabled={issues.isFetching}
                    onClick={() => void issues.refetch()}
                  >
                    Retry
                  </button>
                </AsyncState>
              )}
              {issues.isSuccess && !rows.length && (
                <AsyncState as="p" kind="empty" className="list-message">
                  No matching Issues.
                </AsyncState>
              )}
              {issues.isFetchNextPageError && (
                <p className="list-message inline-error" role="alert">
                  Could not load more issues: {message(issues.error)}
                </p>
              )}
              {issues.hasNextPage && (
                <button
                  className="load-more"
                  disabled={issues.isFetching}
                  onClick={loadMoreIssues}
                >
                  {issues.isFetchingNextPage ? "Loading…" : "Load more"}
                </button>
              )}
            </div>
          </>
        )}
        {(settings.query.isError || settings.error) && (
          <p className="inline-error settings-error" role="alert">
            Could not save Linear display settings:{" "}
            {settings.error || settings.query.error?.message}
          </p>
        )}
        <footer className="sidebar-footer sidebar-account">
          {connection.data?.mode === "fixture" ? (
            <span className="connection-line">
              <span className="connection-dot connected" />
              {connection.data.account} · Linear fixture
            </span>
          ) : (
            <details
              className="linear-account-menu"
              ref={accountMenu}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                event.preventDefault();
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }}
            >
              <summary
                className="connection-line"
                aria-label="Linear connection actions"
              >
                <span
                  className={`connection-dot ${connected ? "connected" : ""}`}
                />
                <span className="disclosure-label">
                  {connection.data?.account ||
                    (connection.isError
                      ? "Connection unavailable"
                      : "Disconnected")}
                </span>
                <DotsHorizontalMoreMenu aria-hidden="true" />
              </summary>
              <div className="detail-utility-menu">
                <button
                  className="utility-item"
                  disabled={
                    busy || (!connected && !authPending && !connection.isError)
                  }
                  onClick={() => {
                    if (accountMenu.current) accountMenu.current.open = false;
                    void disconnect();
                  }}
                >
                  Disconnect Linear
                </button>
              </div>
            </details>
          )}
        </footer>
      </aside>
      <section
        className="detail-pane"
        aria-label="Linear Issue details"
        aria-busy={(canRead && detail.isFetching) || detailLoading}
        data-arco-issue={
          connected && detail.data ? selectionIssueData(detail.data) : undefined
        }
      >
        {(!connected || !detail.data) && (
          <>
            <header className="detail-toolbar">
              <span className="toolbar-tab">Linear Issue</span>
            </header>
            {detailFeedback}
          </>
        )}
        {connected && detail.data ? (
          <LinearDetail
            key={`${detail.data.connectionId}/${detail.data.issueId}`}
            host={host}
            issue={detail.data}
            feedback={detailFeedback}
            shared={
              shared
                ? {
                    ...shared,
                    identifier: sharedIssue.data?.identifier ?? shared.issueId,
                  }
                : null
            }
            onBack={() => setShowDetail(false)}
            onFullscreen={() => void changeMode("fullscreen")}
            metadata={detailMetadata.data}
            metadataError={detailMetadata.error}
            connection={connection.data}
            busy={busy}
            run={run}
            onNotice={setNotice}
          />
        ) : detailLoading ? (
          <IssueDetailSkeleton />
        ) : detail.isError && active ? (
          <div className="empty-state" role="alert">
            <strong>Could not load this issue</strong>
            <p>{message(detail.error)}</p>
            <Button
              color="secondary"
              variant="outline"
              onClick={() => void detail.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className="empty-state">
            <h1>Select a Linear Issue</h1>
            <p>Work with native workflow states and properties inside Codex.</p>
          </div>
        )}
      </section>
      {scope && (
        <LinearCreateIssue
          host={host}
          scope={scope}
          open={createOpen}
          busy={busy}
          notice={notice}
          workspaceName={scopes.data?.workspace.name ?? "Workspace"}
          teamName={
            scopes.data?.teams.find((team) => team.id === scope.teamId)?.name ??
            scope.teamId
          }
          metadata={metadata.data}
          run={run}
          onClose={() => setCreateOpen(false)}
          onCreated={(result) => {
            setSelected(linearRef(result));
            setShowDetail(true);
          }}
          onNotice={setNotice}
        />
      )}
    </WorkspaceLayout>
  );
}
