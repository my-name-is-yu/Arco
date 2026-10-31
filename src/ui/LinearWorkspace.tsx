import { AsyncState } from "./AsyncState";
import {
  WorkspaceLayout,
  WorkspaceHeader,
  WorkspaceIssueList,
} from "./WorkspaceLayout";
import { RefreshFailure } from "./RefreshFailure";
import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@openai/apps-sdk-ui/components/Button";
import {
  ArrowRotateCw,
  DotsHorizontalMoreMenu,
  Filter,
  MagnifyingGlassSearch,
} from "@openai/apps-sdk-ui/components/Icon";
import type { ArcoHost } from "../shared/contracts";
import type { DraftKey } from "../shared/state";
import type { LaunchContext } from "../shared/launch";
import type {
  LinearConnection,
  LinearIssue,
  LinearRef,
  LinearSavedReceipt,
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
import { IssueAssigneeVisual, IssueStateVisual } from "./IssuePropertyVisual";
import {
  InlineSkeleton,
  IssueDetailSkeleton,
  IssueListSkeleton,
  WorkspaceSkeleton,
} from "./LoadingSkeleton";
import { selectionIssueData, isTextSelectionClick } from "./selection-context";
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
import { LinearInlineProperties } from "./InlineIssueProperties";
import { draftController, draftStorageId } from "./useDraftPersistence";
import { resolveContentDraft } from "./content-drafts";
import { toggleMarkdownTask } from "./markdown-tasks";
import { isIssueUrlInput, linearIssueUrl } from "../shared/issue-url";
import { DisclosureSummary } from "./DisclosureSummary";
import { useListScroll, useListKeyboard } from "./useListInteraction";
import { useIssueListContinuation } from "./useIssueListContinuation";
import { useDebouncedSearch } from "./useDebouncedSearch";
import { useShortcuts } from "./keyboard-shortcuts";
import {
  linearRef,
  useLinearIssueList,
  useLinearIssue,
  useLinearMetadata,
  useLinearIssueCache,
} from "./linear-queries";

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
  launch,
  onSourceChange,
}: {
  host: ArcoHost;
  launch: LaunchContext;
  onSourceChange: (source: "github" | "linear") => void;
}) {
  const cache = useQueryClient();
  const issueCache = useLinearIssueCache();
  const settings = useLinearSettings(host);
  const target = launch.target?.source === "linear" ? launch.target : null;
  const [teamOverride, setTeamOverride] = useSessionState(
    host,
    "linear:teamOverride",
    () => {
      if (target) return target.teamId;
      const shared = host.sharedIssue();
      return shared?.source === "linear" ? shared.teamId : "";
    },
  );
  const [selected, setSelected] = useSessionState<LinearRef | null>(
    host,
    "linear:selected",
    () => {
      if (target) return linearRef(target);
      const shared = host.sharedIssue();
      return shared?.source === "linear" ? linearRef(shared) : null;
    },
  );
  const { mode, sharedIssue: sharedContext } = useHostView();
  const targetedInline = Boolean(target) && mode !== "fullscreen";
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
    Boolean(target),
  );
  const [notice, setNoticeValue] = useSessionState<NoticeValue | null>(
    host,
    "linear:notice",
    null,
  );
  const setNotice = (text: string, kind: NoticeValue["kind"] = "error") =>
    setNoticeValue(text ? { text, kind } : null);
  const [receipt, setReceipt] = useSessionState<
    (LinearSavedReceipt & { requestId: string }) | null
  >(host, "linear:receipt", null);
  const commands = useCommandSession(host, "linear");
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
  const [bulk, setBulk] = useSessionState<string[]>(host, "linear:bulk", []);
  const bulkIssueIds = useMemo(() => new Set(bulk), [bulk]);
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
  const connectionKey = target
    ? ["linear-connection", target.connectionId]
    : ["linear-connection"];
  const authKey = target
    ? ["linear-auth", target.connectionId]
    : ["linear-auth"];
  const connectionInput = target ? { connectionId: target.connectionId } : {};
  const connection = useQuery({
    queryKey: connectionKey,
    queryFn: () =>
      host.call<LinearConnection>("linear_connection", connectionInput),
    enabled: !disconnecting,
  });
  const lastDraftOwner = useRef<string | null>(null);
  const verifiedDraftOwner = connection.data?.connected
    ? connection.data.userId
    : null;
  if (verifiedDraftOwner) lastDraftOwner.current = verifiedDraftOwner;
  const draftOwnerId = connection.data?.connected
    ? verifiedDraftOwner
    : lastDraftOwner.current;
  const targetConnectionError =
    target &&
    connection.data?.connected &&
    (connection.data.connectionId !== target.connectionId ||
      connection.data.workspace?.id !== target.workspaceId)
      ? new Error("The connected Linear workspace does not match this issue.")
      : null;
  const connected =
    connection.data?.connected === true && !targetConnectionError;
  const canRead = connected && !disconnecting;
  const auth = useQuery({
    queryKey: authKey,
    queryFn: () =>
      host.call<{ state: string; message: string }>(
        "linear_auth_status",
        connectionInput,
      ),
    enabled: !disconnecting,
    refetchInterval: authPending && !disconnecting ? 2000 : false,
  });
  useEffect(() => {
    if (disconnecting || !authPending) return;
    if (auth.data?.state === "connected") {
      setAuthPending(false);
      void cache.invalidateQueries({ queryKey: ["linear-connection"] });
    } else if (auth.data?.state === "failed") setAuthPending(false);
  }, [auth.data?.state, authPending, cache, disconnecting, setAuthPending]);
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
    enabled: canRead && !targetedInline,
  });
  const requestedTeam =
    teamOverride || settings.query.data?.settings.activeLinearTeam || "";
  const teamId = scopes.data?.teams.some((team) => team.id === requestedTeam)
    ? requestedTeam
    : "";
  const scope = useMemo(
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
  const searchQuery = useDebouncedSearch(query, scopeId);
  const updateFilter = (patch: Partial<LinearFilter>) => {
    const next = {
      ...(filtersRef.current[scopeId] ?? currentFilter),
      ...patch,
    };
    filtersRef.current = { ...filtersRef.current, [scopeId]: next };
    setLocalFilters(filtersRef.current);
    if (scope) settings.saveFilter(scope, next);
  };
  const metadata = useLinearMetadata(
    host,
    scope,
    canRead && !targetedInline && Boolean(scope),
  );
  const pageScope = JSON.stringify([scope, searchQuery.query, filters]);
  const issues = useLinearIssueList(host, {
    scope,
    query: searchQuery.query,
    filters,
    enabled:
      canRead && !targetedInline && Boolean(scope) && !settings.query.isPending,
    autoRefresh: canRead && mode === "fullscreen",
  });
  const rows = useMemo(
    () => issues.data?.pages.flatMap((page) => page.issues) ?? [],
    [issues.data],
  );
  const rowStateTypes = useMemo(() => {
    const byId = new Map<string, LinearIssue["state"]["type"]>();
    for (const issue of rows)
      if (!byId.has(issue.issueId)) byId.set(issue.issueId, issue.state.type);
    return byId;
  }, [rows]);
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
      : target
        ? null
        : scope && rows[0]
          ? linearRef(rows[0])
          : null
    : null;
  const detail = useLinearIssue(
    host,
    active,
    canRead && !targetedInline && Boolean(active),
    canRead && (mode === "fullscreen" || !shared),
  );
  const sharedIssue = useLinearIssue(
    host,
    shared,
    canRead && !targetedInline && Boolean(shared) && matchesConnection(shared),
    canRead &&
      matchesConnection(shared) &&
      mode !== "fullscreen" &&
      Boolean(shared),
  );
  const targetIssue = useLinearIssue(
    host,
    target ? linearRef(target) : null,
    canRead && targetedInline,
    true,
  );
  const retained = target
    ? targetIssue.data
    : shared
      ? matchesConnection(shared)
        ? sharedIssue.data
        : undefined
      : detail.data;
  const sharedDisplay = shared
    ? [sharedIssue.data, detail.data, targetIssue.data, ...rows].find(
        (candidate) =>
          candidate?.issueId === shared.issueId &&
          candidate.connectionId === shared.connectionId &&
          candidate.workspaceId === shared.workspaceId &&
          candidate.teamId === shared.teamId,
      )
    : undefined;
  const toggleRetainedTask = async (line: number, checked: boolean) => {
    if (!retained || !draftOwnerId) return;
    const body = toggleMarkdownTask(retained.body, line, checked);
    if (body === retained.body) return;
    const key: DraftKey = {
      source: "linear",
      workspaceId: retained.workspaceId,
      teamId: retained.teamId,
      issue: retained.issueId,
      ownerId: draftOwnerId,
    };
    const controller = draftController(host);
    const draft = resolveContentDraft(retained, await controller.load(key));
    const status = controller.get()[draftStorageId(key)];
    if (
      status?.state === "error" ||
      status?.state === "conflict" ||
      status?.state === "resolving"
    ) {
      setNotice(
        "Open details to review the local draft before changing checklist items.",
        "error",
      );
      return;
    }
    if (draft.title !== retained.title || draft.body !== retained.body) {
      setNotice(
        "Open details to save or discard your title or description draft before changing checklist items.",
        "info",
      );
      return;
    }
    void run("linear_update_issue", {
      ...linearRef(retained),
      expectedUpdatedAt: retained.updatedAt,
      patch: { body },
    });
  };
  const metadataIssue = mode !== "fullscreen" ? retained : active;
  const detailScope = useMemo(
    () =>
      metadataIssue
        ? {
            connectionId: metadataIssue.connectionId,
            workspaceId: metadataIssue.workspaceId,
            teamId: metadataIssue.teamId,
          }
        : null,
    [metadataIssue],
  );
  const detailMetadata = useLinearMetadata(
    host,
    detailScope,
    canRead && Boolean(detailScope),
  );
  useEffect(() => {
    if (canRead && !selected && rows[0]) setSelected(linearRef(rows[0]));
  }, [canRead, selected, rows, setSelected]);
  const rememberListScroll = useListScroll({
    host,
    sessionKey: "linear:positions",
    listRef: list,
    scope: pageScope,
    mode,
    ready: issues.isSuccess,
  });
  const shortcuts = useShortcuts();
  const { goToList: focusIssueList, selectIssue } = useListKeyboard({
    rows,
    activeKey: active?.issueId ?? null,
    keyForRow: (issue) => issue.issueId,
    onSelect: (issue) => {
      urlRequest.current += 1;
      setUrlBusy(false);
      setSelected(linearRef(issue));
      setShowDetail(true);
    },
    onClose: () => {
      urlRequest.current += 1;
      setUrlBusy(false);
      setShowDetail(false);
    },
    onGoToList: () => {
      urlRequest.current += 1;
      setUrlBusy(false);
      if (mode !== "fullscreen") openRetainedDetails();
      setShowDetail(false);
    },
    mode,
    listRef: list,
    searchRef: search,
    searchEnabled: Boolean(scope),
  });
  async function run<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T | LinearSavedReceipt | undefined> {
    if (commands.lock.current || !connected) return;
    commands.lock.current = true;
    commands.setBusy(true);
    setNotice("");
    const key = JSON.stringify([name, args]);
    const requestId = commands.requests.get(key) ?? crypto.randomUUID();
    commands.requests.set(key, requestId);
    try {
      const result = await host.call<T | LinearSavedReceipt>(name, {
        ...args,
        requestId,
      });
      commands.requests.delete(key);
      if (isSavedReceipt(result)) {
        setReceipt({ ...result, requestId });
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
        issueCache.remember(issue);
      }
      await issueCache.refresh(true);
      return result;
    } catch (error) {
      setNotice(message(error), "error");
      await issueCache.refresh();
      return undefined;
    } finally {
      commands.lock.current = false;
      commands.setBusy(false);
    }
  }
  async function hostAction(action: () => Promise<void>) {
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(message(error), "error");
    }
  }
  function disconnected(connectionId: string) {
    cache.setQueryData<LinearConnection>(connectionKey, {
      connectionId,
      connected: false,
      mode: "linear",
      account: null,
      userId: null,
      workspace: null,
      message: "Authorize Arco with Linear to connect.",
    });
    cache.setQueryData(authKey, {
      state: "idle",
      connected: false,
      message: "",
    });
    cache.removeQueries({
      predicate: ({ queryKey }) =>
        linearDataKeys.has(String(queryKey[0])) ||
        (queryKey[0] === "source-image" &&
          queryKey[1] === "linear" &&
          queryKey[2] === connectionId),
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
  }
  async function disconnect() {
    if (commands.lock.current || connection.data?.mode === "fixture") return;
    commands.lock.current = true;
    commands.setBusy(true);
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
      commands.lock.current = false;
      setDisconnecting(false);
      commands.setBusy(false);
      accountMenu.current?.querySelector("summary")?.focus();
    }
  }
  const changeMode = (value: "inline" | "fullscreen") => {
    capturePosition();
    return hostAction(async () => {
      await host.display(value);
    });
  };
  const openRetainedDetails = () => {
    if (retained) {
      if (target) setTeamOverride(retained.teamId);
      setSelected(linearRef(retained));
      setShowDetail(true);
    }
    void changeMode("fullscreen");
  };
  const capturePosition = rememberListScroll;
  const openIssueUrl = async (value: string) => {
    const request = ++urlRequest.current;
    setUrlBusy(true);
    setSearchError("");
    try {
      linearIssueUrl(value);
      if (commands.lock.current)
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
          "Selected team",
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
      {targetConnectionError && (
        <p className="inline-error" role="alert">
          {targetConnectionError.message}
        </p>
      )}
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
            <details>
              <DisclosureSummary>Request receipt</DisclosureSummary>
              <p>Issue ID: {receipt.issueId}</p>
              {receipt.commentId && <p>Comment ID: {receipt.commentId}</p>}
              <p>
                Request ID: <code>{receipt.requestId}</code>
              </p>
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
            aria-label="Dismiss saved receipt"
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
    canRead &&
    ((!targetedInline && scopes.isPending && !scopes.data) ||
      settings.query.isPending);
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
    (targetedInline
      ? targetIssue.isPending
      : (shared && matchesConnection(shared) && sharedIssue.isPending) ||
        (!shared && active && detail.isPending) ||
        (!active && scope && issues.isPending))
  )
    return <InlineSkeleton />;

  if (mode !== "fullscreen" && connected && retained)
    return (
      <InlineSummaryCard
        host={host}
        issue={retained}
        busy={
          commands.busy ||
          (target
            ? targetIssue.isFetching
            : shared
              ? sharedIssue.isFetching
              : detail.isFetching)
        }
        onOpen={openRetainedDetails}
        onOpenLink={(url) => void hostAction(() => host.openLink(url))}
        onToggleTask={(line, checked) => void toggleRetainedTask(line, checked)}
        notice={notice}
        properties={
          <LinearInlineProperties
            issue={retained}
            currentUserId={connection.data?.userId}
            metadata={detailMetadata.data}
            metadataError={detailMetadata.error}
            busy={commands.busy}
            onRetry={() => void detailMetadata.refetch()}
            onSave={(name, args) => void run(name, args)}
          />
        }
      />
    );
  if (mode !== "fullscreen") {
    const failure =
      targetConnectionError ||
      (target ? targetIssue.error : null) ||
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
          createDisabled={!scope || commands.busy}
          createLabel="Create Linear Issue"
          actions={
            connection.data?.mode !== "fixture" && (
              <details
                className="detail-utilities"
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
                  aria-label="Linear connection actions"
                  title="Linear connection actions"
                >
                  <DotsHorizontalMoreMenu aria-hidden="true" />
                </summary>
                <div className="detail-utility-menu">
                  <button
                    className="utility-item"
                    disabled={
                      commands.busy ||
                      (!connected && !authPending && !connection.isError)
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
            )
          }
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
              disabled={!clientId || commands.busy}
              onClick={() =>
                void hostAction(async () => {
                  const result = await host.call<{ authorizationUrl: string }>(
                    "linear_auth_begin",
                    {
                      connectionId: target?.connectionId ?? "default",
                      clientId,
                    },
                  );
                  await host.openLink(result.authorizationUrl);
                  await cache.cancelQueries({ queryKey: authKey, exact: true });
                  cache.setQueryData(authKey, {
                    state: "pending",
                    message: "",
                  });
                  setAuthPending(true);
                })
              }
            >
              Authorize in Linear
            </Button>
            {auth.data?.state === "failed" ? (
              <p className="inline-error" role="alert">
                {auth.data.message}
              </p>
            ) : authPending ? (
              <p role="status">
                Complete authorization in Linear, then return to Arco.
              </p>
            ) : (
              auth.data?.message && <p>{auth.data.message}</p>
            )}
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
        ) : !scopes.data?.teams.length ? (
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
                disabled={commands.busy}
                options={[
                  { value: "", label: "Choose a team", disabled: true },
                  ...(scopes.data?.teams ?? []).map((team) => ({
                    value: team.id,
                    label: `${team.name} · ${team.key}`,
                  })),
                ]}
                onChange={(value) => {
                  urlRequest.current += 1;
                  setUrlBusy(false);
                  setSearchEntry(null);
                  setSearchError("");
                  capturePosition();
                  if (selected && scope)
                    selectionByScope.current.set(scopeId, selected);
                  const nextScope =
                    scopes.data &&
                    connection.data?.workspace?.id === scopes.data.workspace.id
                      ? {
                          connectionId: connection.data.connectionId,
                          workspaceId: scopes.data.workspace.id,
                          teamId: value,
                        }
                      : null;
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
                      )?.name ?? "Selected team",
                    );
                  setBulk([]);
                  setShowDetail(false);
                }}
              />
            </label>
            {!teamId && scopes.isSuccess && (
              <p
                className="list-message"
                role={requestedTeam ? "alert" : "status"}
              >
                {requestedTeam
                  ? "The selected Linear team is unavailable. Choose a team to continue."
                  : "Choose a Linear team to load its issues."}
              </p>
            )}
            {scope && (
              <>
                <div className="search-control" aria-busy={urlBusy}>
                  <MagnifyingGlassSearch aria-hidden="true" />
                  <input
                    ref={search}
                    aria-label="Search Linear Issues"
                    onCompositionStart={searchQuery.onCompositionStart}
                    onCompositionEnd={searchQuery.onCompositionEnd}
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
                      if (isIssueUrlInput(value)) {
                        setSearchEntry(value);
                        return;
                      }
                      setSearchEntry(null);
                      updateFilter({ query: value });
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
                  {shortcuts?.enabled && <kbd>/</kbd>}
                </div>
                {searchError && (
                  <p
                    id="linear-search-error"
                    className="inline-error"
                    role="alert"
                  >
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
                          leading: (
                            <IssueStateVisual
                              source="linear"
                              state={state.type}
                              color={state.color}
                            />
                          ),
                        })),
                      ]}
                      onChange={(value) => {
                        capturePosition();
                        updateFilter({ stateId: value });
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
                  {(["assigneeId", "labelId", "projectId"] as const).map(
                    (key) => (
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
                            ).map((item) => ({
                              value: item.id,
                              label: item.name,
                              leading:
                                key === "assigneeId" ? (
                                  <IssueAssigneeVisual name={item.name} />
                                ) : undefined,
                              color:
                                key === "labelId" && "color" in item
                                  ? String(item.color)
                                  : undefined,
                            })),
                          ]}
                          onChange={(value) => {
                            capturePosition();
                            updateFilter({ [key]: value });
                          }}
                        />
                      </label>
                    ),
                  )}
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
                        updateFilter({
                          order:
                            value === "createdAt" ? "createdAt" : "updatedAt",
                        });
                      }}
                    />
                  </label>
                </details>
                <div className="list-caption">
                  <span>
                    {issues.isFetching
                      ? "Loading…"
                      : `${rows.length}${issues.hasNextPage ? "+" : ""} Issues`}
                  </span>
                </div>
                <WorkspaceIssueList
                  ref={list}
                  busy={issues.isFetching}
                  onScroll={() => {
                    if (issues.isSuccess) capturePosition();
                  }}
                  bulkActions={
                    bulk.length > 0 &&
                    scope && (
                      <LinearBulkActions
                        host={host}
                        key={JSON.stringify(scope)}
                        scope={scope}
                        ids={bulk}
                        issues={rows}
                        metadata={metadata.data}
                        hasDuplicate={bulk.some(
                          (id) =>
                            (rowStateTypes.get(id) ??
                              selectedStateTypes.current.get(id)) ===
                            "duplicate",
                        )}
                        busy={commands.busy}
                        run={run}
                        onClear={() => setBulk([])}
                      />
                    )
                  }
                >
                  {issues.isPending && <IssueListSkeleton />}
                  {rows.map((issue) => (
                    <div className="linear-list-row" key={issue.issueId}>
                      <input
                        type="checkbox"
                        aria-label={`${issue.identifier} — select for bulk actions`}
                        checked={bulkIssueIds.has(issue.issueId)}
                        disabled={commands.busy}
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
                        aria-current={
                          active?.issueId === issue.issueId ? "true" : undefined
                        }
                        data-arco-issue={selectionIssueData(issue)}
                        onClick={(event) => {
                          if (
                            event.detail > 0 &&
                            isTextSelectionClick(event.currentTarget)
                          )
                            return;
                          selectIssue(issue);
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
                </WorkspaceIssueList>
              </>
            )}
          </>
        )}
        {(settings.query.isError || settings.error) && (
          <p className="inline-error settings-error" role="alert">
            Could not save Linear display settings:{" "}
            {settings.error || settings.query.error?.message}
            <button
              className="text-button"
              disabled={settings.pending}
              onClick={settings.retry}
            >
              Retry save
            </button>
          </p>
        )}
      </aside>
      <section
        className="detail-pane"
        tabIndex={-1}
        aria-label="Linear Issue details"
        aria-busy={(canRead && detail.isFetching) || detailLoading}
        data-arco-issue={
          connected && detail.data ? selectionIssueData(detail.data) : undefined
        }
      >
        {(!connected || !detail.data) && detailFeedback}
        {connected && detail.data && draftOwnerId ? (
          <LinearDetail
            key={`${draftOwnerId}/${detail.data.connectionId}/${detail.data.issueId}`}
            ownerId={draftOwnerId}
            host={host}
            issue={detail.data}
            feedback={detailFeedback}
            shared={
              shared
                ? {
                    ...shared,
                    identifier: sharedDisplay?.identifier,
                    title: sharedDisplay?.title,
                  }
                : null
            }
            onBack={focusIssueList}
            onFullscreen={() => void changeMode("fullscreen")}
            metadata={detailMetadata.data}
            metadataError={detailMetadata.error}
            connection={connection.data}
            busy={commands.busy}
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
            <p>Select an issue from the list, or paste a Linear issue link.</p>
          </div>
        )}
      </section>
      {scope && draftOwnerId && (
        <LinearCreateIssue
          key={`${draftOwnerId}/${scope.workspaceId}/${scope.teamId}`}
          ownerId={draftOwnerId}
          host={host}
          scope={scope}
          open={createOpen}
          busy={commands.busy}
          notice={notice}
          workspaceName={scopes.data?.workspace.name ?? "Workspace"}
          teamName={
            scopes.data?.teams.find((team) => team.id === scope.teamId)?.name ??
            "Selected team"
          }
          metadata={metadata.data}
          run={run}
          onClose={() => setCreateOpen(false)}
          onCreated={(result) => {
            setSelected(linearRef(result));
            setShowDetail(true);
          }}
          onOpenLink={(url) => void hostAction(() => host.openLink(url))}
        />
      )}
    </WorkspaceLayout>
  );
}
